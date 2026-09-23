"""Generate the requested 48h forecast from a single archived weather run."""
import argparse
import json

import joblib
import numpy as np
import pandas as pd

from src.data.load import ROOT, LOCAL_TZ, HISTORY_END
from src.features.build import build_features
from src.weather.client import WeatherClient, read_config

OUTPUT_COLUMNS = ['turbine_id', 'forecast_origin_utc', 'weather_run_utc',
                  'target_time_utc', 'horizon_h', 'predicted_power', 'model_version', 'fallback_used']


def make_forecast(bundle, weather, origin, run, config):
    origin, run = pd.Timestamp(origin), pd.Timestamp(run)
    if origin.tzinfo is None or run.tzinfo is None:
        raise ValueError('Origin and run must be timezone-aware')
    origin, run = origin.tz_convert('UTC'), run.tz_convert('UTC')
    if run + pd.Timedelta(hours=config['availability_delay_hours']) > origin:
        raise ValueError('Weather run was not available at forecast origin')
    training_available = pd.Timestamp(bundle['metadata']['train_last_available_at_utc'])
    if training_available > min(origin, HISTORY_END):
        raise ValueError('Model includes observations unavailable at origin or beyond history cutoff')
    if weather.time.duplicated().any() or not weather.weather_run_utc.eq(run).all():
        raise ValueError('Weather must contain unique targets from the requested run only')
    targets = pd.DataFrame({'time': pd.date_range(origin + pd.Timedelta(hours=1),
                                                  periods=config['horizon_hours'], freq='h')})
    selected = targets.merge(weather, on='time', how='left', validate='one_to_one')
    if selected[config['weather_variables']].isna().any().any():
        raise ValueError('Requested forecast horizon has missing weather; no silent substitution')
    frames = []
    for turbine in config['turbines']:
        features = selected.assign(turbine_id=turbine['turbine_id'])
        predicted = np.clip(bundle['model'].predict(build_features(features)), 0, 1)
        if not np.isfinite(predicted).all():
            raise ValueError('Model returned non-finite predictions')
        frames.append(pd.DataFrame({
            'turbine_id': turbine['turbine_id'], 'forecast_origin_utc': origin,
            'weather_run_utc': run, 'target_time_utc': selected.time,
            'horizon_h': np.arange(1, config['horizon_hours'] + 1),
            'predicted_power': predicted, 'model_version': bundle['metadata']['model_version'],
            'fallback_used': 'false',
        }))
    output = pd.concat(frames, ignore_index=True)[OUTPUT_COLUMNS]
    for column in ('forecast_origin_utc', 'weather_run_utc', 'target_time_utc'):
        output[column] = output[column].dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin-local', default='2026-01-31T00:00')
    parser.add_argument('--run', default='2026-01-30T12:00Z')
    args = parser.parse_args()
    origin = pd.Timestamp(args.origin_local)
    if origin.tzinfo is None:
        origin = origin.tz_localize(LOCAL_TZ)
    origin = origin.tz_convert('UTC')
    run = pd.Timestamp(args.run)
    if run.tzinfo is None:
        run = run.tz_localize('UTC')
    run = run.tz_convert('UTC')
    config = read_config()
    # Load only the artifact generated locally by src.model.train.
    bundle = joblib.load(ROOT / 'outputs/hgb_model.joblib')
    weather = WeatherClient(config).single_run(run.isoformat())
    output = make_forecast(bundle, weather, origin, run, config)
    output.to_csv(ROOT / 'outputs/forecasts.csv', index=False, float_format='%.6f')
    metadata = dict(origin_utc=origin.isoformat(), weather_run_utc=run.isoformat(),
                    assumed_weather_available_at_utc=(run + pd.Timedelta(hours=config['availability_delay_hours'])).isoformat(),
                    weather_source='Open-Meteo Single Runs API',
                    weather_model=config['weather_model'], weather_point=config['weather_point'],
                    returned_elevation_metadata='data/weather_cache/run_*.json',
                    model_training=bundle['metadata'], rows=len(output), fallback_used=False,
                    target_definition='Hourly mean over [target_time_utc, target_time_utc + 1 hour)')
    (ROOT / 'outputs/forecast_metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(output.groupby('turbine_id').predicted_power.agg(['count', 'min', 'max']).to_string())
    print('Origin:', origin, 'Run:', run)
    print('Targets:', output.target_time_utc.min(), '..', output.target_time_utc.max())
    print('Saved outputs/forecasts.csv:', len(output), 'rows')


if __name__ == '__main__':
    main()
