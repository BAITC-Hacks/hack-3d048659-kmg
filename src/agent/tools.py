"""Deterministic forecast tools with as-of guards and explicit fallback provenance."""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import requests
from threadpoolctl import threadpool_limits

from src.agent.forecast import OUTPUT_COLUMNS
from src.data.load import ROOT, HISTORY_END, load_all
from src.features.build import build_features
from src.model.train import predict_curve
from src.weather.client import WeatherClient, read_config

KEY = ['turbine_id', 'forecast_origin_utc', 'target_time_utc']


def utc(value):
    value = pd.Timestamp(value)
    if value.tzinfo is None:
        raise ValueError('Timestamp must include timezone')
    return value.tz_convert('UTC')


def iso(value):
    return utc(value).strftime('%Y-%m-%dT%H:%M:%SZ')


def log_step(origin, step, status, message, weather_run=None, fallback=False,
             path=ROOT / 'outputs/agent_runs.jsonl'):
    row = {'ts': iso(pd.Timestamp.now(tz='UTC')), 'origin_utc': iso(origin), 'step': step,
           'status': status, 'message': message,
           'weather_run': iso(weather_run) if weather_run is not None else None, 'fallback': bool(fallback)}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with Path(path).open('a', encoding='utf-8') as stream:
        stream.write(json.dumps(row, ensure_ascii=False) + '\n')


def select_weather_run(origin_utc):
    return (utc(origin_utc) - pd.Timedelta(hours=6)).floor('6h')


def fetch_weather(run, client=None):
    return (client or WeatherClient()).single_run(utc(run).isoformat())


def assert_bundle_available(bundle, origin):
    meta = bundle['metadata']
    available = utc(meta['train_last_available_at_utc'])
    if available > min(utc(origin), HISTORY_END):
        raise ValueError('Model training includes observations unavailable at origin')
    if 'train_last_target_utc' in meta and utc(meta['train_last_target_utc']) >= min(utc(origin), HISTORY_END):
        raise ValueError('Model training target violates cutoff')


def load_bundle(origin):
    for filename in ('hgb_model.joblib', 'hgb_validation_model.joblib'):
        bundle = joblib.load(ROOT / 'outputs' / filename)
        try:
            assert_bundle_available(bundle, origin)
            return bundle
        except ValueError:
            continue
    raise ValueError('No model artifact is available at this origin')


def select_horizon(weather, run, origin, config):
    if weather.time.duplicated().any():
        raise ValueError('Weather has duplicate timestamps')
    if not weather.weather_run_utc.eq(run).all():
        raise ValueError('Wrong weather run in response')
    if run + pd.Timedelta(hours=6) > origin:
        raise ValueError('Weather run unavailable at origin')
    targets = pd.DataFrame({'time': pd.date_range(origin + pd.Timedelta(hours=1),
                                                  periods=config['horizon_hours'], freq='h')})
    return targets.merge(weather, on='time', how='left', validate='one_to_one')


def prepare_features(weather, turbine_id):
    return build_features(weather.assign(turbine_id=int(turbine_id)))


def predict(bundle, features, origin_utc):
    assert_bundle_available(bundle, origin_utc)
    with threadpool_limits(limits=4):
        result = np.clip(bundle['model'].predict(features), 0, 1)
    if not np.isfinite(result).all():
        raise ValueError('Non-finite model predictions')
    return result


def persistence(observations, turbine_id, origin):
    known = observations.loc[(observations.turbine_id == turbine_id)
                             & (observations.available_at_utc <= utc(origin))
                             & (observations.time < utc(origin))
                             & (observations.time < HISTORY_END)].dropna(subset=['power'])
    if known.empty:
        raise ValueError(f'No available power observation for turbine {turbine_id}')
    return float(known.sort_values('available_at_utc').power.iloc[-1])


def validate_forecast(frame, turbine_ids=(1, 2)):
    if list(frame.columns) != OUTPUT_COLUMNS or frame.empty or frame.isna().any().any():
        raise ValueError('Forecast schema, empty frame, or NaN violation')
    if frame.duplicated(KEY).any():
        raise ValueError('Duplicate forecast key')
    if not set(frame.fallback_used.astype(str)).issubset({'true', 'false'}):
        raise ValueError('fallback_used must be lowercase true/false')
    power = pd.to_numeric(frame.predicted_power, errors='raise')
    if not np.isfinite(power).all() or not power.between(0, 1).all():
        raise ValueError('Power must be finite and in [0,1]')
    times = {}
    for name in ('forecast_origin_utc', 'weather_run_utc', 'target_time_utc'):
        if not frame[name].astype(str).str.endswith('Z').all():
            raise ValueError('All timestamps must end with Z')
        times[name] = pd.to_datetime(frame[name], utc=True)
    if not (times['weather_run_utc'] + pd.Timedelta(hours=6) <= times['forecast_origin_utc']).all():
        raise ValueError('Weather availability violation')
    run = times['weather_run_utc'].dt
    if not (run.hour.isin([0, 6, 12, 18]) & run.minute.eq(0) & run.second.eq(0)).all():
        raise ValueError('Invalid ECMWF initialization cycle')
    horizons = pd.to_numeric(frame.horizon_h, errors='raise')
    if not (times['target_time_utc'] == times['forecast_origin_utc'] + pd.to_timedelta(horizons, unit='h')).all():
        raise ValueError('Target must equal origin+horizon')
    for _, origin_frame in frame.groupby('forecast_origin_utc'):
        if set(origin_frame.turbine_id) != set(turbine_ids):
            raise ValueError('Expected both turbines at each origin')
        for _, group in origin_frame.groupby('turbine_id'):
            if len(group) != 48 or sorted(group.horizon_h) != list(range(1, 49)):
                raise ValueError('Expected 48 unique horizons 1..48 per turbine')
    return True


def save_forecast(frame, path=ROOT / 'outputs/forecasts.csv'):
    validate_forecast(frame)
    path = Path(path)
    if path.exists():
        previous = pd.read_csv(path, dtype={'fallback_used': str})
        validate_forecast(previous)
        frame = pd.concat([previous, frame], ignore_index=True).drop_duplicates(KEY, keep='last')
    frame = frame.sort_values(['forecast_origin_utc', 'turbine_id', 'horizon_h']).reset_index(drop=True)
    validate_forecast(frame)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.tmp')
    frame.to_csv(temporary, index=False, float_format='%.6f')
    temporary.replace(path)
    return frame


def reforecast(origin_utc, bundle=None, observations=None, client=None, save=True,
               output_path=ROOT / 'outputs/forecasts.csv', log_path=ROOT / 'outputs/agent_runs.jsonl',
               return_context=False):
    origin = utc(origin_utc)
    config = read_config()
    def log(step, status, message, run=None, fallback=False):
        log_step(origin, step, status, message, run, fallback, log_path)
    log('start', 'ok', 'Deterministic orchestration')
    bundle = bundle if bundle is not None else load_bundle(origin)
    assert_bundle_available(bundle, origin)
    log('load_model', 'ok', bundle['metadata']['model_version'])
    selected_run = select_weather_run(origin)
    log('select_weather_run', 'ok', 'Latest cycle with run+6h<=origin', selected_run)
    candidates, chosen, chosen_run = [], None, selected_run
    method, fallback = 'model', False
    for attempt in range(2):
        run = selected_run - pd.Timedelta(hours=6 * attempt)
        try:
            weather = fetch_weather(run, client)
            log('fetch_weather', 'ok', 'Single Runs archive/cache', run, attempt > 0)
            horizon = select_horizon(weather, run, origin, config)
            candidates.append((run, horizon))
            values = horizon[config['weather_variables']].to_numpy(dtype=float)
            if not np.isfinite(values).all():
                raise ValueError('Missing or non-finite weather in forecast horizon')
            chosen, chosen_run, fallback = horizon, run, attempt > 0
            break
        except (requests.RequestException, ValueError, KeyError) as error:
            log('fetch_weather', 'failed', str(error), run, True)
    if chosen is None:
        fallback = True
        for run, horizon in candidates:  # newest successfully returned run first
            if np.isfinite(horizon.wind_speed_100m.to_numpy(dtype=float)).all():
                chosen, chosen_run, method = horizon, run, 'power_curve'
                break
        if chosen is None:
            method = 'persistence'
            chosen_run = candidates[0][0] if candidates else selected_run
            chosen = pd.DataFrame({'time': pd.date_range(origin + pd.Timedelta(hours=1), periods=48, freq='h')})
            if observations is None:
                observations, _ = load_all()
        log('fallback', 'ok', method + ('; weather_run marks eligible candidate, no weather consumed' if method == 'persistence' else ''), chosen_run, True)
    frames = []
    for turbine in config['turbines']:
        turbine_id = turbine['turbine_id']
        if method == 'model':
            features = prepare_features(chosen, turbine_id)
            log('prepare_features', 'ok', f'Turbine {turbine_id}: {len(features)} targets', chosen_run, fallback)
            values = predict(bundle, features, origin)
        elif method == 'power_curve':
            values = predict_curve(chosen.assign(turbine_id=turbine_id), bundle['curves']).to_numpy()
        else:
            values = np.full(48, persistence(observations, turbine_id, origin))
        version = bundle['metadata']['model_version'] if method == 'model' else bundle['metadata']['model_version'] + '-' + method
        frames.append(pd.DataFrame({'turbine_id': turbine_id, 'forecast_origin_utc': iso(origin),
            'weather_run_utc': iso(chosen_run), 'target_time_utc': chosen.time.map(iso),
            'horizon_h': np.arange(1, 49), 'predicted_power': values,
            'model_version': version, 'fallback_used': str(fallback).lower()}))
        log('predict', 'ok', f'{method}, turbine {turbine_id}', chosen_run, fallback)
    result = pd.concat(frames, ignore_index=True)[OUTPUT_COLUMNS]
    validate_forecast(result)
    log('validate_forecast', 'ok', '96 rows; bounds, horizon, UTC, availability checked', chosen_run, fallback)
    if save:
        save_forecast(result, output_path)
        log('save_forecast', 'ok', 'Upsert completed', chosen_run, fallback)
    log('complete', 'ok', method, chosen_run, fallback)
    if return_context:
        return result, {'weather': chosen, 'weather_run': chosen_run, 'method': method, 'fallback': fallback}
    return result
