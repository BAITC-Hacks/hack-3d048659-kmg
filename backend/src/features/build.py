import numpy as np
import pandas as pd
from src.data.load import LOCAL_TZ

WEATHER_FEATURES = ['wind_speed_100m', 'wind_speed_10m', 'wind_gusts_10m',
                    'temperature_2m', 'surface_pressure']


def build_features(frame):
    features = frame[WEATHER_FEATURES].copy()
    angle = np.deg2rad(frame['wind_direction_100m'])
    features['wind_direction_sin'] = np.sin(angle)
    features['wind_direction_cos'] = np.cos(angle)
    local = frame.time.dt.tz_convert(LOCAL_TZ)
    features['hour_sin'] = np.sin(2 * np.pi * local.dt.hour / 24)
    features['hour_cos'] = np.cos(2 * np.pi * local.dt.hour / 24)
    features['year_sin'] = np.sin(2 * np.pi * local.dt.dayofyear / 365.25)
    features['year_cos'] = np.cos(2 * np.pi * local.dt.dayofyear / 365.25)
    features['turbine_id'] = frame['turbine_id'].astype(int)
    return features
