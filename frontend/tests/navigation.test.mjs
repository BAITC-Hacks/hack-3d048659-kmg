import assert from "node:assert/strict";
import test from "node:test";
import { readLocation } from "../src/app/navigation.ts";
import { initialRuns } from "../src/data/demo.ts";

test("direct links restore page, turbine, selected release and horizon", () => {
  const run = initialRuns.find(
    (item) => item.turbine === "t2" && item.status === "error",
  );
  for (const page of ["forecast", "weather", "history"]) {
    assert.deepEqual(
      readLocation(initialRuns, {
        pathname: `/${page}`,
        search: `?turbine=t2&run=${run.id}&horizon=24`,
      }),
      { page, turbine: "t2", runId: run.id, horizon: 24 },
    );
  }
});

test("stale links and mismatched turbine releases fall back to that turbine", () => {
  const otherRun = initialRuns.find((item) => item.turbine === "t1");
  const defaultRun = initialRuns.find(
    (item) =>
      item.turbine === "t2" && item.issuedAt === "2026-02-01T00:00:00.000Z",
  );
  for (const requestedRun of ["expired-session-run", otherRun.id]) {
    assert.deepEqual(
      readLocation(initialRuns, {
        pathname: "/weather",
        search: `?turbine=t2&run=${requestedRun}&horizon=48`,
      }),
      { page: "weather", turbine: "t2", runId: defaultRun.id, horizon: 48 },
    );
  }
});

test("unknown routes and unsupported values use safe defaults", () => {
  const state = readLocation(initialRuns, {
    pathname: "/not-a-page",
    search: "?turbine=t3&horizon=72",
  });
  assert.equal(state.page, "forecast");
  assert.equal(state.turbine, "t1");
  assert.equal(state.horizon, 48);
  assert.equal(initialRuns.find((run) => run.id === state.runId).turbine, "t1");
});
