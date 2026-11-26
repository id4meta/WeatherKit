import assert from "node:assert/strict";
import test from "node:test";
import app from "../src/Hono.js";

function realtimeResponse() {
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.15, 22.28],
            realtime: {
                status: "ok",
                cloudrate: 0.5,
                skycon: "CLEAR_DAY",
                humidity: 0.8,
                pressure: 100000,
                temperature: 20,
                apparent_temperature: 19,
                visibility: 10,
                wind: { direction: 90, speed: 3 },
                precipitation: { local: { intensity: 0 } },
                air_quality: { description: { usa: "Good" }, aqi: { usa: 30, chn: 25 } },
            },
            alert: { status: "ok", content: [] },
        },
    };
}

test("Hono onError returns a generic 500 without leaking the original error", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = async () => {
        throw new Error("SECRET-UPSTREAM-BOOM");
    };
    globalThis.caches = undefined;
    try {
        const response = await app.request("https://weatherkit.pages.dev/api/v3/weather/zh-Hans/22.54/114.06?country=CN&dataSets=currentWeather");
        const text = await response.text();
        assert.equal(response.status, 500);
        assert.equal(text, "Internal Server Error");
        assert.ok(!text.includes("SECRET-UPSTREAM-BOOM"), `error response must not leak the original message, got ${text}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Hono prefetches realtime for HK airQuality requests", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const fetchedUrls = [];
    globalThis.fetch = async input => {
        fetchedUrls.push(String(input));
        if (String(input).includes("caiyunapp")) return new Response(JSON.stringify(realtimeResponse()));
        throw new Error("UPSTREAM");
    };
    globalThis.caches = undefined;
    try {
        const response = await app.request("https://weatherkit.pages.dev/api/v3/weather/zh-Hant-HK/22.28/114.15?country=HK&dataSets=airQuality");
        assert.ok(
            fetchedUrls.some(url => url.includes("api.caiyunapp.com") && url.includes("/realtime")),
            `expected a Caiyun realtime prefetch, got ${JSON.stringify(fetchedUrls)}`,
        );
        assert.equal(response.status, 500);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Hono does not prefetch for TW airQuality requests", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const fetchedUrls = [];
    globalThis.fetch = async input => {
        fetchedUrls.push(String(input));
        throw new Error("UPSTREAM");
    };
    globalThis.caches = undefined;
    try {
        const response = await app.request("https://weatherkit.pages.dev/api/v3/weather/zh-Hant-TW/25.03/121.56?country=TW&dataSets=airQuality");
        assert.ok(
            !fetchedUrls.some(url => url.includes("caiyunapp")),
            `expected no Caiyun request for TW, got ${JSON.stringify(fetchedUrls)}`,
        );
        assert.equal(response.status, 500);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Hono does not prefetch HK requests without airQuality", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const fetchedUrls = [];
    globalThis.fetch = async input => {
        fetchedUrls.push(String(input));
        throw new Error("UPSTREAM");
    };
    globalThis.caches = undefined;
    try {
        const response = await app.request("https://weatherkit.pages.dev/api/v3/weather/zh-Hant-HK/22.28/114.15?country=HK&dataSets=currentWeather");
        assert.ok(
            !fetchedUrls.some(url => url.includes("caiyunapp")),
            `expected no Caiyun request for HK without airQuality, got ${JSON.stringify(fetchedUrls)}`,
        );
        assert.equal(response.status, 500);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
