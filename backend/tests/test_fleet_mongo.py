"""Integration checks use a real replica set and an isolated disposable database.

Set MONGODB_TEST_URI to opt in. No production database is modified.
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import os
import json
from uuid import uuid4

import pytest
from pymongo import MongoClient

from src.api.domain import InvalidRequest
from src.fleet.repository import FleetRepository
from src.fleet.tasks import execute_training
from src.fleet.training import train_and_forecast
from src.fleet.validation import iso, utc_now
from src.fleet.service import FleetService
from test_api import running_server, request
from test_fleet_training import sample_points


@pytest.fixture
def repository():
    uri = os.environ.get('MONGODB_TEST_URI')
    if not uri:
        pytest.skip('Set MONGODB_TEST_URI to run real MongoDB integration checks.')
    client = MongoClient(uri, serverSelectionTimeoutMS=5000)
    database = 'windfarm_test_' + uuid4().hex
    repo = FleetRepository(client, database)
    repo.initialize()
    yield repo
    assert database.startswith('windfarm_test_')
    client.drop_database(database)
    client.close()


def new_site(repo):
    return repo.create_turbine({'name': 'Integration windmill', 'latitude': 44, 'longitude': 79, 'ratedPowerKw': 2000})['id']


def upload(repo, site, points=None, request_id=None):
    return repo.import_actuals(site, {'requestId': request_id or uuid4().hex, 'points': points or sample_points()})


def test_import_is_atomic_idempotent_and_preserves_unedited_hours(repository):
    site = new_site(repository)
    result = upload(repository, site, request_id='test-request')
    assert upload(repository, site, request_id='test-request') == result
    assert repository.db.calculations.count_documents({}) == 1
    assert upload(repository, site)['changed'] == 0
    changed = upload(repository, site, [{**sample_points()[0], 'power': 0}])
    assert changed['changed'] == 1 and changed['dataRevision'] == 2
    assert repository.db.actuals.count_documents({}) == 168
    assert repository.workspace()['observations'][0]['points'][0]['power'] == 0
    with pytest.raises(InvalidRequest):
        upload(repository, site, [{**sample_points()[0], 'power': 0}], request_id='test-request')
    assert repository.require_turbine(site)['dataRevision'] == 2


def test_invalid_or_unknown_import_cannot_partially_save(repository):
    site = new_site(repository)
    with pytest.raises(InvalidRequest):
        upload(repository, site, sample_points() + [{'time': 'bad', 'power': .5}])
    with pytest.raises(InvalidRequest):
        upload(repository, 'missing')
    assert repository.db.actuals.count_documents({}) == 0
    assert repository.db.calculations.count_documents({}) == 0


def test_http_registry_import_training_and_calculation_routes(repository):
    with running_server(FleetService(repository, seed=False)) as server:
        headers = {'Content-Type': 'application/json', 'Origin': f'http://127.0.0.1:{server.server_port}'}
        status, _, site = request(server, 'POST', '/api/turbines', json.dumps(
            {'name': 'HTTP windmill', 'latitude': 44, 'longitude': 79, 'ratedPowerKw': None}), headers)
        assert status == 200
        path = '/api/turbines/' + site['id']
        body = json.dumps({'requestId': 'http-upload', 'points': sample_points()})
        status, _, uploaded = request(server, 'POST', path + '/actuals', body, headers)
        assert status == 200 and uploaded['changed'] == 168
        status, _, queued = request(server, 'POST', path + '/train', '{}', headers)
        assert status == 200 and queued['id'] == uploaded['jobId']
        execute_training(repository, queued['id'])
        status, _, job = request(server, 'GET', '/api/calculations/' + queued['id'])
        assert status == 200 and job['status'] == 'succeeded'
        listed = request(server, 'GET', '/api/calculations?turbine=' + site['id'])[2]
        assert listed['calculations'][0]['id'] == queued['id']
        workspace = request(server, 'GET', '/api/workspace')[2]
        assert workspace['runs'][0]['id'] == job['forecastId']
        assert workspace['turbines'][0]['modelRevision'] == 1
        assert request(server, 'POST', path + '/actuals', '{"points": []}', headers)[0] == 422


def test_worker_publishes_versioned_model_and_forecast_once(repository):
    site = new_site(repository)
    result = upload(repository, site)
    execute_training(repository, result['jobId'])
    execute_training(repository, result['jobId'])
    assert repository.job(result['jobId'])['status'] == 'succeeded'
    assert repository.db.models.count_documents({}) == repository.db.forecasts.count_documents({}) == 1
    assert repository.require_turbine(site)['modelRevision'] == 1
    assert len(repository.workspace()['runs'][0]['points']) == 48
    revised = upload(repository, site, [{**sample_points()[0], 'power': .9}])
    execute_training(repository, revised['jobId'])
    assert repository.require_turbine(site)['modelRevision'] == 2
    assert repository.db.models.count_documents({}) == repository.db.forecasts.count_documents({}) == 2


def test_update_during_training_cannot_publish_stale_model(repository):
    site = new_site(repository)
    result = upload(repository, site)
    job = repository.claim(result['jobId'])
    points = repository.training_snapshot(job)
    trained = train_and_forecast(points, site, 1, job['id'])
    upload(repository, site, [{**sample_points()[0], 'power': .99}])
    repository.finish(job, 'succeeded', 'done', trained)
    assert repository.job(job['id'])['status'] == 'superseded'
    assert repository.db.models.count_documents({}) == repository.db.forecasts.count_documents({}) == 0
    assert repository.require_turbine(site)['trainingStatus'] == 'queued'


def test_worker_failures_and_insufficient_data_are_visible(repository, monkeypatch):
    site = new_site(repository)
    result = upload(repository, site, sample_points(1))
    execute_training(repository, result['jobId'])
    assert repository.job(result['jobId'])['status'] == 'needs_data'
    result = upload(repository, site)
    def fail(*args):
        raise RuntimeError('test failure')
    monkeypatch.setattr('src.fleet.tasks.train_and_forecast', fail)
    execute_training(repository, result['jobId'])
    assert repository.job(result['jobId'])['status'] == 'failed'
    assert repository.db.forecasts.count_documents({}) == 0


def test_concurrent_imports_serialize_revisions(repository):
    site = new_site(repository)
    upload(repository, site)
    with ThreadPoolExecutor(max_workers=2) as pool:
        updates = list(pool.map(lambda index: upload(repository, site,
            [{**sample_points()[index], 'power': .9}]), [0, 1]))
    assert sorted(item['dataRevision'] for item in updates) == [2, 3]
    assert repository.require_turbine(site)['dataRevision'] == 3
    assert repository.db.calculations.count_documents({}) == 3


def test_concurrent_retries_return_one_receipt_and_one_job(repository):
    site = new_site(repository)
    for request_id in ('initial-retries', 'unchanged-retries'):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: upload(repository, site, request_id=request_id), range(4)))
        assert all(result == results[0] for result in results)
    assert repository.db.imports.count_documents({}) == 2
    assert repository.db.calculations.count_documents({}) == 1
    assert repository.require_turbine(site)['dataRevision'] == 1


def test_durable_outbox_and_worker_lease_recovery(repository):
    site = new_site(repository)
    result = upload(repository, site)
    assert repository.dispatchable() == [result['jobId']]
    assert repository.dispatchable() == []
    job = repository.claim(result['jobId'])
    assert repository.claim(result['jobId']) is None
    repository.db.calculations.update_one({'id': job['id']}, {'$set': {'leaseUntil': iso(utc_now() - timedelta(seconds=1))}})
    assert repository.dispatchable() == [job['id']]
    reclaimed = repository.claim(job['id'])
    repository.finish(job, 'failed', 'obsolete worker')
    assert repository.job(job['id'])['status'] == 'running'
    repository.finish(reclaimed, 'failed', 'current worker')
    assert repository.job(job['id'])['status'] == 'failed'
