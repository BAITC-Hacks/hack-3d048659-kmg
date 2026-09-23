"""One predeclared December-only comparison; January never selects the recipe."""
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.metrics import mean_absolute_error, mean_squared_error
from threadpoolctl import threadpool_limits

from src.data.load import ROOT, LOCAL_TZ, load_all
from src.features.build import build_features
from src.features.join import join_weather
from src.model.train import TRAIN_END, training_rows, validation_pairs, predict_curve
from src.weather.client import WeatherClient

DECEMBER_END = pd.Timestamp('2026-01-01', tz=LOCAL_TZ).tz_convert('UTC')


def main():
    observations, _ = load_all()
    # Explicitly remove January before constructing the comparison data.
    observations = observations.loc[(observations.time < DECEMBER_END)
                                     & (observations.available_at_utc <= DECEMBER_END)]
    weather = WeatherClient().historical()
    frame = join_weather(observations, weather.loc[weather.time < DECEMBER_END])
    train = training_rows(frame)
    validation = validation_pairs(frame)
    validation = validation.loc[(validation.time < DECEMBER_END)
                                 & (validation.forecast_origin_utc < DECEMBER_END)].copy()
    assert train.time.max() < TRAIN_END
    assert validation.time.max() < DECEMBER_END
    baseline = joblib.load(ROOT / 'outputs/hgb_validation_model.joblib')
    absolute = clone(baseline['model']).set_params(loss='absolute_error')
    with threadpool_limits(limits=4):
        absolute.fit(build_features(train), train.power)
        validation['hgb_current'] = np.clip(baseline['model'].predict(build_features(validation)), 0, 1)
        validation['hgb_absolute_error'] = np.clip(absolute.predict(build_features(validation)), 0, 1)
    validation['power_curve'] = predict_curve(validation, baseline['curves'])
    validation['blend_50_50'] = (validation.hgb_current + validation.power_curve) / 2
    methods = ['hgb_current', 'hgb_absolute_error', 'blend_50_50', 'power_curve']
    def scores(group):
        return {method: {'mae': float(mean_absolute_error(group.power, group[method])),
                         'rmse': float(np.sqrt(mean_squared_error(group.power, group[method])))} for method in methods}
    pooled = scores(validation)
    candidate = min(methods[:-1], key=lambda name: pooled[name]['mae'])
    beats_curve = pooled[candidate]['mae'] < pooled['power_curve']['mae']
    chosen = candidate if beats_curve else 'hgb_current'
    recipe = {'loss': 'absolute_error' if chosen == 'hgb_absolute_error' else 'squared_error',
              'power_curve_weight': 0.5 if chosen == 'blend_50_50' else 0.0}
    report = {'selection_period': 'December 2025 only',
              'train_before_utc': TRAIN_END.isoformat(), 'validation_end_exclusive_utc': DECEMBER_END.isoformat(),
              'validation_n': len(validation), 'train_n': len(train),
              'pooled': pooled, 'per_turbine': {str(int(i)): scores(g) for i, g in validation.groupby('turbine_id')},
              'selection_metric': 'pooled December MAE on identical origin/target rows',
              'weather_source': 'historical_forecast (hgb_validation_model setup)',
              'selected': chosen, 'beats_power_curve': beats_curve, 'recipe': recipe,
              'january_used_for_selection': False}
    (ROOT / 'outputs/december_experiment.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
