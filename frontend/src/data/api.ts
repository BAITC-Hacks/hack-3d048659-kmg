import type { WorkspaceData } from "../domain/forecast";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const power = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const weather = (value: unknown) => value === null || finite(value);
const turbine = (value: unknown) => value === "t1" || value === "t2";

// Reject malformed server responses before chart and date formatting code uses them.
export function parseWorkspace(value: unknown): WorkspaceData {
  const invalid = () => { throw new Error("Сервис вернул некорректные данные прогноза."); };
  if (!record(value) || !Array.isArray(value.runs) || !Array.isArray(value.observations) || !record(value.meta)) return invalid();
  const runs = value.runs;
  const ids = new Set<string>();
  for (const run of runs) {
    if (!record(run) || typeof run.id !== "string" || !run.id || ids.has(run.id)
      || !turbine(run.turbine) || !timestamp(run.issuedAt)
      || !timestamp(run.weatherIssuedAt) || !timestamp(run.weatherAvailableAt)
      || Date.parse(run.weatherAvailableAt) > Date.parse(run.issuedAt)
      || run.horizon !== 48 || run.status !== "success"
      || typeof run.reason !== "string" || typeof run.modelVersion !== "string"
      || typeof run.fallbackUsed !== "boolean" || typeof run.method !== "string"
      || typeof run.weatherSource !== "string" || !Array.isArray(run.points) || run.points.length !== 48) return invalid();
    ids.add(run.id);
    for (const [index, point] of run.points.entries()) {
      if (!record(point) || !timestamp(point.time) || !power(point.power)
        || !weather(point.wind) || !weather(point.temperature)
        || Date.parse(point.time) !== Date.parse(run.issuedAt) + (index + 1) * 3_600_000) return invalid();
    }
  }
  if (runs.length && !["t1", "t2"].every((id) => runs.some((run) => run.turbine === id))) return invalid();
  const observedTurbines = new Set<string>();
  for (const batch of value.observations) {
    if (!record(batch) || !turbine(batch.turbine) || !timestamp(batch.updatedAt)
      || !Array.isArray(batch.points) || observedTurbines.has(String(batch.turbine))) return invalid();
    observedTurbines.add(String(batch.turbine));
    const times = new Set<string>();
    for (const point of batch.points) {
      if (!record(point) || !timestamp(point.time) || !power(point.power) || times.has(point.time)) return invalid();
      times.add(point.time);
    }
  }
  if (typeof value.meta.weatherSource !== "string" || value.meta.availabilityDelayHours !== 6
    || !(value.meta.actualsThrough === null || timestamp(value.meta.actualsThrough))) return invalid();
  return value as unknown as WorkspaceData;
}

async function requestWorkspace(path: string, init: RequestInit = {}): Promise<WorkspaceData> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  const timeout = setTimeout(abort, 120_000);
  try {
    const response = await fetch(path, {
      ...init, signal: controller.signal, headers: { Accept: "application/json", ...init.headers },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = record(payload) && record(payload.error) && typeof payload.error.message === "string"
        ? payload.error.message : `Сервис недоступен (HTTP ${response.status}).`;
      throw new Error(detail);
    }
    return parseWorkspace(payload);
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted)
      throw new Error("Сервис не ответил вовремя. Обновите данные, чтобы проверить результат расчёта.");
    if (error instanceof TypeError) throw new Error("Не удалось связаться с сервисом прогноза. Проверьте, запущен ли backend.");
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}

export const fetchWorkspace = (signal?: AbortSignal) => requestWorkspace("/api/workspace", { signal });
export const recalculateForecast = (origin: string, signal?: AbortSignal) => requestWorkspace("/api/forecasts", {
  method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ origin }),
});
