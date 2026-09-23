"""Use cases depend only on domain contracts and injected storage/engine ports."""
from datetime import datetime, timezone
import re
from threading import RLock

from src.api.domain import ForecastEngine, ForecastRepository, InvalidRequest, Workspace


class ForecastService:
    def __init__(self, repository: ForecastRepository, engine: ForecastEngine):
        self.repository, self.engine = repository, engine
        self.lock = RLock()

    def workspace(self) -> Workspace:
        with self.lock:
            return self.repository.workspace()

    def recalculate(self, payload: object) -> Workspace:
        if not isinstance(payload, dict) or set(payload) != {'origin'} or not isinstance(payload['origin'], str):
            raise InvalidRequest('invalid_request', 'Provide exactly one string field: origin.')
        try:
            if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.0+)?)?(?:Z|[+-]\d{2}:\d{2})', payload['origin']):
                raise ValueError('Use an exact ISO archive timestamp')
            origin = datetime.fromisoformat(payload['origin'].replace('Z', '+00:00'))
            if origin.tzinfo is None or origin.utcoffset() is None or origin.microsecond:
                raise ValueError('An exact timestamp with timezone is required')
            normalized = origin.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        except (ValueError, TypeError, OverflowError):
            raise InvalidRequest('invalid_origin', 'Origin must be an ISO timestamp with a timezone.') from None
        with self.lock:
            if normalized not in self.repository.allowed_origins():
                raise InvalidRequest('unknown_origin', 'Choose an existing origin from the forecast archive.')
            runs = self.engine.forecast(normalized)
            self.repository.save_forecasts(runs)
            return self.repository.workspace()
