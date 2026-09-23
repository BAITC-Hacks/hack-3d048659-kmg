"""Translate backend artifacts into the dashboard contract without changing them."""
import json
import math
from pathlib import Path

import pandas as pd

from src.agent.tools import iso, reforecast, validate_forecast
from src.api.domain import WEATHER_SOURCE
from src.data.load import LOCAL_TZ, ROOT
from src.weather.client import WeatherClient, read_config

def optional_number(value):
    """Missing/non-finite optional measurements must serialize as JSON null."""
    if value is None or pd.isna(value):
        return None
    result = float(value)
    return result if math.isfinite(result) else None


class FilesystemForecastRepository:
    def __init__(self, root=ROOT, runtime_dir=None):
        self.root = Path(root)
        self.runtime_dir = Path(runtime_dir) if runtime_dir else self.root / '.runtime'
        self.config = read_config()

    def _forecasts(self):
        frame = pd.read_csv(self.root / 'outputs/forecasts.csv', dtype={'fallback_used': str})
        validate_forecast(frame)
        return frame

    def cached_weather(self, run):
        """Read the exact archived run; never fetch on a workspace GET."""
        run = pd.Timestamp(run)
        label = 'run_' + run.strftime('%Y%m%dT%H%M') + '_*.json'
        for directory in (self.root / 'data/weather_cache', self.runtime_dir / 'weather_cache'):
            for metadata_path in sorted(directory.glob(label)):
                try:
                    metadata = json.loads(metadata_path.read_text(encoding='utf-8'))
                    request = metadata['request']
                    stamp = pd.Timestamp(request['run'])
                    stamp = stamp.tz_localize('UTC') if stamp.tzinfo is None else stamp.tz_convert('UTC')
                    point = self.config['weather_point']
                    if (metadata.get('source_kind') != 'single_run' or stamp != run
                            or request.get('models') != self.config['weather_model']
                            or request.get('latitude') != point['lat']
                            or request.get('longitude') != point['lon']
                            or request.get('wind_speed_unit') != 'ms'):
                        continue
                    frame = pd.read_parquet(metadata_path.with_suffix('.parquet'))
                    frame['time'] = pd.to_datetime(frame['time'], utc=True)
                    frame['weather_run_utc'] = pd.to_datetime(frame['weather_run_utc'], utc=True)
                    if frame.time.duplicated().any() or not frame.weather_run_utc.eq(run).all():
                        continue
                    return frame
                except (OSError, ValueError, KeyError, TypeError):
                    continue
        return None

    def runs_from_frame(self, frame, contexts=None):
        runs, weather_by_run = [], {}
        for (origin, turbine), group in frame.groupby(['forecast_origin_utc', 'turbine_id'], sort=True):
            group = group.sort_values('horizon_h')
            first = group.iloc[0]
            version = str(first.model_version)
            method = 'persistence' if version.endswith('-persistence') else (
                'power_curve' if version.endswith('-power_curve') else 'model')
            run = iso(first.weather_run_utc)
            context = contexts.get(iso(origin)) if contexts else None
            if context is not None:
                method = context['method']
                weather = context['weather']
            elif method == 'persistence':
                weather = None
            else:
                if run not in weather_by_run:
                    weather_by_run[run] = self.cached_weather(run)
                weather = weather_by_run[run]
            weather_points = {}
            if weather is not None and method != 'persistence':
                for _, row in weather.iterrows():
                    weather_points[iso(row.time)] = {
                        'wind': optional_number(row.get('wind_speed_100m')),
                        'temperature': optional_number(row.get('temperature_2m')),
                    }
            turbine_key = f't{int(turbine)}'
            fallback = str(first.fallback_used).lower() == 'true'
            runs.append({
                'id': f'{turbine_key}-{pd.Timestamp(origin).value // 1_000_000}',
                'turbine': turbine_key,
                'issuedAt': iso(origin),
                'weatherIssuedAt': run,
                'weatherAvailableAt': iso(pd.Timestamp(run) + pd.Timedelta(hours=6)),
                'horizon': 48,
                'status': 'success',
                'reason': 'Резервный метод прогноза' if fallback else 'Архивный расчёт агента',
                'modelVersion': version,
                'fallbackUsed': fallback,
                'method': method,
                'weatherSource': 'Погода не использована (persistence)' if method == 'persistence' else WEATHER_SOURCE,
                'points': [{
                    'time': iso(row.target_time_utc),
                    'power': float(row.predicted_power),
                    **weather_points.get(iso(row.target_time_utc), {'wind': None, 'temperature': None}),
                } for row in group.itertuples()],
            })
        return runs

    def _observations(self):
        path = self.root / 'outputs/actuals_jan.csv'
        if not path.exists():
            return [], None
        frame = pd.read_csv(path)
        batches, all_times = [], []
        for turbine, group in frame.groupby('turbine_id', sort=True):
            points = []
            for row in group.sort_values('target_time_utc').itertuples():
                power = optional_number(row.actual_power)
                if power is not None:
                    points.append({'time': iso(row.target_time_utc), 'power': power})
            if points:
                last = points[-1]['time']
                all_times.append(last)
                batches.append({'turbine': f't{int(turbine)}', 'points': points,
                                'updatedAt': iso(pd.Timestamp(last) + pd.Timedelta(hours=1))})
        return batches, max(all_times) if all_times else None

    def _overrides(self):
        path = self.runtime_dir / 'forecasts.json'
        if not path.exists():
            return []
        return json.loads(path.read_text(encoding='utf-8'))

    def workspace(self):
        runs = {run['id']: run for run in self.runs_from_frame(self._forecasts())}
        for run in self._overrides():
            if run['id'] in runs:
                runs[run['id']] = run
        observations, actuals_through = self._observations()
        return {'runs': sorted(runs.values(), key=lambda item: (item['issuedAt'], item['turbine'])),
                'observations': observations,
                'meta': {'weatherSource': WEATHER_SOURCE, 'availabilityDelayHours': 6,
                         'actualsThrough': actuals_through}}

    def allowed_origins(self):
        schedule = self.config['backtest']
        permitted = {iso(stamp) for stamp in pd.date_range(schedule['origin_start_local'],
                     schedule['origin_end_local'], freq='D', tz=LOCAL_TZ)}
        return permitted & set(self._forecasts().forecast_origin_utc)

    def save_forecasts(self, replacements):
        self.runtime_dir.mkdir(parents=True, exist_ok=True)
        overrides = {run['id']: run for run in self._overrides()}
        overrides.update({run['id']: run for run in replacements})
        target = self.runtime_dir / 'forecasts.json'
        temporary = target.with_suffix('.tmp')
        temporary.write_text(json.dumps(list(overrides.values()), ensure_ascii=False, allow_nan=False), encoding='utf-8')
        temporary.replace(target)


class ExistingForecastEngine:
    """Adapt the proven forecasting core without changing its model or guards."""
    def __init__(self, repository):
        self.repository = repository

    def forecast(self, origin):
        self.repository.runtime_dir.mkdir(parents=True, exist_ok=True)
        frame, context = reforecast(
            origin, client=RuntimeWeatherClient(self.repository), save=False,
            log_path=self.repository.runtime_dir / 'agent_runs.jsonl', return_context=True)
        validate_forecast(frame)
        if set(frame.forecast_origin_utc) != {origin}:
            raise ValueError('Agent returned a different origin')
        return self.repository.runs_from_frame(frame, {origin: context})


class RuntimeWeatherClient:
    """Reuse committed cache; put any newly fetched runs in the runtime directory."""
    def __init__(self, repository):
        self.repository = repository

    def single_run(self, run):
        cached = self.repository.cached_weather(run)
        if cached is not None:
            return cached
        return WeatherClient(self.repository.config, self.repository.runtime_dir / 'weather_cache').single_run(run)
