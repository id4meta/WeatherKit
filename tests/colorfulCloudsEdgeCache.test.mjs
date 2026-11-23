import assert from "node:assert/strict";
import test from "node:test";
import ColorfulClouds from "../src/class/ColorfulClouds.mjs";

function realtimeResponse(temperature = 20, intensity = 0) {
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            realtime: {
                status: "ok",
                cloudrate: 0.5,
                skycon: "LIGHT_RAIN",
                humidity: 0.8,
                pressure: 100000,
                temperature,
                apparent_temperature: 19,
                visibility: 10,
                wind: { direction: 90, speed: 3 },
                precipitation: { local: { intensity } },
            },
            alert: { status: "ok", content: [] },
        },
    };
}

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

function newInstance() {
    return new ColorfulClouds({ country: "CN", language: "zh-CN", latitude: "22.54", longitude: "114.06" }, "test-token");
}

test("Edge cache serves the second new instance with one upstream fetch", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify(realtimeResponse(20)));
    };
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const firstResult = await newInstance().CurrentWeather();
        const secondResult = await newInstance().CurrentWeather();
        assert.equal(fetchCalls, 1);
        assert.equal(firstResult.temperature, 20);
        assert.equal(secondResult.temperature, 20);
        assert.equal(mockCache.putCalls.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Edge cache key never contains the token and stores max-age=60", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = async () => new Response(JSON.stringify(realtimeResponse(20)));
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const result = await newInstance().CurrentWeather();
        assert.equal(result.temperature, 20);
        assert.equal(mockCache.putCalls.length, 1);
        assert.equal(mockCache.putCalls[0].url, "https://cache.internal/caiyun/v2.6/realtime/114.060,22.540?lang=zh_CN");
        assert.ok(!mockCache.putCalls[0].url.includes("test-token"), `cache key must not contain the token, got ${mockCache.putCalls[0].url}`);
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=60"), `Cache-Control must contain max-age=60, got ${mockCache.putCalls[0].cacheControl}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Failed upstream responses are never written to the edge cache", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify({ status: "failed" }));
    };
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const result = await newInstance().CurrentWeather();
        assert.equal(fetchCalls, 1);
        assert.equal(mockCache.putCalls.length, 0);
        assert.equal(result.metadata.temporarilyUnavailable, true);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Falls back to direct fetch when globalThis.caches is undefined", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify(realtimeResponse(20)));
    };
    globalThis.caches = undefined;
    try {
        const result = await newInstance().CurrentWeather();
        assert.equal(fetchCalls, 1);
        assert.equal(result.temperature, 20);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
