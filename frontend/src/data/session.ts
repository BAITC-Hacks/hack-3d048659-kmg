import { initialRuns } from "./demo.ts";
import type { ForecastRun, ObservationBatch } from "../domain/forecast";

// Retain the original keys so reorganizing the frontend preserves tab-local history.
const RUNS_KEY = "wind-demo-runs-v1";
const OBSERVATIONS_KEY = "wind-demo-observations-v1";

interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type OptionalStorage = SessionStorage | null | undefined;

function readStored(key: string, storage?: OptionalStorage): unknown {
  try {
    const available =
      storage === undefined ? globalThis.sessionStorage : storage;
    return JSON.parse(available?.getItem(key) || "null");
  } catch {
    // Storage access and malformed data must not prevent the demo from opening.
    return null;
  }
}

function writeStored(
  key: string,
  value: unknown,
  storage?: OptionalStorage,
): void {
  try {
    const available =
      storage === undefined ? globalThis.sessionStorage : storage;
    available?.setItem(key, JSON.stringify(value));
  } catch {
    // History remains usable in memory when browser storage is unavailable or full.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNormalizedPower(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isRun(value: unknown): value is ForecastRun {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.turbine !== "t1" && value.turbine !== "t2") ||
    (value.status !== "success" && value.status !== "error") ||
    (value.horizon !== 24 && value.horizon !== 48) ||
    typeof value.reason !== "string" ||
    !isTime(value.issuedAt) ||
    !isTime(value.weatherIssuedAt) ||
    !isTime(value.weatherAvailableAt) ||
    !Array.isArray(value.points) ||
    value.points.length !== 48
  )
    return false;

  const issuedAt = Date.parse(value.issuedAt);
  return (
    Date.parse(value.weatherIssuedAt) <= Date.parse(value.weatherAvailableAt) &&
    Date.parse(value.weatherAvailableAt) <= issuedAt &&
    value.points.every(
      (point) =>
        isRecord(point) &&
        isTime(point.time) &&
        Date.parse(point.time) > issuedAt &&
        isNormalizedPower(point.power) &&
        typeof point.wind === "number" &&
        Number.isFinite(point.wind) &&
        typeof point.temperature === "number" &&
        Number.isFinite(point.temperature),
    )
  );
}

function isObservationBatch(value: unknown): value is ObservationBatch {
  if (
    !isRecord(value) ||
    (value.turbine !== "t1" && value.turbine !== "t2") ||
    !isTime(value.updatedAt) ||
    !Array.isArray(value.points)
  )
    return false;

  const updatedAt = Date.parse(value.updatedAt);
  return value.points.every(
    (point) =>
      isRecord(point) &&
      isTime(point.time) &&
      Date.parse(point.time) < updatedAt &&
      isNormalizedPower(point.power),
  );
}

export function loadRuns(storage?: OptionalStorage): ForecastRun[] {
  const saved = readStored(RUNS_KEY, storage);
  if (
    Array.isArray(saved) &&
    saved.length > 0 &&
    saved.every(isRun) &&
    // Both selections need a usable default even if a stored session is incomplete.
    ["t1", "t2"].every((turbine) =>
      saved.some((run) => run.turbine === turbine && run.status === "success"),
    )
  )
    return saved;
  return initialRuns;
}

export function saveRuns(runs: ForecastRun[], storage?: OptionalStorage): void {
  writeStored(RUNS_KEY, runs, storage);
}

export function loadObservations(
  storage?: OptionalStorage,
): ObservationBatch[] {
  const saved = readStored(OBSERVATIONS_KEY, storage);
  return Array.isArray(saved) && saved.every(isObservationBatch) ? saved : [];
}

export function saveObservations(
  observations: ObservationBatch[],
  storage?: OptionalStorage,
): void {
  writeStored(OBSERVATIONS_KEY, observations, storage);
}
