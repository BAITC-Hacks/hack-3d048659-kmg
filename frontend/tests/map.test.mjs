import assert from "node:assert/strict";
import test from "node:test";
import { mapReadings, observationTimes } from "../src/domain/map.ts";
import { workspaceFixture } from "./fixtures.mjs";

test("map compares both turbines at the same release and hour, never another release", () => {
  const { runs, observations } = workspaceFixture();
  runs[1].points[0].power = 0;
  const result = mapReadings(runs, observations, runs[0].issuedAt, runs[0].points[0].time, "forecast");
  assert.deepEqual(result.map((point) => point.power), [0.25, 0]);
  runs[1].issuedAt = "2026-02-01T19:00:00Z";
  assert.equal(mapReadings(runs, observations, runs[0].issuedAt, runs[0].points[0].time, "forecast")[1].power, null);
});

test("history matches timestamp instants and never substitutes forecasts or weather", () => {
  const { runs, observations } = workspaceFixture();
  const result = mapReadings(runs, observations, runs[0].issuedAt, "2026-01-30T20:00:00Z", "actual");
  assert.deepEqual(result, [
    { id: "t1", power: 0.3, wind: null, temperature: null },
    { id: "t2", power: null, wind: null, temperature: null },
  ]);
  assert.ok(mapReadings(runs, observations, runs[0].issuedAt, "2026-02-01T20:00:00Z", "actual").every((point) => point.power === null));
});

test("history timeline combines, deduplicates and sorts available hours across turbines", () => {
  const { observations } = workspaceFixture();
  observations.push({ turbine: "t2", updatedAt: observations[0].updatedAt, points: [
    { time: "2026-01-30T20:00:00Z", power: 0 },
    { time: "2026-01-01T00:00:00Z", power: 0.5 },
  ] });
  assert.deepEqual(observationTimes(observations), ["2026-01-01T00:00:00.000Z", "2026-01-30T20:00:00.000Z"]);
  assert.deepEqual(observationTimes([]), []);
});

test("empty history and unavailable forecast weather remain missing", () => {
  const { runs } = workspaceFixture();
  runs[0].points[0].wind = null;
  const result = mapReadings(runs, [], runs[0].issuedAt, runs[0].points[0].time, "forecast");
  assert.equal(result[0].wind, null);
  assert.ok(mapReadings(runs, [], runs[0].issuedAt, undefined, "actual").every((point) => point.power === null));
});
