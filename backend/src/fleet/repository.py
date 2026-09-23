"""MongoDB transactions couple actual revisions, outbox jobs, and model publication."""
from datetime import timedelta
import hashlib
import json
import os
from uuid import uuid4

from bson.binary import Binary
from pymongo import MongoClient, ReturnDocument, UpdateOne
from pymongo.errors import DuplicateKeyError
from pymongo.read_concern import ReadConcern
from pymongo.write_concern import WriteConcern

from src.api.domain import InvalidRequest, WEATHER_SOURCE
from src.fleet.validation import actuals_payload, windmill_payload, utc_now, iso

PUBLIC_JOB = {'_id': 0, 'lease': 0, 'leaseUntil': 0, 'nextDispatch': 0}


class FleetRepository:
    def __init__(self, client=None, database=None):
        self.client = client if client is not None else MongoClient(
            os.environ.get('MONGODB_URI', 'mongodb://127.0.0.1:27017/?replicaSet=rs0'),
            serverSelectionTimeoutMS=5000, tz_aware=True)
        self.db = self.client[database or os.environ.get('MONGODB_DATABASE', 'windfarm')]

    def transaction(self, callback):
        with self.client.start_session() as session:
            return session.with_transaction(callback, read_concern=ReadConcern('snapshot'),
                                            write_concern=WriteConcern('majority'))

    def initialize(self):
        self.db.turbines.create_index('id', unique=True)
        self.db.actuals.create_index([('turbine', 1), ('time', 1)], unique=True)
        self.db.forecasts.create_index('id', unique=True)
        self.db.forecasts.create_index([('turbine', 1), ('issuedAt', -1), ('createdAt', -1)])
        self.db.calculations.create_index('id', unique=True)
        self.db.calculations.create_index([('turbine', 1), ('createdAt', -1)])
        self.db.calculations.create_index([('status', 1), ('nextDispatch', 1)])
        self.db.models.create_index('id', unique=True)
        self.db.imports.create_index([('turbine', 1), ('requestId', 1)], unique=True)
        self.db.settings.create_index('key', unique=True)

    def seed_archive(self, workspace, sites):
        """One-time, atomic import. Never overwrite subsequent operator changes."""
        now = iso(utc_now())
        def seed(session):
            if self.db.settings.find_one({'key': 'archive-v1'}, session=session):
                return
            for site in sites:
                self.db.turbines.insert_one({**site, 'dataRevision': 0, 'modelRevision': None,
                    'trainingStatus': 'idle', 'activeModelId': None, 'createdAt': now, 'updatedAt': now}, session=session)
            for batch in workspace['observations']:
                if batch['points']:
                    self.db.actuals.insert_many([{'turbine': batch['turbine'], **point,
                        'revision': 0, 'updatedAt': batch['updatedAt']} for point in batch['points']], session=session)
            if workspace['runs']:
                self.db.forecasts.insert_many([{**run, 'createdAt': now, 'dataRevision': 0, 'archived': True}
                                               for run in workspace['runs']], session=session)
            self.db.settings.insert_one({'key': 'archive-v1', 'importedAt': now}, session=session)
        self.transaction(seed)

    def turbines(self):
        return list(self.db.turbines.find({}, {'_id': 0}).sort('createdAt', 1))

    def require_turbine(self, turbine, session=None):
        result = self.db.turbines.find_one({'id': turbine}, {'_id': 0}, session=session)
        if result is None:
            raise InvalidRequest('unknown_turbine', 'Windmill not found.')
        return result

    def create_turbine(self, payload):
        fields = windmill_payload(payload)
        now = iso(utc_now())
        turbine = {**fields, 'id': 'wt-' + uuid4().hex, 'createdAt': now, 'updatedAt': now,
                   'dataRevision': 0, 'modelRevision': None, 'trainingStatus': 'idle', 'activeModelId': None}
        self.db.turbines.insert_one(dict(turbine))
        return turbine

    def new_job(self, turbine, revision, now, reason):
        return {'id': uuid4().hex, 'turbine': turbine, 'dataRevision': revision,
                'kind': 'train_forecast', 'status': 'queued', 'reason': reason, 'createdAt': now,
                'updatedAt': now, 'attempts': 0, 'message': 'Ожидает свободного worker.', 'nextDispatch': now}

    def import_actuals(self, turbine, payload):
        request_id, points = actuals_payload(payload)
        digest = hashlib.sha256(json.dumps(points, sort_keys=True).encode()).hexdigest()
        now = iso(utc_now())
        def save(session):
            site = self.require_turbine(turbine, session)
            previous = self.db.imports.find_one({'turbine': turbine, 'requestId': request_id}, session=session)
            if previous:
                if previous['digest'] != digest:
                    raise InvalidRequest('idempotency_conflict', 'This requestId was already used for different data.')
                return previous['result']
            existing = {point['time']: point['power'] for point in self.db.actuals.find(
                {'turbine': turbine, 'time': {'$in': [point['time'] for point in points]}}, session=session)}
            changed = [point for point in points if existing.get(point['time']) != point['power']]
            if not changed:
                result = {'changed': 0, 'dataRevision': site['dataRevision'], 'jobId': None}
            else:
                revision = site['dataRevision'] + 1
                job = self.new_job(turbine, revision, now, 'actuals_updated')
                # Writing this same document serializes competing revisions.
                self.db.turbines.update_one({'id': turbine}, {'$set': {'dataRevision': revision,
                    'trainingStatus': 'queued', 'updatedAt': now}}, session=session)
                self.db.actuals.bulk_write([UpdateOne({'turbine': turbine, 'time': point['time']},
                    {'$set': {**point, 'revision': revision, 'updatedAt': now}}, upsert=True) for point in changed], session=session)
                self.db.calculations.insert_one(job, session=session)
                result = {'changed': len(changed), 'dataRevision': revision, 'jobId': job['id']}
            # Preserve the input for a traceable correction history and safe HTTP retries.
            self.db.imports.insert_one({'turbine': turbine, 'requestId': request_id, 'digest': digest,
                'points': points, 'createdAt': now, 'result': result}, session=session)
            return result
        try:
            return self.transaction(save)
        except DuplicateKeyError:
            # Concurrent identical no-op imports may race on the receipt index
            # without writing the turbine document that serializes revisions.
            previous = self.db.imports.find_one({'turbine': turbine, 'requestId': request_id})
            if previous is None:
                raise
            if previous['digest'] != digest:
                raise InvalidRequest('idempotency_conflict', 'This requestId was already used for different data.') from None
            return previous['result']

    def queue_training(self, turbine):
        def queue(session):
            site = self.require_turbine(turbine, session)
            active = self.db.calculations.find_one({'turbine': turbine, 'dataRevision': site['dataRevision'],
                'status': {'$in': ['queued', 'running']}}, PUBLIC_JOB, session=session)
            if active:
                return active
            job = self.new_job(turbine, site['dataRevision'], iso(utc_now()), 'manual_training')
            self.db.turbines.update_one({'id': turbine}, {'$set': {'trainingStatus': 'queued'}}, session=session)
            self.db.calculations.insert_one(dict(job), session=session)
            return {key: value for key, value in job.items() if key != 'nextDispatch'}
        return self.transaction(queue)

    def jobs(self, turbine=None):
        query = {'turbine': turbine} if turbine else {}
        return list(self.db.calculations.find(query, PUBLIC_JOB).sort('createdAt', -1).limit(100))

    def job(self, job_id):
        result = self.db.calculations.find_one({'id': job_id}, PUBLIC_JOB)
        if not result:
            raise InvalidRequest('unknown_job', 'Calculation not found.')
        return result

    def workspace(self):
        def read(session):
            turbines = list(self.db.turbines.find({}, {'_id': 0}, session=session).sort('createdAt', 1))
            runs, observations, last_times = [], [], []
            for site in turbines:
                # Bound payload growth. The database retains the full history.
                runs.extend(self.db.forecasts.find({'turbine': site['id']}, {'_id': 0}, session=session)
                    .sort([('issuedAt', -1), ('dataRevision', -1), ('createdAt', -1)]).limit(100))
                points = list(self.db.actuals.find({'turbine': site['id']}, {'_id': 0}, session=session).sort('time', -1).limit(10000))
                if points:
                    observations.append({'turbine': site['id'], 'updatedAt': max(point['updatedAt'] for point in points),
                        'points': [{'time': point['time'], 'power': point['power']} for point in reversed(points)]})
                    last_times.append(points[0]['time'])
            return {'turbines': turbines, 'runs': runs, 'observations': observations,
                'meta': {'weatherSource': WEATHER_SOURCE, 'availabilityDelayHours': 6,
                         'actualsThrough': max(last_times) if last_times else None}}
        return self.transaction(read)

    def claim(self, job_id):
        now = utc_now()
        lease = uuid4().hex
        return self.db.calculations.find_one_and_update({'id': job_id, 'status': 'queued'},
            {'$set': {'status': 'running', 'lease': lease, 'leaseUntil': iso(now + timedelta(minutes=20)),
                      'updatedAt': iso(now), 'message': 'Обучение модели и проверка на последних 24 часах.'},
             '$inc': {'attempts': 1}}, return_document=ReturnDocument.AFTER)

    def training_snapshot(self, job):
        def read(session):
            site = self.require_turbine(job['turbine'], session)
            if site['dataRevision'] != job['dataRevision']:
                return None
            self.db.turbines.update_one({'id': site['id']}, {'$set': {'trainingStatus': 'running'}}, session=session)
            points = list(self.db.actuals.find({'turbine': site['id']}, {'_id': 0, 'time': 1, 'power': 1}, session=session)
                          .sort('time', -1).limit(50000))
            return list(reversed(points))
        return self.transaction(read)

    def finish(self, job, status, message, result=None):
        now = iso(utc_now())
        def publish(session):
            owned = self.db.calculations.find_one({'id': job['id'], 'status': 'running', 'lease': job['lease']}, session=session)
            if not owned:
                return
            site = self.require_turbine(job['turbine'], session)
            current = site['dataRevision'] == job['dataRevision']
            final_status = status if current else 'superseded'
            final_message = message if current else 'Данные обновились во время обучения. Результат не опубликован.'
            fields = {'status': final_status, 'message': final_message, 'updatedAt': now, 'finishedAt': now}
            if current:
                changes = {'trainingStatus': final_status}
                if result is not None and status == 'succeeded':
                    metadata, artifact, forecast = result
                    if len(artifact) > 12 * 1024 * 1024:
                        raise ValueError('Model artifact exceeds the MongoDB document limit.')
                    self.db.models.insert_one({**metadata, 'createdAt': now, 'artifact': Binary(artifact)}, session=session)
                    self.db.forecasts.insert_one({**forecast, 'createdAt': now, 'archived': False}, session=session)
                    changes.update(activeModelId=metadata['id'], modelRevision=job['dataRevision'])
                    fields.update(modelVersion=metadata['id'], forecastId=forecast['id'], metrics={
                        'validationMae': metadata['validationMae'], 'persistenceMae': metadata['persistenceMae'],
                        'trainRows': metadata['trainRows']})
                self.db.turbines.update_one({'id': site['id']}, {'$set': changes}, session=session)
            self.db.calculations.update_one({'id': job['id'], 'lease': job['lease']},
                {'$set': fields, '$unset': {'lease': '', 'leaseUntil': ''}}, session=session)
        self.transaction(publish)

    def dispatchable(self):
        now = utc_now()
        # A killed worker cannot strand a running calculation indefinitely.
        for job in self.db.calculations.find({'status': 'running', 'leaseUntil': {'$lt': iso(now)}}):
            if job['attempts'] >= 3:
                self.finish(job, 'failed', 'Worker прервал расчёт 3 раза. Можно повторить обучение.')
            else:
                self.db.calculations.update_one({'id': job['id'], 'status': 'running', 'lease': job['lease']},
                    {'$set': {'status': 'queued', 'nextDispatch': iso(now), 'updatedAt': iso(now),
                              'message': 'Повтор после остановки worker.'}, '$unset': {'lease': '', 'leaseUntil': ''}})
        ids = []
        for _ in range(100):
            job = self.db.calculations.find_one_and_update({'status': 'queued', 'nextDispatch': {'$lte': iso(now)}},
                {'$set': {'nextDispatch': iso(now + timedelta(seconds=60))}}, return_document=ReturnDocument.AFTER)
            if not job:
                break
            ids.append(job['id'])
        return ids
