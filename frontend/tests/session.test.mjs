import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoObservations,
  createDemoRun,
  initialRuns,
} from "../src/data/demo.ts";
import {
  loadObservations,
  loadRuns,
  saveObservations,
  saveRuns,
} from "../src/data/session.ts";

function memoryStorage(entries = []) {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("existing tab history and measurements survive the frontend move", () => {
  const previous = initialRuns.findLast((run) => run.turbine === "t2");
  const updated = createDemoRun("t2", previous, 24, "success");
  const runs = [...initialRuns, updated];
  const observations = [createDemoObservations("t2", updated.issuedAt)];
  const storage = memoryStorage([
    ["wind-demo-runs-v1", JSON.stringify(runs)],
    ["wind-demo-observations-v1", JSON.stringify(observations)],
  ]);

  assert.deepEqual(loadRuns(storage), runs);
  assert.deepEqual(loadObservations(storage), observations);
  saveRuns(runs, storage);
  saveObservations(observations, storage);
  assert.deepEqual(JSON.parse(storage.getItem("wind-demo-runs-v1")), runs);
  assert.deepEqual(
    JSON.parse(storage.getItem("wind-demo-observations-v1")),
    observations,
  );
});

test("malformed and incomplete history falls back to usable demo defaults", () => {
  const missingTurbine = initialRuns.filter((run) => run.turbine === "t1");
  const invalidHorizon = structuredClone(initialRuns);
  invalidHorizon[0].horizon = 12;
  const incompletePoints = structuredClone(initialRuns);
  incompletePoints[0].points.pop();

  for (const stored of [
    "not json",
    "null",
    "[]",
    JSON.stringify(missingTurbine),
    JSON.stringify(invalidHorizon),
    JSON.stringify(incompletePoints),
  ]) {
    const storage = memoryStorage([["wind-demo-runs-v1", stored]]);
    assert.deepEqual(loadRuns(storage), initialRuns);
  }
});

test("cached forecasts cannot use weather that was unavailable at issue time", () => {
  const runs = structuredClone(initialRuns);
  runs[0].weatherAvailableAt = new Date(
    Date.parse(runs[0].issuedAt) + 3600000,
  ).toISOString();
  const storage = memoryStorage([["wind-demo-runs-v1", JSON.stringify(runs)]]);
  assert.deepEqual(loadRuns(storage), initialRuns);
});

test("cached observations reject future or non-normalized measurements", () => {
  const original = createDemoObservations("t1", "2026-02-02T06:00:00.000Z");
  for (const invalidPoint of [
    { time: original.updatedAt, power: 0.5 },
    // UTC comparison must account for offsets rather than compare strings.
    { time: "2026-02-02T05:00:00-02:00", power: 0.5 },
    { time: original.points[0].time, power: 1.1 },
  ]) {
    const batch = { ...original, points: [invalidPoint] };
    const storage = memoryStorage([
      ["wind-demo-observations-v1", JSON.stringify([batch])],
    ]);
    assert.deepEqual(loadObservations(storage), []);
  }
});

test("blocked or full browser storage does not prevent an in-memory session", () => {
  const blocked = {
    getItem() {
      throw new Error("Storage disabled");
    },
    setItem() {
      throw new Error("Storage full");
    },
  };
  for (const storage of [null, blocked]) {
    assert.deepEqual(loadRuns(storage), initialRuns);
    assert.deepEqual(loadObservations(storage), []);
    assert.doesNotThrow(() => saveRuns(initialRuns, storage));
    assert.doesNotThrow(() => saveObservations([], storage));
  }
});
