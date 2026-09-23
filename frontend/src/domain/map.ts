import type { ForecastRun, ObservationBatch, TurbineId } from "./forecast";

// Geographic positions from backend/config.yaml. Model dimensions are illustrative.
export const turbineSites: { id: TurbineId; coordinates: [number, number] }[] = [
  { id: "t1", coordinates: [78.535604, 43.645150] },
  { id: "t2", coordinates: [78.538828, 43.643198] },
];

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
  issuedAt: string, time: string | undefined, mode: MapMode): TurbineReading[] {
  const target = time ? Date.parse(time) : NaN;
  return turbineSites.map(({ id }) => {
    if (mode === "actual") {
      const point = observations.find((batch) => batch.turbine === id)?.points
        .find((point) => Date.parse(point.time) === target);
      return { id, power: point?.power ?? null, wind: null, temperature: null };
    }
    const run = runs.find((run) => run.turbine === id && run.status === "success"
      && Date.parse(run.issuedAt) === Date.parse(issuedAt));
    const point = run?.points.find((point) => Date.parse(point.time) === target);
    return { id, power: point?.power ?? null, wind: point?.wind ?? null, temperature: point?.temperature ?? null };
  });
}
