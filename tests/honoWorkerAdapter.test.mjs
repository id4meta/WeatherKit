import assert from "node:assert/strict";
import test from "node:test";
import HonoWorkerAdapter from "../src/class/HonoWorkerAdapter.mjs";

test("WeatherKit endpoints route requests to Apple", () => {
    const cases = [
        ["https://weatherkit.pages.dev/api/v1/weatherAlerts?ids=jianye-101190110", "api/v1/weatherAlerts"],
        ["https://weatherkit.pages.dev/weatherkit.apple.com/api/v1/weatherAlerts?ids=jianye-101190110", "weatherkit.apple.com/api/v1/weatherAlerts"],
    ];
    for (const [input, restPath] of cases) {
        const url = HonoWorkerAdapter.routeRewrite(new URL(input), restPath);
        assert.equal(url.toString(), "https://weatherkit.apple.com/api/v1/weatherAlerts?ids=jianye-101190110", input);
    }
});

test("buildArgument leaves the request URL untouched without uppercase-leading query keys", () => {
    const url = "https://weatherkit.test/api/v3/weather/zh-Hans/22.54/114.06?country=CN&dataSets=currentWeather";
    const $request = { headers: {}, method: "GET", url };
    const result = HonoWorkerAdapter.buildArgument($request);
    assert.equal(result, $request);
    assert.equal($request.url, url, "no uppercase-leading keys means no rewrite");
    assert.equal(globalThis.$argument, "country=CN&dataSets=currentWeather");
});

test("buildArgument strips uppercase-leading query keys and rewrites the request URL", () => {
    const $request = { headers: {}, method: "GET", url: "https://weatherkit.test/api/v3/weather/zh-Hans/22.54/114.06?LogLevel=DEBUG&country=CN&dataSets=currentWeather" };
    HonoWorkerAdapter.buildArgument($request);
    assert.equal($request.url, "https://weatherkit.test/api/v3/weather/zh-Hans/22.54/114.06?country=CN&dataSets=currentWeather");
    assert.equal(globalThis.$argument, "LogLevel=DEBUG&country=CN&dataSets=currentWeather", "the original query string stays available as $argument");
});

test("cleanupResponseHeaders removes hop-by-hop headers regardless of casing", () => {
    const cleaned = HonoWorkerAdapter.cleanupResponseHeaders({
        "CONTENT-ENCODING": "gzip",
        "Content-length": "123",
        "Transfer-Encoding": "chunked",
        "Content-Type": "application/json",
        "X-Custom": "keep",
    });
    assert.deepEqual(cleaned, { "Content-Type": "application/json", "X-Custom": "keep" });
});
