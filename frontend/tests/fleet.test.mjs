import assert from "node:assert/strict";
import test from "node:test";
import { parseActualsCsv } from "../src/data/actualsCsv.ts";
import { parseWorkspace } from "../src/data/api.ts";
import { readLocation } from "../src/app/navigation.ts";
import { mapReadings, turbineSites } from "../src/domain/map.ts";
import { workspaceFixture } from "./fixtures.mjs";

test("CSV normalizes timezone offsets, accepts zero and sorts rows", () => {
  assert.deepEqual(parseActualsCsv('\uFEFFtime;power\n2026-03-01T06:00:00+05:00;0\n2026-03-01T00:00:00Z;0.5'), [
    { time: '2026-03-01T00:00:00.000Z', power: 0.5 }, { time: '2026-03-01T01:00:00.000Z', power: 0 },
  ]);
});
test("CSV refuses duplicate instants, missing or out-of-range power and partial hours", () => {
  for (const body of ['2026-03-01T00:00:00Z,', '2026-03-01T00:00:00Z,NaN', '2026-03-01T00:00:00Z,2',
    '2026-03-01T00:30:00Z,0.4', '2026-03-01T00:00:00,0.4',
    '2026-03-01T00:00:00Z,0.4\n2026-03-01T05:00:00+05:00,0.5']) assert.throws(() => parseActualsCsv('time,power\n' + body));
});
test("a new windmill needs neither a forecast nor actuals to appear on map and navigation", () => {
  const data = workspaceFixture();
  data.turbines.push({ ...data.turbines[0], id: "wt-new", name: "New windmill", latitude: 44, longitude: 79 });
  assert.equal(parseWorkspace(data).turbines.length, 3);
  const state = readLocation(data.runs, { pathname: "/turbines", search: "?turbine=wt-new" }, data.turbines);
  assert.equal(state.turbine, "wt-new"); assert.equal(state.runId, ""); assert.equal(state.page, "turbines");
  const sites = turbineSites(data.turbines);
  assert.deepEqual(sites[2].coordinates, [79, 44]);
  assert.equal(mapReadings(data.runs, data.observations, data.runs[0].issuedAt, data.runs[0].points[0].time, "forecast", sites)[2].power, null);
});
test("an empty fleet is valid but unknown turbine references are rejected", () => {
  const data = workspaceFixture();
  assert.doesNotThrow(() => parseWorkspace({ ...data, turbines: [], runs: [], observations: [] }));
  data.runs[0].turbine = "unknown";
  assert.throws(() => parseWorkspace(data));
});

test("map displays the selected historical model version rather than a newer same-origin run", () => {
  const data = workspaceFixture();
  const old = data.runs[0];
  const updated = { ...old, id: "new-version", points: old.points.map((point) => ({ ...point, power: .9 })) };
  const result = mapReadings([updated, ...data.runs], data.observations, old.issuedAt, old.points[0].time,
    "forecast", turbineSites(data.turbines), old.id);
  assert.equal(result[0].power, old.points[0].power);
});
