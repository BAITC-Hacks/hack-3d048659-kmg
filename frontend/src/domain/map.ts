import type { ForecastRun, ObservationBatch, TurbineId, Turbine } from "./forecast";

export interface TurbineSite { id: TurbineId; name: string; coordinates: [number, number] }
export const turbineSites = (turbines: Turbine[]): TurbineSite[] => turbines.map((site) => ({
  id: site.id, name: site.name, coordinates: [site.longitude, site.latitude],
}));

export type MapMode = "forecast" | "actual";
export interface TurbineReading {
  id: TurbineId;
  power: number | null;
  wind: number | null;
  temperature: number | null;
}

export function observationTimes(observations: ObservationBatch[]): string[] {
  return [...new Set(observations.flatMap((batch) => batch.points.map((point) => Date.parse(point.time))))]
    .sort((a, b) => a - b).map((time) => new Date(time).toISOString());
}

export function mapReadings(runs: ForecastRun[], observations: ObservationBatch[],
  issuedAt: string, time: string | undefined, mode: MapMode,
  sites: { id: string }[] = [...new Set([...runs, ...observations].map((item) => item.turbine))].map((id) => ({ id })),
  selectedRunId?: string): TurbineReading[] {
  const target = time ? Date.parse(time) : NaN;
  return sites.map(({ id }) => {
    if (mode === "actual") {
      const point = observations.find((batch) => batch.turbine === id)?.points
        .find((point) => Date.parse(point.time) === target);
      return { id, power: point?.power ?? null, wind: null, temperature: null };
    }
    const run = runs.find((run) => run.id === selectedRunId && run.turbine === id && run.status === "success")
      ?? runs.find((run) => run.turbine === id && run.status === "success"
      && Date.parse(run.issuedAt) === Date.parse(issuedAt));
    const point = run?.points.find((point) => Date.parse(point.time) === target);
    return { id, power: point?.power ?? null, wind: point?.wind ?? null, temperature: point?.temperature ?? null };
  });
}
