import assert from "node:assert/strict";
import test from "node:test";
import {
  createDemoObservations,
  createDemoRun,
  initialRuns,
} from "../src/data/demo.ts";

const HOUR = 60 * 60 * 1000;

test("each update uses a newer weather issue that was already available", () => {
  for (const turbine of ["t1", "t2"]) {
    let previous = initialRuns.findLast((run) => run.turbine === turbine);
    for (const status of ["success", "error", "success"]) {
      const snapshot = structuredClone(previous);
      const next = createDemoRun(turbine, previous, 24, status);
      assert.deepEqual(
        previous,
        snapshot,
        "updates must preserve historical runs",
      );
      assert.equal(
        Date.parse(next.issuedAt) - Date.parse(previous.issuedAt),
        6 * HOUR,
      );
      assert.ok(
        Date.parse(next.weatherIssuedAt) > Date.parse(previous.weatherIssuedAt),
      );
      assert.ok(
        Date.parse(next.weatherIssuedAt) < Date.parse(next.weatherAvailableAt),
      );
      assert.ok(
        Date.parse(next.weatherAvailableAt) <= Date.parse(next.issuedAt),
      );
      assert.ok(
        next.points.every(
          (point) => Date.parse(point.time) > Date.parse(next.issuedAt),
        ),
      );
      assert.notEqual(next.id, previous.id);
      previous = next;
    }
  }
});

test("synthetic observations are normalized, hourly, ordered and past-only", () => {
  for (const availableAt of [
    "2026-02-02T06:00:00.000Z",
    "2026-02-02T06:45:00.000Z",
  ]) {
    const batch = createDemoObservations("t1", availableAt);
    assert.equal(batch.updatedAt, availableAt);
    assert.equal(batch.turbine, "t1");
    assert.equal(batch.points.length, 96);
    assert.equal(batch.points.at(-1).time, "2026-02-02T05:00:00.000Z");
    batch.points.forEach((point, index) => {
      assert.ok(point.power >= 0 && point.power <= 1);
      assert.ok(Date.parse(point.time) <= Date.parse(availableAt) - HOUR);
      if (index > 0) {
        assert.equal(
          Date.parse(point.time) - Date.parse(batch.points[index - 1].time),
          HOUR,
        );
      }
    });
  }
});

test("refreshing facts preserves overlapping observations and separates turbines", () => {
  const earlier = createDemoObservations("t1", "2026-02-02T00:00:00.000Z");
  const snapshot = structuredClone(earlier);
  const later = createDemoObservations("t1", "2026-02-02T06:00:00.000Z");
  const existing = new Map(
    earlier.points.map((point) => [point.time, point.power]),
  );
  const overlap = later.points.filter((point) => existing.has(point.time));
  assert.equal(overlap.length, 90);
  overlap.forEach((point) =>
    assert.equal(point.power, existing.get(point.time)),
  );
  assert.deepEqual(earlier, snapshot);
  assert.deepEqual(later, createDemoObservations("t1", later.updatedAt));
  assert.notDeepEqual(
    later.points,
    createDemoObservations("t2", later.updatedAt).points,
  );
});

test("synthetic observations are independent of any forecast update", () => {
  const previous = initialRuns.findLast((run) => run.turbine === "t1");
  const availableAt = "2026-02-03T00:00:00.000Z";
  const before = createDemoObservations("t1", availableAt);
  const next = createDemoRun("t1", previous, 48, "success");
  next.points.forEach((point) => {
    point.power = 0;
  });
  assert.deepEqual(createDemoObservations("t1", availableAt), before);
  const forecastByTime = new Map(
    previous.points.map((point) => [point.time, point.power]),
  );
  assert.ok(
    before.points.some(
      (point) =>
        forecastByTime.has(point.time) &&
        forecastByTime.get(point.time) !== point.power,
    ),
  );
});

test("invalid observation availability is rejected", () => {
  assert.throws(() => createDemoObservations("t1", "invalid"), RangeError);
});
