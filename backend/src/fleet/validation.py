"""Validate an entire update before opening a database transaction."""
from datetime import datetime, timezone, timedelta
import math
import re

from src.api.domain import InvalidRequest

MAX_POINTS = 10000


def utc_now():
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def invalid(message):
    raise InvalidRequest('invalid_request', message)


def finite_number(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        invalid(f'{label} must be a finite number between {low} and {high}.')
    return float(value)


def windmill_payload(payload):
    fields = {'name', 'latitude', 'longitude', 'ratedPowerKw'}
    if not isinstance(payload, dict) or set(payload) != fields:
        invalid('Provide name, latitude, longitude, and ratedPowerKw.')
    name = payload['name']
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or any(ord(c) < 32 for c in name):
        invalid('Name must contain 1–80 printable characters.')
    return {'name': name.strip(),
            'latitude': finite_number(payload['latitude'], -85, 85, 'Latitude'),
            'longitude': finite_number(payload['longitude'], -180, 180, 'Longitude'),
            'ratedPowerKw': None if payload['ratedPowerKw'] is None else finite_number(payload['ratedPowerKw'], 0.001, 1000000, 'Rated power')}


def actuals_payload(payload, now=None):
    if not isinstance(payload, dict) or set(payload) != {'requestId', 'points'}:
        invalid('Provide requestId and points.')
    key = payload['requestId']
    if not isinstance(key, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{8,80}', key):
        invalid('requestId must contain 8–80 letters, digits, hyphens, or underscores.')
    points = payload['points']
    if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS:
        invalid(f'Provide 1–{MAX_POINTS} hourly measurements per update.')
    now, result, seen = now or utc_now(), [], set()
    for index, point in enumerate(points):
        if not isinstance(point, dict) or set(point) != {'time', 'power'}:
            invalid(f'Row {index + 1}: provide time and normalized power.')
        try:
            if not isinstance(point['time'], str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.0+)?(?:Z|[+-]\d{2}:\d{2})', point['time']):
                raise ValueError()
            time = datetime.fromisoformat(point['time'].replace('Z', '+00:00')).astimezone(timezone.utc)
            if time.minute or time.second or time.microsecond or time.year < 2000:
                raise ValueError()
        except (ValueError, TypeError, OverflowError):
            invalid(f'Row {index + 1}: time must be a whole-hour ISO timestamp with timezone (year 2000 or later).')
        if time + timedelta(hours=1) > now:
            invalid(f'Row {index + 1}: the measurement hour has not finished yet.')
        if time in seen:
            invalid(f'Row {index + 1}: duplicate measurement hour.')
        seen.add(time)
        result.append({'time': iso(time), 'power': finite_number(point['power'], 0, 1, f'Row {index + 1} power')})
    return key, sorted(result, key=lambda point: point['time'])
