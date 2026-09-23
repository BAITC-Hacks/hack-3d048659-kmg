import numpy as np
import pandas as pd
from src.features.join import join_weather, wind_correlations


def test_timezone_shift_detects_five_hour_error():
    times = pd.date_range('2025-01-01', periods=100, freq='h', tz='UTC')
    values = np.random.default_rng(12).normal(size=100)
    weather = pd.DataFrame({'time': times, 'wind_speed_100m': values})
    observations = pd.DataFrame({'time': times + pd.Timedelta(hours=5),
                                 'turbine_id': 1, 'measured_wind': values})
    correlations = wind_correlations(observations, weather)
    best = correlations.loc[correlations.pearson_r.idxmax()]
    assert best.weather_timestamp_shift_h == 5
    assert abs(best.pearson_r - 1) < 1e-10
    assert correlations.paired_hours.nunique() == 1
    assert len(join_weather(observations, weather)) == 100
