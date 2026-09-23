import numpy as np
import pandas as pd
from src.features.build import build_features
from src.model.train import TRAIN_END, training_rows, validation_pairs, fit_power_curves, predict_curve


def test_no_future_target_enters_training_or_persistence():
    times = pd.date_range(TRAIN_END - pd.Timedelta(hours=2), periods=80, freq='h')
    frame = pd.DataFrame({'time': times, 'available_at_utc': times + pd.Timedelta(hours=1),
                          'turbine_id': 1, 'power': np.arange(80) / 100,
                          'measured_wind': 5., 'wind_speed_100m': 5.})
    train = training_rows(frame)
    assert len(train) == 2
    valid = validation_pairs(frame)
    first_origin = valid.loc[valid.forecast_origin_utc == TRAIN_END]
    assert first_origin.persistence.nunique() == 1
    assert first_origin.persistence.iloc[0] == 0.01
    assert (valid.persistence_available_at_utc <= valid.forecast_origin_utc).all()
    assert set(first_origin.horizon_h) == set(range(1, 49))


def test_features_exclude_measured_future_and_encode_direction():
    frame = pd.DataFrame({'time': pd.date_range('2026-01-01', periods=2, freq='h', tz='UTC'),
                          'turbine_id': [1, 2], 'power': [0.1, 0.9], 'measured_wind': [99, 99],
                          'wind_speed_100m': [5, 5], 'wind_speed_10m': [3, 3],
                          'wind_gusts_10m': [6, 6], 'temperature_2m': [2, 2],
                          'surface_pressure': [950, 950], 'wind_direction_100m': [0, 360]})
    features = build_features(frame)
    assert 'power' not in features and 'measured_wind' not in features
    np.testing.assert_allclose(features.wind_direction_sin, [0, 0], atol=1e-10)
    np.testing.assert_allclose(features.wind_direction_cos, [1, 1])


def test_empirical_curve_uses_bin_median():
    train = pd.DataFrame({'turbine_id': [1, 1, 1], 'measured_wind': [5.1, 5.2, 5.3],
                          'power': [0.2, 0.3, 0.9]})
    curve = fit_power_curves(train)
    pred = predict_curve(pd.DataFrame({'turbine_id': [1], 'wind_speed_100m': [5.25]}), curve)
    assert pred.iloc[0] == 0.3
