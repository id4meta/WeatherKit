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

function dailyResponse() {
    const days = [
        { skycon: "CLEAR_DAY", probability: 10, humidityMax: 0.9, humidityMin: 0.6, tempMax: 25, tempMin: 15, visibilityMax: 20, visibilityMin: 10, windAvg: 3, windMax: 6, cloudrate: 0.5 },
        { skycon: "LIGHT_RAIN", probability: 20, humidityMax: 0.8, humidityMin: 0.5, tempMax: 24, tempMin: 14, visibilityMax: 18, visibilityMin: 9, windAvg: 2, windMax: 5, cloudrate: 0.6 },
    ];
    const daytime = [
        { skycon: "CLEAR_DAY", probability: 10, tempMax: 25, tempMin: 18, direction: 90, speed: 3, speedMax: 6 },
        { skycon: "LIGHT_RAIN", probability: 20, tempMax: 24, tempMin: 17, direction: 80, speed: 2, speedMax: 5 },
    ];
    const overnight = [
        { skycon: "CLEAR_DAY", probability: 10, tempMax: 20, tempMin: 15, direction: 100, speed: 2, speedMax: 5 },
        { skycon: "LIGHT_RAIN", probability: 20, tempMax: 19, tempMin: 14, direction: 110, speed: 2, speedMax: 4 },
    ];
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            daily: {
                status: "ok",
                skycon: days.map((item, index) => ({ value: item.skycon, date: `2026-11-${24 + index}T00:00:00+08:00` })),
                skycon_08h_20h: daytime.map(item => ({ value: item.skycon })),
                skycon_20h_32h: overnight.map(item => ({ value: item.skycon })),
                precipitation: days.map(item => ({ probability: item.probability })),
                precipitation_08h_20h: daytime.map(item => ({ probability: item.probability })),
                precipitation_20h_32h: overnight.map(item => ({ probability: item.probability })),
                humidity: days.map(item => ({ max: item.humidityMax, min: item.humidityMin })),
                temperature: days.map(item => ({ max: item.tempMax, min: item.tempMin })),
                temperature_08h_20h: daytime.map(item => ({ max: item.tempMax, min: item.tempMin })),
                temperature_20h_32h: overnight.map(item => ({ max: item.tempMax, min: item.tempMin })),
                visibility: days.map(item => ({ max: item.visibilityMax, min: item.visibilityMin })),
                wind: days.map(item => ({ avg: { speed: item.windAvg }, max: { speed: item.windMax } })),
                wind_08h_20h: daytime.map(item => ({ avg: { direction: item.direction, speed: item.speed }, max: { speed: item.speedMax } })),
                wind_20h_32h: overnight.map(item => ({ avg: { direction: item.direction, speed: item.speed }, max: { speed: item.speedMax } })),
                cloudrate: days.map(item => ({ avg: item.cloudrate })),
            },
        },
    };
}

test("Daily with begin hits the edge cache with max-age=600", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify(dailyResponse()));
    };
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const firstResult = await newInstance().Daily(11, 1795449600);
        const secondResult = await newInstance().Daily(11, 1795450200);
        assert.equal(fetchCalls, 1);
        assert.equal(firstResult.days.length, 2);
        assert.equal(secondResult.days.length, 2);
        assert.equal(mockCache.putCalls.length, 1);
        assert.equal(mockCache.putCalls[0].url, "https://cache.internal/caiyun/v2.6/daily/114.06,22.54?lang=zh_CN&steps=11&begin=1795449600");
        assert.ok(!mockCache.putCalls[0].url.includes("test-token"), `cache key must not contain the token, got ${mockCache.putCalls[0].url}`);
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=600"), `Cache-Control must contain max-age=600, got ${mockCache.putCalls[0].cacheControl}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

function hourlyResponse273() {
    const hours = Array.from({ length: 273 }, (_, i) => ({
        skycon: { value: "CLEAR_DAY", datetime: new Date((1795415760 + i * 3600) * 1000).toISOString() },
        cloudrate: { value: 0.5 },
        humidity: { value: 0.8 },
        precipitation: { value: 0, probability: 10 },
        pressure: { value: 100000 },
        temperature: { value: 20 },
        apparent_temperature: { value: 20 },
        visibility: { value: 10 },
        wind: { direction: 90, speed: 3 },
    }));
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            hourly: {
                status: "ok",
                skycon: hours.map(hour => hour.skycon),
                cloudrate: hours.map(hour => hour.cloudrate),
                humidity: hours.map(hour => hour.humidity),
                precipitation: hours.map(hour => hour.precipitation),
                pressure: hours.map(hour => hour.pressure),
                temperature: hours.map(hour => hour.temperature),
                apparent_temperature: hours.map(hour => hour.apparent_temperature),
                visibility: hours.map(hour => hour.visibility),
                wind: hours.map(hour => hour.wind),
            },
        },
    };
}

test("ForecastHourly with begin and 273 steps uses max-age=300", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = async () => new Response(JSON.stringify(hourlyResponse273()));
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const result = await newInstance().ForecastHourly(273, 1795449600);
        assert.equal(result.hours.length, 273);
        assert.equal(mockCache.putCalls.length, 1);
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=300"), `Cache-Control must contain max-age=300, got ${mockCache.putCalls[0].cacheControl}`);
        assert.ok(!mockCache.putCalls[0].cacheControl.includes("max-age=1800"), `Cache-Control must not contain max-age=1800, got ${mockCache.putCalls[0].cacheControl}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

function yesterdayHourlyResponse() {
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            hourly: {
                status: "ok",
                air_quality: { aqi: [{ value: { usa: 60, chn: 50 } }] },
            },
        },
    };
}

test("YesterdayAirQuality uses max-age=1800", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = async () => new Response(JSON.stringify(yesterdayHourlyResponse()));
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        const result = await newInstance().YesterdayAirQuality();
        assert.equal(result.index, 60);
        assert.equal(mockCache.putCalls.length, 1);
        assert.ok(mockCache.putCalls[0].cacheControl.includes("max-age=1800"), `Cache-Control must contain max-age=1800, got ${mockCache.putCalls[0].cacheControl}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
