export function workspaceFixture() {
  const origin = "2026-01-30T19:00:00Z";
  return {
    turbines: ["t1", "t2"].map((id, index) => ({ id, name: `Турбина ${index + 1}`, latitude: 43.64, longitude: 78.53,
      ratedPowerKw: null, dataRevision: 0, modelRevision: null, activeModelId: null,
      trainingStatus: "idle", createdAt: origin, updatedAt: origin })),
    runs: ["t1", "t2"].map((turbine) => ({
      id: turbine + "-" + Date.parse(origin), turbine, issuedAt: origin,
      weatherIssuedAt: "2026-01-30T12:00:00Z", weatherAvailableAt: "2026-01-30T18:00:00Z",
      horizon: 48, status: "success", reason: "Archived forecast", modelVersion: "test-model",
      method: "model", fallbackUsed: false, weatherSource: "Open-Meteo ECMWF IFS",
      points: Array.from({ length: 48 }, (_, index) => ({
        time: new Date(Date.parse(origin) + (index + 1) * 3_600_000).toISOString(),
        power: 0.25, wind: 7.5, temperature: -3,
      })),
    })),
    observations: [{ turbine: "t1", updatedAt: "2026-01-31T19:00:00Z", points: [{ time: "2026-01-30T20:00:00.000Z", power: 0.3 }] }],
    meta: { weatherSource: "Open-Meteo ECMWF IFS", availabilityDelayHours: 6, actualsThrough: "2026-01-31T18:00:00Z" },
  };
}
