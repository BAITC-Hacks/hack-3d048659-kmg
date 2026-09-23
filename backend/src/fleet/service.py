"""Default API service backed by MongoDB; archival import is performed once."""
from src.api.domain import InvalidRequest
from src.api.infrastructure import FilesystemForecastRepository
from src.fleet.repository import FleetRepository


class FleetService:
    def __init__(self, repository=None, seed=True):
        self.repository = repository if repository is not None else FleetRepository()
        self.repository.initialize()
        if seed and not self.repository.db.settings.find_one({'key': 'archive-v1'}):
            archive = FilesystemForecastRepository()
            sites = [{'id': f't{site["turbine_id"]}', 'name': f'Турбина {site["turbine_id"]}',
                      'latitude': site['lat'], 'longitude': site['lon'], 'ratedPowerKw': None}
                     for site in archive.config['turbines']]
            self.repository.seed_archive(archive.workspace(), sites)

    def health(self):
        self.repository.db.command('ping')
        return {'status': 'ok', 'storage': 'mongodb'}

    def workspace(self):
        return self.repository.workspace()

    def create_turbine(self, payload):
        return self.repository.create_turbine(payload)

    def import_actuals(self, turbine, payload):
        return self.repository.import_actuals(turbine, payload)

    def queue_training(self, turbine, payload):
        if payload != {}:
            raise InvalidRequest('invalid_request', 'Send an empty object to train the latest actuals.')
        return self.repository.queue_training(turbine)

    def calculations(self, turbine=None):
        return self.repository.jobs(turbine)

    def calculation(self, job_id):
        return self.repository.job(job_id)

    def recalculate(self, payload):
        if not isinstance(payload, dict) or set(payload) != {'turbine'} or not isinstance(payload['turbine'], str):
            raise InvalidRequest('invalid_request', 'Provide a turbine to train and forecast from its latest measurements.')
        return self.repository.queue_training(payload['turbine'])
