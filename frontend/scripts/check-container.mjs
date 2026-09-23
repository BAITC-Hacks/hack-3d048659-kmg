import assert from "node:assert/strict";

const base =
  process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || "8088"}`;

async function request(path, expectedStatus = 200) {
  const response = await fetch(new URL(path, base), {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, expectedStatus, `${path}: HTTP status`);
  return response;
}

try {
  const health = await request("/healthz");
  assert.equal((await health.text()).trim(), "ok", "health response");
  const apiHealth = await request("/api/health");
  assert.match(apiHealth.headers.get("content-type") || "", /application\/json/);
  assert.equal((await apiHealth.json()).status, "ok", "backend health");
  const workspaceResponse = await request("/api/workspace");
  assert.match(workspaceResponse.headers.get("content-type") || "", /application\/json/);
  const workspace = await workspaceResponse.json();
  assert.ok(Array.isArray(workspace.runs) && workspace.runs.length > 0, "archived forecasts");
  assert.deepEqual(
    [...new Set(workspace.runs.map((run) => run.turbine))].sort(),
    ["t1", "t2"],
    "forecasts for both turbines",
  );
  for (const run of workspace.runs) {
    assert.equal(run.points.length, 48, `${run.id}: complete forecast horizon`);
    assert.ok(run.modelVersion, `${run.id}: model provenance`);
  }
  assert.ok(Array.isArray(workspace.observations), "backend observations");
  assert.equal(workspace.meta.availabilityDelayHours, 6, "weather availability delay");
  const home = await request("/");
  const html = await home.text();
  assert.match(html, /<div id="root"><\/div>/, "React entry point");
  assert.match(home.headers.get("content-type") || "", /text\/html/);
  for (const path of [
    "/forecast?turbine=t1&horizon=24",
    "/weather",
    "/history",
  ]) {
    assert.equal(
      await (await request(path)).text(),
      html,
      `${path}: SPA fallback`,
    );
  }
  const js = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
  const css = html.match(/href="(\/assets\/[^\"]+\.css)"/)?.[1];
  assert.ok(js && css, "built JavaScript and CSS links");
  for (const [path, type] of [
    [js, /javascript/],
    [css, /text\/css/],
  ]) {
    const response = await request(path);
    assert.match(
      response.headers.get("content-type") || "",
      type,
      `${path}: content type`,
    );
    assert.match(
      response.headers.get("cache-control") || "",
      /immutable/,
      `${path}: asset caching`,
    );
  }
  const index = await request("/index.html");
  assert.match(
    index.headers.get("cache-control") || "",
    /no-cache|no-store/,
    "fresh HTML after redeploy",
  );
  await request("/assets/missing-deployment-check.js", 404);
  const missingApi = await request("/api/missing-deployment-check", 404);
  assert.equal((await missingApi.json()).error.code, "not_found", "API error response");
  const hero = await request("/wind-hero.png");
  assert.match(hero.headers.get("content-type") || "", /image\/png/);
  console.log(
    `Container checks passed at ${base}: frontend and backend health, archived forecasts, routes, assets, caching, and missing paths.`,
  );
} catch (error) {
  console.error(`Container check failed at ${base}: ${error.message}`);
  process.exitCode = 1;
}
