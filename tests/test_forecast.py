import numpy as np
import pandas as pd
import pytest
from src.agent.forecast import make_forecast, OUTPUT_COLUMNS
from src.weather.client import read_config


class ConstantModel:
    def predict(self, features):
        return np.full(len(features), 0.4)


def inputs():
    config = read_config()
    origin, run = pd.Timestamp('2026-01-30T19:00Z'), pd.Timestamp('2026-01-30T12:00Z')
    weather = pd.DataFrame({'time': pd.date_range(origin + pd.Timedelta(hours=1), periods=48, freq='h'),
                            'weather_run_utc': run,
                            **{v: 5. for v in config['weather_variables']}})
    bundle = {'model': ConstantModel(), 'metadata': {
        'model_version': 'test', 'train_last_available_at_utc': '2025-11-30T19:00Z'}}
    return bundle, weather, origin, run, config


def test_forecast_contract():
    result = make_forecast(*inputs())
    assert list(result) == OUTPUT_COLUMNS
    assert len(result) == 96
    assert result.groupby('turbine_id').size().to_dict() == {1: 48, 2: 48}
    assert result.target_time_utc.min() == '2026-01-30T20:00:00Z'
    assert result.target_time_utc.max() == '2026-02-01T19:00:00Z'
    assert result.predicted_power.eq(0.4).all()


def test_reject_unavailable_run():
    bundle, weather, origin, run, config = inputs()
    with pytest.raises(ValueError, match='not available'):
        make_forecast(bundle, weather, origin, run + pd.Timedelta(hours=6), config)


def test_reject_future_training():
    bundle, weather, origin, run, config = inputs()
    bundle['metadata']['train_last_available_at_utc'] = '2026-01-31T00:00Z'
    with pytest.raises(ValueError, match='unavailable at origin'):
        make_forecast(bundle, weather, origin, run, config)


def test_reject_missing_weather():
    bundle, weather, origin, run, config = inputs()
    weather.loc[0, 'wind_speed_100m'] = np.nan
    with pytest.raises(ValueError, match='missing weather'):
        make_forecast(bundle, weather, origin, run, config)


def test_reject_wrong_run():
    bundle, weather, origin, run, config = inputs()
    weather['weather_run_utc'] = run - pd.Timedelta(hours=6)
    with pytest.raises(ValueError, match='requested run only'):
        make_forecast(bundle, weather, origin, run, config)
