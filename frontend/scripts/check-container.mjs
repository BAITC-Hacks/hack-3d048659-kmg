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
  await request("/api/missing-deployment-check", 404);
  const hero = await request("/wind-hero.png");
  assert.match(hero.headers.get("content-type") || "", /image\/png/);
  console.log(
    `Container checks passed at ${base}: health, routes, assets, caching, and missing paths.`,
  );
} catch (error) {
  console.error(`Container check failed at ${base}: ${error.message}`);
  process.exitCode = 1;
}
