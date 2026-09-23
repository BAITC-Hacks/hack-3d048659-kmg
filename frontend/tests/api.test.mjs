import assert from "node:assert/strict";
import test from "node:test";
import { fetchWorkspace, queueTraining, parseWorkspace } from "../src/data/api.ts";
import { workspaceFixture } from "./fixtures.mjs";

test("API workspace preserves both turbines, exact measurements and missing weather", () => {
  const data = workspaceFixture();
  data.runs[0].points[0].wind = null;
  data.runs[0].points[0].temperature = null;
  assert.equal(parseWorkspace(data), data);
  assert.equal(data.runs[0].points[0].wind, null);
  assert.equal(data.observations[0].points[0].power, 0.3);
});

test("malformed forecast payloads never reach charts", () => {
  for (const mutate of [
    (data) => data.runs[0].points.pop(),
    (data) => { data.runs[0].points[0].power = 1.2; },
    (data) => { data.runs[0].points[0].time = data.runs[0].issuedAt; },
    (data) => { data.runs[0].weatherAvailableAt = "2026-02-01T00:00:00Z"; },
    (data) => { data.runs[1].id = data.runs[0].id; },
    (data) => data.turbines.pop(),
    (data) => { data.observations[0].points[0].power = null; },
  ]) {
    const data = workspaceFixture(); mutate(data);
    assert.throws(() => parseWorkspace(data), /некорректные/);
  }
});

test("empty server archive is explicit and contains no synthetic fallback", () => {
  const data = workspaceFixture(); data.runs = []; data.observations = [];
  assert.deepEqual(parseWorkspace(data).runs, []);
});

test("load and train use same-origin endpoints and the selected windmill", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    const payload = url === "/api/workspace" ? workspaceFixture() : { id: "job", turbine: "t1", dataRevision: 1,
      status: "queued", createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-01T00:00:00Z", message: "Queued", attempts: 0 };
    return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
  });
  const data = await fetchWorkspace();
  await queueTraining(data.runs[0].turbine);
  assert.equal(calls[0].url, "/api/workspace");
  assert.equal(calls[1].url, "/api/turbines/t1/train");
  assert.equal(calls[1].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[1].options.body), {});
  assert.equal(calls[1].options.headers["Content-Type"], "application/json");
});

test("backend and network failures surface without fake success", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ error: { code: "invalid_origin", message: "Недоступный выпуск" } }), { status: 422 }));
  await assert.rejects(queueTraining("t1"), /Недоступный выпуск/);
  mock.mock.mockImplementation(async () => { throw new TypeError("Failed to fetch"); });
  await assert.rejects(fetchWorkspace(), /Не удалось связаться/);
  mock.mock.mockImplementation(async () => new Response("<html>proxy error</html>", { status: 502 }));
  await assert.rejects(fetchWorkspace(), /HTTP 502/);
});
