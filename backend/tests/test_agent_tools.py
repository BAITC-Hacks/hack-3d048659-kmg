import json

import numpy as np
import pandas as pd
import pytest
import requests

from src.agent.tools import (iso, load_bundle, reforecast, save_forecast,
                             select_weather_run, validate_forecast)
from src.data.load import LOCAL_TZ, HISTORY_END, ROOT
from src.weather.client import WeatherClient, read_config

ORIGIN = pd.Timestamp('2026-02-01T19:00Z')


class ConstantModel:
    def predict(self, features):
        return np.full(len(features), 0.4)


@pytest.fixture
def bundle():
    return {'model': ConstantModel(),
            'curves': {i: (np.array([0.25, 5.25, 10.25]), np.array([0., 0.3, 1.])) for i in (1, 2)},
            'metadata': {'model_version': 'test-model', 'train_last_available_at_utc': '2025-12-31T19:00Z'}}


class FakeWeather:
    def __init__(self, missing_primary=False, partial=False, missing_all=False, missing_wind=False):
        self.calls = []
        self.missing_primary = missing_primary
        self.partial = partial
        self.missing_all = missing_all
        self.missing_wind = missing_wind

    def single_run(self, run):
        timestamp = pd.Timestamp(run)
        self.calls.append(timestamp)
        if self.missing_all or (self.missing_primary and len(self.calls) == 1):
            raise requests.HTTPError('Archive run missing (mock)')
        frame = pd.DataFrame({'time': pd.date_range(ORIGIN + pd.Timedelta(hours=1), periods=48, freq='h'),
                              'weather_run_utc': timestamp,
                              **{v: 5.25 for v in read_config()['weather_variables']}})
        if self.partial:
            frame.loc[0, 'temperature_2m'] = np.nan
        if self.missing_wind:
            frame.loc[0, 'wind_speed_100m'] = np.nan
        return frame


def run_with(bundle, tmp_path, client, **kwargs):
    return reforecast(ORIGIN, bundle=bundle, client=client, save=False,
                      log_path=tmp_path / 'runs.jsonl', **kwargs)


@pytest.mark.parametrize('origin,expected', [
    ('2026-01-30T19:00Z', '2026-01-30T12:00Z'),
    ('2026-01-30T18:00Z', '2026-01-30T12:00Z'),
    ('2026-01-30T17:59Z', '2026-01-30T06:00Z'),
    ('2026-01-30T06:00Z', '2026-01-30T00:00Z'),
    ('2026-01-30T05:59Z', '2026-01-29T18:00Z'),
    ('2026-01-30T00:00Z', '2026-01-29T18:00Z'),
    ('2026-01-31T00:00+05:00', '2026-01-30T12:00Z'),
])
def test_select_latest_available_cycle(origin, expected):
    run = select_weather_run(origin)
    assert run == pd.Timestamp(expected)
    assert run + pd.Timedelta(hours=6) <= pd.Timestamp(origin)
    assert run + pd.Timedelta(hours=12) > pd.Timestamp(origin)


def test_reject_naive_origin():
    with pytest.raises(ValueError, match='timezone'):
        select_weather_run('2026-01-30T19:00')


def test_missing_primary_uses_previous_cycle(bundle, tmp_path):
    client = FakeWeather(missing_primary=True)
    result = run_with(bundle, tmp_path, client)
    assert client.calls == [select_weather_run(ORIGIN), select_weather_run(ORIGIN) - pd.Timedelta(hours=6)]
    assert result.fallback_used.eq('true').all()
    assert result.weather_run_utc.eq(iso(client.calls[-1])).all()
    assert result.model_version.eq('test-model').all()
    assert validate_forecast(result)
    logs = [json.loads(line) for line in (tmp_path / 'runs.jsonl').read_text().splitlines()]
    assert any(log['status'] == 'failed' for log in logs)
    assert all(set(log) == {'ts', 'origin_utc', 'step', 'status', 'message', 'weather_run', 'fallback'} for log in logs)


def test_simulated_missing_run_skips_selected_cycle_and_marks_logs(bundle, tmp_path):
    client = FakeWeather()
    result = run_with(bundle, tmp_path, client, simulate_missing_run=True)
    assert client.calls == [select_weather_run(ORIGIN) - pd.Timedelta(hours=6)]
    assert result.fallback_used.eq('true').all()
    logs = [json.loads(line) for line in (tmp_path / 'runs.jsonl').read_text().splitlines()]
    assert all(log['fallback'] for log in logs)
    assert any('Simulated' in log['message'] for log in logs)


def test_simulation_cli_uses_separate_file(monkeypatch, tmp_path, bundle):
    import sys
    import src.agent.run as cli
    called = {}
    def fake_run(origin, **kwargs):
        called.update(kwargs)
        return run_with(bundle, tmp_path, FakeWeather(), simulate_missing_run=True)
    monkeypatch.setattr(cli, 'reforecast', fake_run)
    monkeypatch.setattr(cli, 'load_all', lambda: (pd.DataFrame(), []))
    monkeypatch.setattr(sys, 'argv', ['run', '--origin', iso(ORIGIN), '--simulate-missing-run'])
    cli.main()
    assert called['output_path'].name == 'forecasts_fallback_demo.csv'
    assert called['simulate_missing_run'] is True


def test_partial_runs_use_newest_wind_power_curve(bundle, tmp_path):
    client = FakeWeather(partial=True)
    result = run_with(bundle, tmp_path, client)
    assert len(client.calls) == 2
    assert result.weather_run_utc.eq(iso(client.calls[0])).all()
    assert result.fallback_used.eq('true').all()
    assert result.model_version.str.endswith('-power_curve').all()
    np.testing.assert_allclose(result.predicted_power, 0.3)


@pytest.mark.parametrize('client', [FakeWeather(missing_all=True), FakeWeather(partial=True, missing_wind=True)])
def test_last_resort_persistence_does_not_use_future(bundle, tmp_path, client):
    observations = pd.DataFrame({
        'turbine_id': [1, 1, 2, 2],
        'time': [ORIGIN - pd.Timedelta(days=2), ORIGIN, ORIGIN - pd.Timedelta(days=2), ORIGIN],
        'available_at_utc': [ORIGIN - pd.Timedelta(days=2) + pd.Timedelta(hours=1), ORIGIN + pd.Timedelta(hours=1)] * 2,
        'power': [0.2, 0.99, 0.3, 0.99],
    })
    result = run_with(bundle, tmp_path, client, observations=observations)
    assert result.model_version.str.endswith('-persistence').all()
    assert result.fallback_used.eq('true').all()
    assert result.groupby('turbine_id').predicted_power.first().to_dict() == {1: 0.2, 2: 0.3}
    assert validate_forecast(result)


@pytest.mark.parametrize('defect', ['nan', 'out_of_bounds', 'duplicate', 'missing_horizon',
                                    'unavailable_run', 'target', 'no_z', 'missing_turbine', 'extra_column'])
def test_validate_rejects_invalid_forecasts(bundle, tmp_path, defect):
    result = run_with(bundle, tmp_path, FakeWeather())
    if defect == 'nan':
        result.loc[0, 'predicted_power'] = np.nan
    elif defect == 'out_of_bounds':
        result.loc[0, 'predicted_power'] = 1.01
    elif defect == 'duplicate':
        result = pd.concat([result, result.iloc[[0]]], ignore_index=True)
    elif defect == 'missing_horizon':
        result = result.iloc[1:]
    elif defect == 'unavailable_run':
        result.loc[0, 'weather_run_utc'] = iso(ORIGIN.floor('6h'))
    elif defect == 'target':
        result.loc[0, 'target_time_utc'] = iso(ORIGIN)
    elif defect == 'no_z':
        result.loc[0, 'target_time_utc'] = '2026-02-01T20:00:00+00:00'
    elif defect == 'missing_turbine':
        result = result.loc[result.turbine_id == 1]
    else:
        result['extra'] = 1
    with pytest.raises(ValueError):
        validate_forecast(result)


def test_upsert_replaces_values_without_duplicate_rows(bundle, tmp_path):
    result = run_with(bundle, tmp_path, FakeWeather())
    path = tmp_path / 'forecasts.csv'
    save_forecast(result, path)
    result['predicted_power'] = 0.6
    combined = save_forecast(result, path)
    assert len(combined) == 96
    assert combined.predicted_power.eq(0.6).all()


def test_model_availability_guard_precedes_weather(bundle, tmp_path):
    bundle['metadata']['train_last_available_at_utc'] = '2026-02-02T19:00Z'
    client = FakeWeather()
    with pytest.raises(ValueError, match='unavailable at origin'):
        run_with(bundle, tmp_path, client)
    assert not client.calls


def test_production_model_not_used_before_cutoff():
    early = load_bundle('2026-01-30T19:00Z')
    production = load_bundle(HISTORY_END)
    assert early['metadata']['model_version'] in ('hgb-v2-asof-20260131', 'hgb-v1-train-before-20251201')
    assert pd.Timestamp(early['metadata']['train_last_available_at_utc']) <= pd.Timestamp('2026-01-30T19:00Z')
    assert production['metadata']['model_version'] == 'hgb-v2-train-before-20260201'
    assert pd.Timestamp(production['metadata']['train_last_available_at_utc']) <= HISTORY_END


def test_all_backtest_runs_available_offline(monkeypatch):
    def reject_network(*args, **kwargs):
        raise AssertionError('Committed run cache must satisfy backtest offline')
    monkeypatch.setattr(requests.Session, 'get', reject_network)
    client = WeatherClient()
    origins = pd.date_range('2026-01-31', '2026-02-28', tz=LOCAL_TZ).tz_convert('UTC')
    for origin in origins:
        frame = client.single_run(select_weather_run(origin).isoformat())
        assert len(frame) >= 48


def test_real_agent_offline_matches_saved_forecast(tmp_path, monkeypatch):
    def reject_network(*args, **kwargs):
        raise AssertionError('No network expected')
    monkeypatch.setattr(requests.Session, 'get', reject_network)
    origin = '2026-02-27T19:00Z'
    generated = reforecast(origin, save=False, log_path=tmp_path / 'runs.jsonl')
    stored = pd.read_csv(ROOT / 'outputs/forecasts.csv', dtype={'fallback_used': str})
    stored = stored.loc[stored.forecast_origin_utc == iso(origin)].sort_values(['turbine_id', 'horizon_h'])
    np.testing.assert_allclose(generated.predicted_power, stored.predicted_power, atol=0.00000051)
