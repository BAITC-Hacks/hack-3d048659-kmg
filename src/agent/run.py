"""CLI: deterministic orchestration is the default; no LLM/API key is required."""
import argparse
import json

import pandas as pd

from src.agent.tools import reforecast, log_step, utc
from src.data.load import ROOT, LOCAL_TZ, load_all
from src.weather.client import WeatherClient, read_config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--origin', default='2026-01-30T19:00Z')
    parser.add_argument('--no-llm', action='store_true', help='Deterministic default; no external LLM requests')
    parser.add_argument('--backtest', action='store_true')
    args = parser.parse_args()
    config = read_config()
    if args.backtest:
        schedule = config['backtest']
        origins = pd.date_range(schedule['origin_start_local'], schedule['origin_end_local'], freq='D', tz=LOCAL_TZ).tz_convert('UTC')
    else:
        origins = [utc(args.origin)]
    observations, _ = load_all()
    client = WeatherClient(config)
    records = []
    for origin in origins:
        try:
            result = reforecast(origin, observations=observations, client=client)
        except Exception as error:
            log_step(origin, 'run', 'failed', str(error))
            raise
        record = {'origin_utc': result.forecast_origin_utc.iloc[0],
                  'weather_run_utc': result.weather_run_utc.iloc[0],
                  'model_version': result.model_version.iloc[0],
                  'fallback_used': result.fallback_used.iloc[0], 'rows': len(result)}
        records.append(record)
        print(json.dumps(record), flush=True)
    if args.backtest:
        (ROOT / 'outputs/backtest_manifest.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
        metadata = {'origins': len(records), 'rows': sum(record['rows'] for record in records),
                    'weather_source': 'single_runs', 'weather_model': config['weather_model'],
                    'availability_delay_hours': 6, 'orchestration': 'deterministic',
                    'first_origin_model': records[0]['model_version'],
                    'model_selection': 'Most recent saved model whose training observations are available at origin',
                    'manifest': 'outputs/backtest_manifest.json',
                    'target_definition': 'Mean over [target_time_utc, target_time_utc+1h)',
                    'actuals_available_for_february': False}
        (ROOT / 'outputs/forecast_metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    print(f'Completed {len(origins)} origins; forecasts upserted into outputs/forecasts.csv')


if __name__ == '__main__':
    main()
