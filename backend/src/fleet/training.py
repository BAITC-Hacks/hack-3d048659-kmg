"""Per-turbine autoregression; no fixed archive cutoff or borrowed site weather."""
from datetime import datetime, timedelta
import io
import math

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits

from src.fleet.validation import iso

LAGS = (1, 2, 24, 48)
MIN_TRAIN_ROWS = 48
VALIDATION_HOURS = 24


class InsufficientData(ValueError):
    pass


def features(time, history):
    return [history[time - timedelta(hours=lag)] for lag in LAGS] + [
        math.sin(time.hour * math.tau / 24), math.cos(time.hour * math.tau / 24),
        math.sin(time.weekday() * math.tau / 7), math.cos(time.weekday() * math.tau / 7),
    ]


def estimator():
    return HistGradientBoostingRegressor(max_iter=100, max_leaf_nodes=15,
        l2_regularization=1, early_stopping=False, random_state=42)


def recursive_predict(model, history, start, count):
    history = history.copy()
    predictions = []
    for step in range(count):
        time = start + timedelta(hours=step)
        value = float(np.clip(model.predict([features(time, history)])[0], 0, 1))
        if not math.isfinite(value):
            raise ValueError('Model produced a non-finite forecast.')
        history[time] = value
        predictions.append({'time': iso(time), 'power': value, 'wind': None, 'temperature': None})
    return predictions


def train_and_forecast(points, turbine, revision, job_id):
    history = {datetime.fromisoformat(point['time'].replace('Z', '+00:00')): point['power'] for point in points}
    times = sorted(history)
    if not times:
        raise InsufficientData('Нет измерений. Загрузите почасовую мощность.')
    last = times[-1]
    # A contiguous tail is required for a meaningful recursive holdout and forecast.
    if any(last - timedelta(hours=lag) not in history for lag in range(72)):
        raise InsufficientData('Нужны 72 последовательных часа в конце ряда без пропусков.')
    cutoff = last - timedelta(hours=VALIDATION_HOURS - 1)
    labeled = [time for time in times if all(time - timedelta(hours=lag) in history for lag in LAGS)]
    training = [time for time in labeled if time < cutoff]
    if len(training) < MIN_TRAIN_ROWS:
        raise InsufficientData('Недостаточно данных: нужно не менее 120 последовательных почасовых измерений (5 суток).')
    with threadpool_limits(limits=2):
        validation_model = estimator().fit([features(time, history) for time in training], [history[time] for time in training])
        validation = recursive_predict(validation_model, {time: value for time, value in history.items() if time < cutoff}, cutoff, VALIDATION_HOURS)
        mae = float(np.mean([abs(point['power'] - history[cutoff + timedelta(hours=index)]) for index, point in enumerate(validation)]))
        persistence_mae = float(np.mean([abs(history[cutoff - timedelta(hours=1)] - history[cutoff + timedelta(hours=index)]) for index in range(VALIDATION_HOURS)]))
        model = estimator().fit([features(time, history) for time in labeled], [history[time] for time in labeled])
        # Measurements describe [time, time+1h). This release is made at the end
        # of the latest measured hour. The API forecasts origin+1 .. origin+48.
        origin = last + timedelta(hours=1)
        predicted = recursive_predict(model, history, origin, 49)[1:]
    version = f'ar-hgb-{job_id}'
    metadata = {'id': version, 'turbine': turbine, 'dataRevision': revision, 'calculationId': job_id,
        'method': 'autoregressive', 'trainRows': len(labeled), 'observationCount': len(points),
        'trainStart': iso(times[0]), 'trainThrough': iso(last), 'availableAt': iso(origin),
        'validationStart': iso(cutoff), 'validationHours': VALIDATION_HOURS,
        'validationMae': mae, 'persistenceMae': persistence_mae, 'sklearnVersion': sklearn.__version__,
        'features': ['power_lag_1', 'power_lag_2', 'power_lag_24', 'power_lag_48', 'hour_sin', 'hour_cos', 'weekday_sin', 'weekday_cos']}
    buffer = io.BytesIO()
    joblib.dump({'model': model, 'metadata': metadata}, buffer)
    forecast = {'id': f'{turbine}-{job_id}', 'turbine': turbine, 'issuedAt': iso(origin),
        'weatherIssuedAt': iso(origin), 'weatherAvailableAt': iso(origin), 'horizon': 48,
        'status': 'success', 'reason': 'Прогноз по обновлённым измерениям', 'modelVersion': version,
        'fallbackUsed': False, 'method': 'autoregressive', 'weatherSource': 'Погода не используется: модель по истории мощности',
        'dataRevision': revision, 'calculationId': job_id, 'points': predicted}
    return metadata, buffer.getvalue(), forecast
