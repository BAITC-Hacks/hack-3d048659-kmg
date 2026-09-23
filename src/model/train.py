"""Fixed chronological holdout; stitched weather metrics are not run-aware backtests."""
import json

import joblib
import numpy as np
import pandas as pd
import sklearn
from threadpoolctl import threadpool_limits
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error

from src.data.load import ROOT, LOCAL_TZ, HISTORY_END, load_all
from src.features.build import build_features
from src.features.join import join_weather
from src.weather.client import WeatherClient

TRAIN_END = pd.Timestamp('2025-12-01', tz=LOCAL_TZ).tz_convert('UTC')
MODEL_VERSION = 'hgb-v1-train-before-20251201'
PRODUCTION_VERSION = 'hgb-v2-train-before-20260201'
# First backtest origin (2026-01-31 00:00 local) must not see Jan 31 observations.
ASOF_CUTOFF = pd.Timestamp('2026-01-31', tz=LOCAL_TZ).tz_convert('UTC')
ASOF_VERSION = 'hgb-v2-asof-20260131'


def selected_recipe():
    path = ROOT / 'outputs/december_experiment.json'
    if not path.exists():
        return {'loss': 'squared_error', 'power_curve_weight': 0.0}
    report = json.loads(path.read_text(encoding='utf-8'))
    if report['january_used_for_selection'] or pd.Timestamp(report['validation_end_exclusive_utc']) > pd.Timestamp('2025-12-31T19:00Z'):
        raise ValueError('Recipe selection must use December only')
    recipe = report['recipe']
    if recipe['loss'] not in ('squared_error', 'absolute_error') or recipe['power_curve_weight'] not in (0.0, 0.5):
        raise ValueError('Unexpected experiment recipe')
    return recipe


def training_rows(frame, cutoff=TRAIN_END):
    cutoff = min(pd.Timestamp(cutoff), HISTORY_END)
    return frame.loc[(frame.time < cutoff) & (frame.available_at_utc <= cutoff)].dropna(
        subset=['power', 'measured_wind', 'wind_speed_100m'])


def fit_power_curves(training):
    curves = {}
    for turbine_id, group in training.dropna(subset=['measured_wind', 'power']).groupby('turbine_id'):
        bins = np.floor(group.measured_wind / 0.5).astype(int)
        curve = group.groupby(bins).power.median().sort_index()
        curves[int(turbine_id)] = (curve.index.to_numpy() * 0.5 + 0.25, curve.to_numpy())
    return curves


def fit_bundle(frame, cutoff, model_version):
    """Fit all labeled, available rows; HGB accepts missing weather features."""
    cutoff = min(pd.Timestamp(cutoff), HISTORY_END)
    train = frame.loc[(frame.time < cutoff) & (frame.available_at_utc <= cutoff)].dropna(subset=['power'])
    if train.empty:
        raise ValueError('No labeled observations available before cutoff')
    recipe = selected_recipe()
    model = HistGradientBoostingRegressor(loss=recipe['loss'], max_iter=200, learning_rate=0.06,
                                         max_leaf_nodes=20, l2_regularization=1.0,
                                         early_stopping=False, random_state=42,
                                         categorical_features=['turbine_id'])
    with threadpool_limits(limits=4):
        model.fit(build_features(train), train.power)
    metadata = {
        'model_version': model_version, 'train_rows': len(train),
        'train_start_utc': train.time.min().isoformat(),
        'train_last_target_utc': train.time.max().isoformat(),
        'train_last_available_at_utc': train.available_at_utc.max().isoformat(),
        'train_cutoff_exclusive_utc': cutoff.isoformat(),
        'features': list(build_features(train).columns), 'power_unit': 'normalized_0_1',
        'sklearn_version': sklearn.__version__,
        'weather_source': 'Open-Meteo Historical Forecast stitched archive, ecmwf_ifs',
        'missing_label_policy': 'Exclude unlabeled hours; keep labeled rows with missing weather.',
        'recipe': recipe, 'recipe_selection_period': 'December 2025 only',
    }
    return {'model': model, 'curves': fit_power_curves(train), 'metadata': metadata}


def export_power_curves(curves, path):
    rows = [(turbine, float(center - 0.25), float(power))
            for turbine, (centers, powers) in curves.items() for center, power in zip(centers, powers)]
    pd.DataFrame(rows, columns=['turbine_id', 'wind_bin', 'power_median']).to_csv(path, index=False)


def predict_curve(frame, curves):
    values = pd.Series(index=frame.index, dtype=float)
    for turbine_id, group in frame.groupby('turbine_id'):
        x, y = curves[int(turbine_id)]
        values.loc[group.index] = np.interp(group.wind_speed_100m, x, y)
    return values.clip(0, 1)


def validation_pairs(frame):
    """Midnight origins, horizons 1..48, held-out targets through local Jan 31.

    Persistence uses the last observation AVAILABLE at origin and is held fixed
    for 48h. Weather features here come from the stitched archive, not the run
    that was available at each origin: these metrics are explicitly provisional.
    """
    origins = pd.date_range(TRAIN_END, HISTORY_END - pd.Timedelta(days=1), freq='1D')
    pairs = pd.DataFrame([(i, origin, h, origin + pd.Timedelta(hours=h))
                          for i in (1, 2) for origin in origins for h in range(1, 49)],
                         columns=['turbine_id', 'forecast_origin_utc', 'horizon_h', 'time'])
    pairs = pairs.loc[(pairs.time >= TRAIN_END) & (pairs.time < HISTORY_END)]
    pairs = pairs.merge(frame, on=['time', 'turbine_id'], how='left', validate='many_to_one')
    persistence = []
    for turbine_id, group in pairs.groupby('turbine_id'):
        obs = frame.loc[(frame.turbine_id == turbine_id) & frame.power.notna(),
                        ['available_at_utc', 'power']].sort_values('available_at_utc')
        merged = pd.merge_asof(group.sort_values('forecast_origin_utc'),
                               obs.rename(columns={'power': 'persistence', 'available_at_utc': 'persistence_available_at_utc'}),
                               left_on='forecast_origin_utc', right_on='persistence_available_at_utc', direction='backward')
        persistence.append(merged)
    return pd.concat(persistence, ignore_index=True).dropna(subset=['power', 'wind_speed_100m', 'persistence'])


def train_and_evaluate(frame):
    train = training_rows(frame)
    if train.empty:
        raise ValueError('No training data before cutoff')
    model = HistGradientBoostingRegressor(max_iter=200, learning_rate=0.06,
                                         max_leaf_nodes=20, l2_regularization=1.0,
                                         early_stopping=False, random_state=42,
                                         categorical_features=['turbine_id'])
    with threadpool_limits(limits=4):
        model.fit(build_features(train), train.power)
    curves = fit_power_curves(train)
    validation = validation_pairs(frame)
    validation['model'] = np.clip(model.predict(build_features(validation)), 0, 1)
    validation['power_curve'] = predict_curve(validation, curves)
    metrics = []
    for turbine_id, group in validation.groupby('turbine_id'):
        for method in ('model', 'power_curve', 'persistence'):
            metrics.append({'turbine_id': int(turbine_id), 'method': method, 'n': len(group),
                            'mae': mean_absolute_error(group.power, group[method]),
                            'rmse': float(np.sqrt(mean_squared_error(group.power, group[method])))})
    metadata = {'model_version': MODEL_VERSION, 'train_rows': len(train),
                'train_start_utc': train.time.min().isoformat(),
                'train_last_target_utc': train.time.max().isoformat(),
                'train_last_available_at_utc': train.available_at_utc.max().isoformat(),
                'train_cutoff_exclusive_utc': TRAIN_END.isoformat(),
                'validation_end_exclusive_utc': HISTORY_END.isoformat(),
                'features': list(build_features(train).columns),
                'power_unit': 'normalized_0_1',
                'validation_design': 'daily local midnight origins; h=1..48; common target rows; fixed origin persistence',
                'weather_source': 'Open-Meteo Historical Forecast stitched archive, ecmwf_ifs',
                'run_aware_backtest': False,
                'limitation': 'Stitched weather uses short leads and cannot prove availability at each origin; not a leakage-free 48h forecast score.'}
    return model, curves, pd.DataFrame(metrics), validation, metadata


def fit_asof(frame, output):
    """Same recipe as production, trained only on rows available at the first origin."""
    asof = fit_bundle(frame, ASOF_CUTOFF, ASOF_VERSION)
    joblib.dump(asof, output / 'hgb_asof_model.joblib')
    (output / 'asof_model_metadata.json').write_text(json.dumps(asof['metadata'], indent=2), encoding='utf-8')
    print('As-of:', json.dumps(asof['metadata'], indent=2))
    return asof


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--asof-only', action='store_true',
                        help='Only fit hgb_asof_model.joblib for origin 2026-01-30T19:00Z')
    args = parser.parse_args()
    observations, _ = load_all()
    frame = join_weather(observations, WeatherClient().historical())
    if args.asof_only:
        fit_asof(frame, ROOT / 'outputs')
        return
    model, curves, metrics, validation, metadata = train_and_evaluate(frame)
    output = ROOT / 'outputs'
    joblib.dump({'model': model, 'curves': curves, 'metadata': metadata}, output / 'hgb_validation_model.joblib')
    metrics.to_csv(output / 'validation_metrics.csv', index=False)
    validation.to_parquet(output / 'validation_predictions.parquet', index=False)
    (output / 'validation_model_metadata.json').write_text(json.dumps(metadata, indent=2), encoding='utf-8')
    production = fit_bundle(frame, HISTORY_END, PRODUCTION_VERSION)
    joblib.dump(production, output / 'hgb_model.joblib')
    export_power_curves(production['curves'], output / 'power_curve.csv')
    (output / 'model_metadata.json').write_text(json.dumps(production['metadata'], indent=2), encoding='utf-8')
    fit_asof(frame, output)
    print('Production:', json.dumps(production['metadata'], indent=2))
    print(json.dumps(metadata, indent=2))
    print(metrics.to_string(index=False))


if __name__ == '__main__':
    main()
