"""MongoDB is the durable job ledger; Redis only transports job identifiers."""
import logging
import os

from celery import Celery

from src.fleet.repository import FleetRepository
from src.fleet.training import InsufficientData, train_and_forecast

LOGGER = logging.getLogger(__name__)
app = Celery('windfarm', broker=os.environ.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0'))
app.conf.update(task_serializer='json', accept_content=['json'], task_ignore_result=True,
    task_acks_late=True, task_reject_on_worker_lost=True, worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True, broker_transport_options={'visibility_timeout': 1800},
    task_soft_time_limit=840, task_time_limit=900,
    beat_schedule={'dispatch-durable-jobs': {'task': 'fleet.dispatch', 'schedule': 10.0}})


@app.task(name='fleet.dispatch')
def dispatch():
    repository = FleetRepository()
    try:
        for job_id in repository.dispatchable():
            train.delay(job_id)
    finally:
        repository.client.close()


def execute_training(repository, job_id):
    job = repository.claim(job_id)
    if job is None:
        return
    try:
        points = repository.training_snapshot(job)
        if points is None:
            repository.finish(job, 'superseded', 'Доступна более новая версия измерений.')
            return
        result = train_and_forecast(points, job['turbine'], job['dataRevision'], job['id'])
        repository.finish(job, 'succeeded', 'Модель обучена. Прогноз на 48 часов сохранён.', result)
    except InsufficientData as error:
        repository.finish(job, 'needs_data', str(error))
    except Exception:
        LOGGER.exception('Training failed for calculation %s', job_id)
        repository.finish(job, 'failed', 'Не удалось завершить обучение. Повторите расчёт или проверьте журнал worker.')


@app.task(name='fleet.train')
def train(job_id):
    repository = FleetRepository()
    try:
        execute_training(repository, job_id)
    finally:
        repository.client.close()
