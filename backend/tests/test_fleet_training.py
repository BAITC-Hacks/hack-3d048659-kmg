from datetime import datetime, timedelta, timezone
import io
import math

import joblib
import pytest

from src.api.domain import InvalidRequest
from src.fleet.training import InsufficientData, train_and_forecast
from src.fleet.validation import actuals_payload, windmill_payload, iso


def sample_points(count=168):
    start = datetime(2026, 3, 1, tzinfo=timezone.utc)
    return [{'time': iso(start + timedelta(hours=i)), 'power': 0.4 + 0.3 * math.sin(i / 12)} for i in range(count)]


def test_training_generates_a_real_model_and_48_valid_future_points():
    points = sample_points()
    metadata, artifact, forecast = train_and_forecast(points, 'wt-new', 3, 'test-job')
    restored = joblib.load(io.BytesIO(artifact))
    assert hasattr(restored['model'], 'predict')
    assert restored['metadata'] == metadata
    assert metadata['trainThrough'] == points[-1]['time']
    assert metadata['dataRevision'] == forecast['dataRevision'] == 3
    assert metadata['trainRows'] == len(points) - 48
    assert metadata['validationHours'] == 24
    assert 0 <= metadata['validationMae'] <= 1
    assert forecast['modelVersion'] == metadata['id']
    assert len(forecast['points']) == 48
    origin = datetime.fromisoformat(forecast['issuedAt'].replace('Z', '+00:00'))
    assert origin > datetime.fromisoformat(points[-1]['time'].replace('Z', '+00:00'))
    for index, point in enumerate(forecast['points']):
        assert point['time'] == iso(origin + timedelta(hours=index + 1))
        assert 0 <= point['power'] <= 1
        assert point['wind'] is None and point['temperature'] is None


def test_recursive_validation_never_uses_holdout_labels_as_input():
    points = sample_points()
    first, _, _ = train_and_forecast(points, 'new', 1, 'one')
    for point in points[-24:]:
        point['power'] = 1 - point['power']
    second, _, _ = train_and_forecast(points, 'new', 2, 'two')
    # Validation labels affect the score, while the split and training count stay fixed.
    assert second['validationMae'] != first['validationMae']
    assert second['validationStart'] == first['validationStart']
    assert second['trainRows'] == first['trainRows']


@pytest.mark.parametrize('points', [[], sample_points(119), sample_points()[:-2] + sample_points()[-1:]])
def test_insufficient_or_gapped_data_is_explicit(points):
    with pytest.raises(InsufficientData):
        train_and_forecast(points, 'new', 1, 'test')


def test_actuals_validation_normalizes_hours_and_preserves_zero():
    key, points = actuals_payload({'requestId': 'request-123', 'points': [
        {'time': '2026-03-01T05:00:00+05:00', 'power': 0}]})
    assert key == 'request-123'
    assert points == [{'time': '2026-03-01T00:00:00Z', 'power': 0.0}]


@pytest.mark.parametrize('point', [
    {'time': '2026-03-01T00:00:00Z', 'power': float('nan')},
    {'time': '2026-03-01T00:00:00Z', 'power': True},
    {'time': '2026-03-01T00:00:00Z', 'power': 1.1},
    {'time': '2026-03-01T00:00:00', 'power': .5},
    {'time': '2026-03-01T00:30:00Z', 'power': .5},
    {'time': '2999-03-01T00:00:00Z', 'power': .5},
    {'time': '2026-03-01T00:00:00Z', 'power': .5, 'unwanted': 1},
])
def test_invalid_actuals_are_rejected(point):
    with pytest.raises(InvalidRequest):
        actuals_payload({'requestId': 'request-123', 'points': [point]})


def test_duplicate_instants_are_rejected_before_save():
    with pytest.raises(InvalidRequest):
        actuals_payload({'requestId': 'request-123', 'points': [
            {'time': '2026-03-01T00:00:00Z', 'power': .5},
            {'time': '2026-03-01T05:00:00+05:00', 'power': .6}]})


def test_windmill_validation():
    valid = {'name': '  New windmill  ', 'latitude': 44, 'longitude': 79, 'ratedPowerKw': None}
    assert windmill_payload(valid)['name'] == 'New windmill'
    for change in [{'name': ' '}, {'latitude': 90}, {'longitude': 181}, {'ratedPowerKw': 0}]:
        with pytest.raises(InvalidRequest):
            windmill_payload({**valid, **change})
