import type { WorkspaceData, Turbine, Calculation, ActualPoint } from "../domain/forecast";

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && value.endsWith("Z") && Number.isFinite(Date.parse(value));
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const power = (value: unknown): value is number => finite(value) && value >= 0 && value <= 1;
const weather = (value: unknown) => value === null || finite(value);
const turbine = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

// Reject malformed server responses before chart and date formatting code uses them.
export function parseWorkspace(value: unknown): WorkspaceData {
  const invalid = () => { throw new Error("Сервис вернул некорректные данные прогноза."); };
  if (!record(value) || !Array.isArray(value.turbines) || !Array.isArray(value.runs) || !Array.isArray(value.observations) || !record(value.meta)) return invalid();
  const turbineIds = new Set<string>();
  for (const site of value.turbines) {
    if (!record(site) || !turbine(site.id) || turbineIds.has(site.id) || typeof site.name !== "string" || !site.name.trim()
      || !finite(site.latitude) || Math.abs(site.latitude) > 85 || !finite(site.longitude) || Math.abs(site.longitude) > 180
      || !(site.ratedPowerKw === null || finite(site.ratedPowerKw) && site.ratedPowerKw > 0)
      || !Number.isInteger(site.dataRevision) || Number(site.dataRevision) < 0
      || !(site.modelRevision === null || Number.isInteger(site.modelRevision) && Number(site.modelRevision) >= 0)
      || !(site.activeModelId === null || typeof site.activeModelId === "string")
      || !["idle", "queued", "running", "succeeded", "failed", "needs_data", "superseded"].includes(String(site.trainingStatus))
      || !timestamp(site.createdAt) || !timestamp(site.updatedAt)) return invalid();
    turbineIds.add(site.id);
  }
  const runs = value.runs;
  const ids = new Set<string>();
  for (const run of runs) {
    if (!record(run) || typeof run.id !== "string" || !run.id || ids.has(run.id)
      || !turbine(run.turbine) || !turbineIds.has(run.turbine) || !timestamp(run.issuedAt)
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
  const observedTurbines = new Set<string>();
  for (const batch of value.observations) {
    if (!record(batch) || !turbine(batch.turbine) || !turbineIds.has(batch.turbine) || !timestamp(batch.updatedAt)
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

async function requestJson(path: string, init: RequestInit = {}): Promise<unknown> {
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
    return payload;
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

export const fetchWorkspace = async (signal?: AbortSignal) => parseWorkspace(await requestJson("/api/workspace", { signal }));
const post = (path: string, data: unknown, signal?: AbortSignal) => requestJson(path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data), signal,
});
export const createTurbine = async (data: Pick<Turbine, "name" | "latitude" | "longitude" | "ratedPowerKw">) =>
  await post("/api/turbines", data) as Turbine;
export const importActuals = async (id: string, points: ActualPoint[], requestId: string) =>
  await post(`/api/turbines/${encodeURIComponent(id)}/actuals`, { points, requestId }) as { changed: number; dataRevision: number; jobId: string | null };
function parseCalculation(value: unknown): Calculation {
  if (!record(value) || typeof value.id !== "string" || !turbine(value.turbine)
    || !Number.isInteger(value.dataRevision) || Number(value.dataRevision) < 0
    || !["queued", "running", "succeeded", "failed", "needs_data", "superseded"].includes(String(value.status))
    || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || typeof value.message !== "string"
    || !Number.isInteger(value.attempts)) throw new Error("Некорректный ответ статуса расчёта.");
  if (value.metrics !== undefined && (!record(value.metrics) || !finite(value.metrics.validationMae)
    || !finite(value.metrics.persistenceMae) || !Number.isInteger(value.metrics.trainRows))) throw new Error("Некорректные метрики расчёта.");
  return value as unknown as Calculation;
}
export const queueTraining = async (id: string, signal?: AbortSignal) =>
  parseCalculation(await post(`/api/turbines/${encodeURIComponent(id)}/train`, {}, signal));
export const fetchCalculations = async (id: string, signal?: AbortSignal) => {
  const result = await requestJson(`/api/calculations?turbine=${encodeURIComponent(id)}`, { signal });
  if (!record(result) || !Array.isArray(result.calculations)) throw new Error("Некорректный ответ списка расчётов.");
  return result.calculations.map(parseCalculation);
};
