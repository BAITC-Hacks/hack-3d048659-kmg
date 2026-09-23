"""Exercise the HTTP boundary, real archive, and isolated recalculation storage."""
import hashlib
import json
import shutil
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.client import HTTPConnection
from threading import Thread

import pandas as pd
import pytest
import requests

from src.api.server import MAX_BODY_BYTES, make_server
from src.api.application import ForecastService
from src.api.domain import InvalidRequest, WEATHER_SOURCE
from src.api.infrastructure import ExistingForecastEngine, FilesystemForecastRepository
from src.data.load import ROOT

ORIGIN = '2026-01-30T19:00:00Z'


def make_service(root=ROOT, runtime_dir=None):
    repository = FilesystemForecastRepository(root, runtime_dir)
    return ForecastService(repository, ExistingForecastEngine(repository))


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def reject(*args, **kwargs):
        raise AssertionError('This API test must use archived/local data only')
    monkeypatch.setattr(requests.Session, 'get', reject)


@pytest.fixture
def archive(tmp_path):
    root = tmp_path / 'backend'
    (root / 'outputs').mkdir(parents=True)
    frame = pd.read_csv(ROOT / 'outputs/forecasts.csv', dtype={'fallback_used': str})
    frame.loc[frame.forecast_origin_utc == ORIGIN].to_csv(root / 'outputs/forecasts.csv', index=False)
    shutil.copyfile(ROOT / 'outputs/actuals_jan.csv', root / 'outputs/actuals_jan.csv')
    return root


def test_real_saved_workspace_is_offline_and_matches_artifacts(tmp_path):
    service = make_service(runtime_dir=tmp_path / 'runtime')
    workspace = service.workspace()
    assert len(workspace['runs']) == 58
    assert {run['turbine'] for run in workspace['runs']} == {'t1', 't2'}
    assert all(len(run['points']) == 48 for run in workspace['runs'])
    assert all(run['status'] == 'success' and not run['fallbackUsed'] for run in workspace['runs'])
    assert workspace['meta'] == {'weatherSource': WEATHER_SOURCE, 'availabilityDelayHours': 6,
                                 'actualsThrough': '2026-01-31T18:00:00Z'}
    first = workspace['runs'][0]
    assert first['issuedAt'] == ORIGIN
    assert first['points'][0]['power'] == pytest.approx(0.568589)
    assert first['weatherAvailableAt'] == '2026-01-30T18:00:00Z'
    cached = service.repository.cached_weather(first['weatherIssuedAt'])
    target = cached.loc[cached.time == pd.Timestamp(first['points'][0]['time'])].iloc[0]
    assert first['points'][0]['wind'] == target.wind_speed_100m
    assert first['points'][0]['temperature'] == target.temperature_2m
    assert all(batch['updatedAt'] == '2026-01-31T19:00:00Z' for batch in workspace['observations'])
    assert all(point['time'] < '2026-01-31T19:00:00Z'
               for batch in workspace['observations'] for point in batch['points'])
    json.dumps(workspace, allow_nan=False)
    assert not service.repository.runtime_dir.exists()


def test_missing_weather_stays_null_without_network(archive):
    workspace = make_service(root=archive).workspace()
    assert all(point['wind'] is None and point['temperature'] is None
               for run in workspace['runs'] for point in run['points'])
    assert all(isinstance(point['power'], float) for run in workspace['runs'] for point in run['points'])
    assert not (archive / '.runtime').exists()


def test_real_engine_recalculates_offline_into_isolated_runtime(tmp_path):
    service = make_service(runtime_dir=tmp_path / 'runtime')
    artifacts = [ROOT / 'outputs/forecasts.csv', ROOT / 'outputs/agent_runs.jsonl']
    before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in artifacts}
    origin = '2026-02-27T19:00:00Z'
    workspace = service.recalculate({'origin': origin})
    recalculated = [run for run in workspace['runs'] if run['issuedAt'] == origin]
    saved = pd.read_csv(ROOT / 'outputs/forecasts.csv')
    assert len(recalculated) == 2
    for run in recalculated:
        expected = saved.loc[(saved.forecast_origin_utc == origin)
                             & (saved.turbine_id == int(run['turbine'][1:]))].sort_values('horizon_h')
        assert [point['power'] for point in run['points']] == pytest.approx(expected.predicted_power.tolist(), abs=0.00000051)
        assert all(point['wind'] is not None and point['temperature'] is not None for point in run['points'])
    assert (tmp_path / 'runtime/forecasts.json').exists()
    assert (tmp_path / 'runtime/agent_runs.jsonl').exists()
    assert all(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in before.items())


def test_cache_metadata_must_match_actual_forecast_run(archive):
    cache = archive / 'data/weather_cache'
    cache.mkdir(parents=True)
    source = next((ROOT / 'data/weather_cache').glob('run_20260130T1200_*.json'))
    metadata = json.loads(source.read_text(encoding='utf-8'))
    metadata['request']['run'] = '2026-01-29T12:00'
    (cache / source.name).write_text(json.dumps(metadata), encoding='utf-8')
    shutil.copyfile(source.with_suffix('.parquet'), (cache / source.name).with_suffix('.parquet'))
    assert FilesystemForecastRepository(root=archive).cached_weather('2026-01-30T12:00:00Z') is None


@pytest.mark.parametrize('payload', [None, [], {}, {'origin': 42}, {'origin': ORIGIN, 'extra': 1},
    {'origin': '2026-01-30T19:00'}, {'origin': 'garbage'}, {'origin': 'NaT'},
    {'origin': '2026-01-30T19:00:00.000001Z'}, {'origin': '2026-01-30T19:00:00.000000001Z'},
    {'origin': '2026-01-29T19:00:00Z'},
    {'origin': '2026-02-28T19:00:00Z'}, {'origin': '2026-01-30T20:00:00Z'}])
def test_reject_invalid_or_unknown_origins(archive, payload):
    with pytest.raises(InvalidRequest) as error:
        make_service(root=archive).recalculate(payload)
    assert error.value.code in {'invalid_request', 'invalid_origin', 'unknown_origin'}
    assert not (archive / '.runtime').exists()


def fake_reforecast(archive, monkeypatch, method='model'):
    calls = []
    def run(origin, **kwargs):
        calls.append((origin, kwargs))
        frame = pd.read_csv(archive / 'outputs/forecasts.csv', dtype={'fallback_used': str})
        frame['predicted_power'] = 0.42
        frame['model_version'] = 'test-model' + (f'-{method}' if method != 'model' else '')
        frame['fallback_used'] = 'true' if method != 'model' else 'false'
        weather = pd.DataFrame({'time': pd.to_datetime(frame.target_time_utc.unique(), utc=True),
                                'wind_speed_100m': 7.25, 'temperature_2m': float('nan')})
        return frame, {'method': method, 'weather': weather, 'fallback': method != 'model'}
    monkeypatch.setattr('src.api.infrastructure.reforecast', run)
    return calls


def test_recalculation_upserts_both_turbines_persists_weather_and_preserves_archive(archive, monkeypatch):
    calls = fake_reforecast(archive, monkeypatch)
    before = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in archive.rglob('*') if path.is_file()}
    service = make_service(root=archive)
    first = service.recalculate({'origin': '2026-01-31T00:00:00+05:00'})
    second = service.recalculate({'origin': ORIGIN})
    assert first == second == make_service(root=archive).workspace()
    assert len(first['runs']) == 2
    assert all(run['modelVersion'] == 'test-model' for run in first['runs'])
    assert all(point['power'] == 0.42 and point['wind'] == 7.25 and point['temperature'] is None
               for run in first['runs'] for point in run['points'])
    assert all(origin == ORIGIN and kwargs['save'] is False and kwargs['return_context'] is True
               and kwargs['log_path'] == archive / '.runtime/agent_runs.jsonl' for origin, kwargs in calls)
    assert all(hashlib.sha256(path.read_bytes()).hexdigest() == digest for path, digest in before.items())
    assert not (archive / '.runtime/forecasts.tmp').exists()


def test_persistence_does_not_claim_weather_inputs(archive, monkeypatch):
    fake_reforecast(archive, monkeypatch, method='persistence')
    workspace = make_service(root=archive).recalculate({'origin': ORIGIN})
    assert all(run['fallbackUsed'] and run['method'] == 'persistence' for run in workspace['runs'])
    assert all(point['wind'] is None and point['temperature'] is None
               for run in workspace['runs'] for point in run['points'])


def test_concurrent_recalculations_preserve_valid_store(archive, monkeypatch):
    calls = fake_reforecast(archive, monkeypatch)
    service = make_service(root=archive)
    with ThreadPoolExecutor(max_workers=3) as executor:
        results = list(executor.map(lambda _: service.recalculate({'origin': ORIGIN}), range(3)))
    assert len(calls) == 3
    assert all(result == results[0] for result in results)
    assert len(json.loads((archive / '.runtime/forecasts.json').read_text(encoding='utf-8'))) == 2


def test_application_uses_injected_ports_and_does_not_save_failed_forecasts():
    events = []
    result = {'runs': [], 'observations': [], 'meta': {'weatherSource': WEATHER_SOURCE,
              'availabilityDelayHours': 6, 'actualsThrough': None}}
    class MemoryRepository:
        def allowed_origins(self):
            events.append('origins')
            return {ORIGIN}
        def save_forecasts(self, runs):
            events.append(('save', runs))
        def workspace(self):
            events.append('workspace')
            return result
    class Engine:
        failed = False
        def forecast(self, origin):
            events.append(('forecast', origin))
            if self.failed:
                raise RuntimeError('Engine failed')
            return []
    engine = Engine()
    service = ForecastService(MemoryRepository(), engine)
    assert service.recalculate({'origin': '2026-01-31T00:00+05:00'}) == result
    assert events == ['origins', ('forecast', ORIGIN), ('save', []), 'workspace']
    engine.failed = True
    events.clear()
    with pytest.raises(RuntimeError, match='Engine failed'):
        service.recalculate({'origin': ORIGIN})
    assert events == ['origins', ('forecast', ORIGIN)]


@contextmanager
def running_server(service):
    server = make_server(port=0, service=service)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def request(server, method, path, body=None, headers=None):
    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=5)
    try:
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.getheader('Content-Type'), json.loads(response.read())
    finally:
        connection.close()


@pytest.mark.parametrize('disconnect', [BrokenPipeError, ConnectionResetError, ConnectionAbortedError])
@pytest.mark.parametrize('fail_on_write', [1, 2])
def test_cancelled_response_does_not_retry_or_log_backend_failure(disconnect, fail_on_write, caplog):
    class DisconnectedStream:
        writes = []
        def write(self, data):
            self.writes.append(data)
            if len(self.writes) == fail_on_write:
                raise disconnect('Client cancelled the request')
    with make_server(port=0, service=object()) as server:
        handler = object.__new__(server.RequestHandlerClass)
        handler.request_version = 'HTTP/1.1'
        handler.command = 'GET'
        handler.log_request = lambda *args: None
        handler.wfile = DisconnectedStream()
        handler._dispatch(lambda: {'status': 'ok'})
        assert len(handler.wfile.writes) == fail_on_write
        assert b'200 OK' in handler.wfile.writes[0]
        assert not caplog.records
        # Serialization errors still propagate before socket writes begin.
        with pytest.raises(TypeError):
            handler._respond(200, {'invalid': object()})


def test_http_routes_recalculate_and_json_errors(archive, monkeypatch):
    fake_reforecast(archive, monkeypatch)
    service = make_service(root=archive)
    with running_server(service) as server:
        assert request(server, 'GET', '/api/health')[2] == {'status': 'ok'}
        status, content_type, payload = request(server, 'GET', '/api/workspace')
        assert status == 200 and content_type == 'application/json; charset=utf-8'
        assert len(payload['runs']) == 2
        headers = {'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{server.server_port}'}
        assert request(server, 'POST', '/api/forecasts', json.dumps({'origin': ORIGIN}), headers)[0] == 200
        assert request(server, 'POST', '/api/forecasts', '{', headers)[0] == 400
        assert request(server, 'POST', '/api/forecasts', '{}', headers)[0] == 422
        assert request(server, 'POST', '/api/forecasts', '{}')[0] == 415
        assert request(server, 'POST', '/api/forecasts', ' ' * (MAX_BODY_BYTES + 1), headers)[0] == 413
        headers['Origin'] = 'https://unrelated.example'
        assert request(server, 'POST', '/api/forecasts', '{}', headers)[0] == 403
        assert request(server, 'GET', '/api/missing')[0] == 404
        assert request(server, 'DELETE', '/api/forecasts')[0] == 405
        def broken():
            raise RuntimeError('private implementation detail')
        monkeypatch.setattr(service, 'workspace', broken)
        status, _, payload = request(server, 'GET', '/api/workspace')
        assert status == 500 and payload['error']['code'] == 'backend_error'
        assert 'private implementation detail' not in json.dumps(payload)
