import assert from "node:assert/strict";
import test from "node:test";
import QWeather from "../src/class/QWeather.mjs";

const sourceHtml = `<!doctype html>
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

function createMockCache() {
    const store = new Map();
    const putCalls = [];
    return {
        putCalls,
        store,
        async match(request) {
            const url = typeof request === "string" ? request : request.url;
            const entry = store.get(url);
            if (!entry) return undefined;
            return new Response(entry.text, { headers: entry.headers });
        },
        async put(request, response) {
            const url = typeof request === "string" ? request : request.url;
            const text = await response.text();
            const headers = {};
            for (const [key, value] of response.headers.entries()) headers[key] = value;
            putCalls.push({ url, cacheControl: headers["cache-control"] ?? "" });
            store.set(url, { text, headers });
        },
    };
}

test("FetchWeatherAlertPage caches the parsed page for 180s and skips the second upstream fetch", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(sourceHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const firstResult = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        const secondResult = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(fetchCalls, 1);
        assert.deepEqual(secondResult, firstResult);
        assert.equal(firstResult.alerts.length, 1);
        assert.equal(firstResult.alerts[0].description, "建邺区气象台发布雷暴橙色预警信号。");
        assert.equal(firstResult.alerts[0].source, "建邺区气象台");
        assert.equal(firstResult.source, "建邺区气象台");
        assert.equal(mockCache.putCalls.length, 1);
        assert.equal(mockCache.putCalls[0].url, "https://cache.internal/qweather/alert-page/jianye-101190110?lang=zh-CN");
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=180"), `Cache-Control must contain max-age=180, got ${mockCache.putCalls[0].cacheControl}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("FetchWeatherAlertPage cache write is non-blocking when waitUntil is provided", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = async () => new Response(sourceHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    const pending = [];
    const waitUntil = promise => {
        pending.push(promise);
    };
    try {
        const result = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {}, waitUntil);
        assert.equal(result.alerts.length, 1);
        assert.equal(pending.length, 1);
        await Promise.all(pending);
        assert.equal(mockCache.putCalls.length, 1);
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=180"), `Cache-Control must contain max-age=180, got ${mockCache.putCalls[0].cacheControl}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("FetchWeatherAlertPage never caches non-200 responses", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/html" } });
    };
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const firstResult = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        const secondResult = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(fetchCalls, 2);
        assert.deepEqual(firstResult.alerts, []);
        assert.deepEqual(secondResult.alerts, []);
        assert.equal(mockCache.putCalls.length, 0);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("FetchWeatherAlertPage ignores a cached entry without an alerts array", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(sourceHtml, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    };
    const mockCache = createMockCache();
    mockCache.store.set("https://cache.internal/qweather/alert-page/jianye-101190110?lang=zh-CN", {
        text: JSON.stringify({ foo: 1 }),
        headers: { "content-type": "application/json" },
    });
    globalThis.caches = { default: mockCache };
    try {
        const result = await QWeather.FetchWeatherAlertPage("jianye-101190110", "zh-CN", {});
        assert.equal(fetchCalls, 1);
        assert.equal(result.alerts.length, 1);
        assert.equal(mockCache.putCalls.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
