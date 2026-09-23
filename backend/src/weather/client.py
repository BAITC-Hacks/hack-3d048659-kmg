"""One shared Open-Meteo point, explicit model/units, cached with provenance."""
import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path

import pandas as pd
import requests
import yaml
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

ROOT = Path(__file__).resolve().parents[2]
HISTORICAL_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
RUN_URL = 'https://single-runs-api.open-meteo.com/v1/forecast'


def read_config():
    return yaml.safe_load((ROOT / 'config.yaml').read_text(encoding='utf-8'))


class WeatherClient:
    def __init__(self, config=None, cache_dir=None):
        self.config = config or read_config()
        self.cache_dir = Path(cache_dir or ROOT / 'data/weather_cache')
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.session = requests.Session()
        retries = Retry(total=2, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
        self.session.mount('https://', HTTPAdapter(max_retries=retries))

    def _fetch(self, url, extra, label):
        point = self.config['weather_point']
        params = dict(latitude=point['lat'], longitude=point['lon'],
                      models=self.config['weather_model'], timezone='UTC',
                      wind_speed_unit='ms', hourly=','.join(self.config['weather_variables']))
        if point.get('elevation') is not None:
            params['elevation'] = point['elevation']
        params.update(extra)
        key = hashlib.sha256(json.dumps([url, params], sort_keys=True).encode()).hexdigest()[:16]
        path = self.cache_dir / f'{label}_{key}.parquet'
        meta_path = path.with_suffix('.json')
        if path.exists() and meta_path.exists():
            return pd.read_parquet(path)
        response = self.session.get(url, params=params, timeout=45)
        response.raise_for_status()
        payload = response.json()
        if payload.get('error'):
            raise ValueError(payload.get('reason', 'Weather API error'))
        frame = pd.DataFrame(payload['hourly'])
        frame['time'] = pd.to_datetime(frame['time'], utc=True)
        if frame.time.duplicated().any() or not frame.time.is_monotonic_increasing:
            raise ValueError('Weather timestamps must be unique and increasing')
        for variable in self.config['weather_variables']:
            if variable not in frame:
                raise ValueError(f'Weather response missing {variable}')
            frame[variable] = pd.to_numeric(frame[variable], errors='raise')
        if payload.get('utc_offset_seconds') != 0:
            raise ValueError('Expected UTC weather response')
        if payload['hourly_units']['wind_speed_100m'] != 'm/s':
            raise ValueError('Expected wind speed in m/s')
        if 'run' in extra:
            frame['weather_run_utc'] = pd.Timestamp(extra['run'], tz='UTC')
        metadata = {key: value for key, value in payload.items() if key != 'hourly'}
        metadata.update(url=url, request=params, retrieved_at_utc=datetime.now(timezone.utc).isoformat(),
                        source_kind='single_run' if 'run' in extra else 'stitched_historical_forecast',
                        rows=len(frame), null_counts=frame.isna().sum().to_dict())
        frame.to_parquet(path, index=False)
        meta_path.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f'Cached {label}: {len(frame)} hours, elevation={metadata.get("elevation")} m', flush=True)
        return frame

    def historical(self, start='2023-03-11', end='2026-01-31'):
        start_date, end_date = date.fromisoformat(start), date.fromisoformat(end)
        if start_date > end_date:
            raise ValueError('Start must not exceed end')
        chunks = []
        for year in range(start_date.year, end_date.year + 1):
            lo, hi = max(start_date, date(year, 1, 1)), min(end_date, date(year, 12, 31))
            chunks.append(self._fetch(HISTORICAL_URL, {'start_date': str(lo), 'end_date': str(hi)}, f'history_{year}'))
        return pd.concat(chunks, ignore_index=True).sort_values('time').reset_index(drop=True)

    def single_run(self, run='2026-01-30T12:00'):
        timestamp = pd.Timestamp(run)
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize('UTC')
        timestamp = timestamp.tz_convert('UTC')
        if timestamp.hour not in (0, 6, 12, 18) or timestamp.minute or timestamp.second:
            raise ValueError('Run must be at an ECMWF six-hour initialization cycle')
        normalized = timestamp.strftime('%Y-%m-%dT%H:%M')
        return self._fetch(RUN_URL, {'run': normalized}, 'run_' + timestamp.strftime('%Y%m%dT%H%M'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['history', 'run', 'both'], default='both')
    args = parser.parse_args()
    client = WeatherClient()
    if args.kind in ('history', 'both'):
        history = client.historical()
        print('History:', history.time.min(), history.time.max(), 'rows=', len(history))
        print('Missing:', history.isna().sum().to_dict())
    if args.kind in ('run', 'both'):
        run = client.single_run()
        print('Run:', run.time.min(), run.time.max(), 'rows=', len(run))
        print('Missing:', run.isna().sum().to_dict())


if __name__ == '__main__':
    main()
