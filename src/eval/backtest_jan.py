"""January evaluation: held-out observations and actual archived forecast runs."""
import json

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error

from src.agent.tools import iso, persistence, reforecast, validate_forecast
from src.data.load import ROOT, LOCAL_TZ, HISTORY_END, load_all
from src.features.join import join_weather
from src.model.train import fit_bundle, predict_curve
from src.weather.client import WeatherClient

JAN_START = pd.Timestamp('2026-01-01', tz=LOCAL_TZ).tz_convert('UTC')
METHODS = ('model', 'power_curve', 'persistence')


def scores(frame):
    return {method: {'mae': float(mean_absolute_error(frame.actual_power, frame[method])),
                     'rmse': float(np.sqrt(mean_squared_error(frame.actual_power, frame[method])))}
            for method in METHODS}


def main():
    observations, _ = load_all()
    client = WeatherClient()
    training = join_weather(observations, client.historical())
    bundle = fit_bundle(training, JAN_START, 'hgb-jan-eval-train-before-20260101')
    output = ROOT / 'outputs'
    joblib.dump(bundle, output / 'hgb_jan_eval_model.joblib')
    (output / 'jan_model_metadata.json').write_text(json.dumps(bundle['metadata'], indent=2), encoding='utf-8')
    origins = pd.date_range('2026-01-01', '2026-01-30', freq='D', tz=LOCAL_TZ).tz_convert('UTC')
    forecasts, evaluations = [], []
    for origin in origins:
        result, context = reforecast(origin, bundle=bundle, observations=observations,
                                     client=client, save=False, return_context=True)
        forecasts.append(result)
        result = result.rename(columns={'predicted_power': 'model'})
        result['time'] = pd.to_datetime(result.target_time_utc, utc=True)
        if 'wind_speed_100m' in context['weather']:
            result = result.merge(context['weather'][['time', 'wind_speed_100m']], on='time', validate='many_to_one')
            result['power_curve'] = predict_curve(result, bundle['curves'])
        else:
            result['power_curve'] = np.nan
        result['persistence'] = result.turbine_id.map({i: persistence(observations, i, origin) for i in (1, 2)})
        evaluations.append(result)
        print(f'January origin {iso(origin)}: {context["method"]}, fallback={context["fallback"]}', flush=True)
    all_forecasts = pd.concat(forecasts, ignore_index=True)
    validate_forecast(all_forecasts)
    all_forecasts.to_csv(output / 'forecasts_jan.csv', index=False, float_format='%.6f')
    actuals = observations.loc[(observations.time >= JAN_START) & (observations.time < HISTORY_END),
                               ['turbine_id', 'time', 'power']].dropna(subset=['power']).rename(columns={'power': 'actual_power'})
    ui_actuals = actuals.assign(target_time_utc=actuals.time.map(iso))[
        ['turbine_id', 'target_time_utc', 'actual_power']]
    ui_actuals.to_csv(output / 'actuals_jan.csv', index=False, float_format='%.6f')
    pairs = pd.concat(evaluations, ignore_index=True).merge(actuals, on=['turbine_id', 'time'], how='left', validate='many_to_one')
    # Identical finite rows for all three methods; no fabricated February truth.
    scored = pairs.replace([np.inf, -np.inf], np.nan).dropna(subset=['actual_power', *METHODS]).copy()
    if scored.empty:
        raise ValueError('No common evaluation rows with observed power')
    metrics = {
        'per_turbine': {str(int(i)): scores(group) for i, group in scored.groupby('turbine_id')},
        'by_horizon': {'1-24': scores(scored.loc[scored.horizon_h <= 24]),
                       '25-48': scores(scored.loc[scored.horizon_h > 24])},
        'n': len(scored),
        'period': {'train_before_local': '2026-01-01T00:00:00+05:00',
                   'origin_start_local': '2026-01-01', 'origin_end_local': '2026-01-30',
                   'actuals_end_exclusive_utc': iso(HISTORY_END),
                   'units': 'normalized power [0,1]',
                   'n_per_turbine': {str(int(i)): len(g) for i, g in scored.groupby('turbine_id')},
                   'n_by_horizon': {'1-24': int((scored.horizon_h <= 24).sum()),
                                    '25-48': int((scored.horizon_h > 24).sum())},
                   'excluded_missing_actual_or_baseline': len(pairs) - len(scored),
                   'forecast_rows': len(all_forecasts),
                   'fallback_rows': int(all_forecasts.fallback_used.eq('true').sum()),
                   'training_weather_source': 'historical_forecast',
                   'evaluation_weather_source': 'single_runs'},
        'weather_source': 'single_runs',
    }
    (output / 'metrics.json').write_text(json.dumps(metrics, indent=2, allow_nan=False), encoding='utf-8')
    scored.drop(columns=['time']).to_csv(output / 'jan_evaluation_rows.csv', index=False, float_format='%.8f')
    print(json.dumps(metrics, indent=2))
    print(f'actuals_jan.csv: {len(ui_actuals)} rows. actuals_feb.csv cannot be produced: raw history ends 2026-01-31 23:50 +05:00.')


if __name__ == '__main__':
    main()
