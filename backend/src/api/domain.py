"""Dashboard contracts and ports, independent of HTTP, pandas, and storage."""
from typing import Literal, Protocol, TypedDict

WEATHER_SOURCE = 'Open-Meteo Single Runs API (ECMWF IFS)'
TurbineId = str


class ForecastPoint(TypedDict):
    time: str
    power: float
    wind: float | None
    temperature: float | None


class ForecastRun(TypedDict):
    id: str
    turbine: TurbineId
    issuedAt: str
    weatherIssuedAt: str
    weatherAvailableAt: str
    horizon: Literal[48]
    status: Literal['success']
    reason: str
    modelVersion: str
    fallbackUsed: bool
    method: str
    weatherSource: str
    points: list[ForecastPoint]


class ObservationPoint(TypedDict):
    time: str
    power: float


class ObservationBatch(TypedDict):
    turbine: TurbineId
    updatedAt: str
    points: list[ObservationPoint]


class WorkspaceMeta(TypedDict):
    weatherSource: str
    availabilityDelayHours: int
    actualsThrough: str | None


class Workspace(TypedDict):
    runs: list[ForecastRun]
    observations: list[ObservationBatch]
    meta: WorkspaceMeta


class ForecastRepository(Protocol):
    def workspace(self) -> Workspace: ...
    def allowed_origins(self) -> set[str]: ...
    def save_forecasts(self, runs: list[ForecastRun]) -> None: ...


class ForecastEngine(Protocol):
    def forecast(self, origin: str) -> list[ForecastRun]: ...


class InvalidRequest(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message
