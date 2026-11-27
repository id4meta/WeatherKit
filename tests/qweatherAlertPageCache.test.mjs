import assert from "node:assert/strict";
import { test } from "node:test";

const alertPageHtml = `<!doctype html>
<html>
    <head><title>建邺天气预警</title></head>
    <body>
        <h1 class="c-submenu__location">建邺</h1>
        <span class="c-submenu__location-adm">江苏 南京</span>
        <div class="c-city-warning-events warning--orange">
            <h3>建邺区气象台发布雷暴橙色预警信号。</h3>
            <p>发布日期：2026-07-31T11:00:00+08:00</p>
            <p class="warning-events__txt">预计午后将出现雷暴天气。</p>
            <div class="warning-explain"><h4>Description</h4><p>可能伴有短时强降水。</p></div>
            <div class="warning-defense__txt"><p>1. 注意防范雷电。</p><p>2. 远离高大树木。</p></div>
        </div>
        <div class="c-city-warning-around"></div>
        <div class="c-data-source">
            <a href="http://www.12379.cn" class="data-source__txt">预警数据来源：国家预警信息发布中心</a>
        </div>
    </body>
</html>`;

const emptyAlertPageHtml = `<!doctype html>
<html>
    <head><title>建邺天气预警</title></head>
    <body>
        <h1 class="c-submenu__location">建邺</h1>
        <span class="c-submenu__location-adm">江苏 南京</span>
        <div class="c-data-source">
            <a href="http://www.12379.cn" class="data-source__txt">预警数据来源：国家预警信息发布中心</a>
        </div>
    </body>
</html>`;

function createMockCache() {
    const store = new Map();
    const putCalls = [];
    return {
        store,
        putCalls,
        async match(request) {
            const url = typeof request === "string" ? request : request.url;
            const entry = store.get(url);
            if (!entry) return undefined;
            return new Response(entry.text, { headers: { "Content-Type": "application/json" } });
        },
        async put(request, response) {
            const url = typeof request === "string" ? request : request.url;
            const text = await response.text();
            const cacheControl = response.headers.get("Cache-Control") ?? "";
            store.set(url, { text, headers: { "cache-control": cacheControl } });
            putCalls.push({ url, cacheControl });
        },
    };
}

test("FetchWeatherAlertPage caches non-empty results for 180 seconds and reuses them", async () => {
    const { default: QWeather } = await import("../src/class/QWeather.mjs");
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        return new Response(alertPageHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    try {
        const first = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(first.alerts.length, 1);
        assert.equal(fetchCalls, 1);
        assert.equal(mockCache.putCalls.length, 1);
        assert.equal(mockCache.putCalls[0].url, "https://cache.internal/qweather/alert-page/jianye-101190110?lang=zh-CN");
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=180"), `Cache-Control must contain max-age=180, got ${mockCache.putCalls[0].cacheControl}`);
        const second = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(fetchCalls, 1, "second call must reuse the cache without fetching upstream");
        assert.equal(second.alerts.length, 1);
        assert.equal(second.alerts[0].headline, first.alerts[0].headline);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("FetchWeatherAlertPage never caches empty alert results", async () => {
    const { default: QWeather } = await import("../src/class/QWeather.mjs");
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls += 1;
        return new Response(emptyAlertPageHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    try {
        const first = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(first.alerts.length, 0);
        assert.equal(mockCache.putCalls.length, 0, "empty results must never be written to the cache");
        await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(fetchCalls, 2, "second call must fetch upstream again when nothing was cached");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("FetchWeatherAlertPage writes the cache via waitUntil when provided", async () => {
    const { default: QWeather } = await import("../src/class/QWeather.mjs");
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    globalThis.fetch = async () => new Response(alertPageHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const waitUntilCalls = [];
    try {
        const result = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {}, promise => {
            waitUntilCalls.push(promise);
        });
        assert.equal(result.alerts.length, 1);
        assert.equal(waitUntilCalls.length, 1, "cache write must be handed to waitUntil");
        await waitUntilCalls[0];
        assert.equal(mockCache.putCalls.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("FetchWeatherAlertPage times out after 4000ms", async () => {
    const { default: QWeather } = await import("../src/class/QWeather.mjs");
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = () => new Promise(() => {});
    globalThis.caches = undefined;
    try {
        const startedAt = Date.now();
        await assert.rejects(QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {}), /timed out/);
        const elapsedMs = Date.now() - startedAt;
        assert.ok(elapsedMs >= 3900, `must wait out the 4000ms timeout, elapsed ${elapsedMs}ms`);
        assert.ok(elapsedMs < 15000, `must not hang past the timeout, elapsed ${elapsedMs}ms`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("WeatherAlertWeb passes waitUntil through to FetchWeatherAlertPage for non-blocking cache writes", async () => {
    const { default: QWeather } = await import("../src/class/QWeather.mjs");
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    globalThis.fetch = async () => new Response(alertPageHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const waitUntilCalls = [];
    try {
        const provider = new QWeather({ country: "CN", language: "zh-CN", latitude: "32.115", longitude: "118.814" }, "test-token", undefined, promise => {
            waitUntilCalls.push(promise);
        });
        const result = await provider.WeatherAlertWeb("https://www.qweather.com/severe-weather/jianye-101190110.html?from=AppleWeatherService");
        assert.equal(result.alerts.length, 1);
        assert.equal(waitUntilCalls.length, 1, "cache write must be handed to the instance waitUntil");
        await waitUntilCalls[0];
        assert.equal(mockCache.putCalls.length, 1, "cache write must complete via waitUntil");
        assert.equal(mockCache.putCalls[0].url, "https://cache.internal/qweather/alert-page/jianye-101190110?lang=zh-CN");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
