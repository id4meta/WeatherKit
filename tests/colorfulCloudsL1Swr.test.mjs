import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import ColorfulClouds from "../src/class/ColorfulClouds.mjs";

function realtimeResponse(temperature = 20) {
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            realtime: {
                status: "ok",
                cloudrate: 0.5,
                skycon: "CLEAR_DAY",
                humidity: 0.8,
                pressure: 100000,
                temperature,
                apparent_temperature: 19,
                visibility: 10,
                wind: { direction: 90, speed: 3 },
                precipitation: { local: { intensity: 0 } },
            },
            alert: { status: "ok", content: [] },
        },
    };
}

function minutelyResponse(probability = [0.1, 0.2, 0.3, 0.4]) {
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            minutely: {
                status: "ok",
                description: "未来2小时有降水",
                precipitation_2h: Array.from({ length: 120 }, () => 0.01),
                probability,
            },
        },
    };
}

function hourlyResponse(hours = 2) {
    const list = Array.from({ length: hours }, (_, i) => ({
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
                skycon: list.map(hour => hour.skycon),
                cloudrate: list.map(hour => hour.cloudrate),
                humidity: list.map(hour => hour.humidity),
                precipitation: list.map(hour => hour.precipitation),
                pressure: list.map(hour => hour.pressure),
                temperature: list.map(hour => hour.temperature),
                apparent_temperature: list.map(hour => hour.apparent_temperature),
                visibility: list.map(hour => hour.visibility),
                wind: list.map(hour => hour.wind),
            },
        },
    };
}

function dailyResponse() {
    return {
        status: "ok",
        result: {
            server_time: 1795415760,
            location: [114.06, 22.54],
            daily: {
                status: "ok",
                skycon: [{ value: "CLEAR_DAY", date: "2026-11-24T00:00:00+08:00" }],
                skycon_08h_20h: [{ value: "CLEAR_DAY" }],
                skycon_20h_32h: [{ value: "CLEAR_DAY" }],
                precipitation: [{ probability: 10 }],
                precipitation_08h_20h: [{ probability: 10 }],
                precipitation_20h_32h: [{ probability: 10 }],
                humidity: [{ max: 0.9, min: 0.6 }],
                temperature: [{ max: 25, min: 15 }],
                temperature_08h_20h: [{ max: 25, min: 18 }],
                temperature_20h_32h: [{ max: 20, min: 15 }],
                visibility: [{ max: 20, min: 10 }],
                wind: [{ avg: { speed: 3 }, max: { speed: 6 } }],
                wind_08h_20h: [{ avg: { direction: 90, speed: 3 }, max: { speed: 6 } }],
                wind_20h_32h: [{ avg: { direction: 100, speed: 2 }, max: { speed: 5 } }],
                cloudrate: [{ avg: 0.5 }],
            },
        },
    };
}

function createMockCache() {
    const store = new Map();
    const putCalls = [];
    let matchCalls = 0;
    return {
        putCalls,
        store,
        get matchCalls() {
            return matchCalls;
        },
        async match(request) {
            matchCalls++;
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

function newInstance(latitude = "22.54", longitude = "114.06", waitUntil) {
    return new ColorfulClouds({ country: "CN", language: "zh-CN", latitude, longitude }, "test-token", waitUntil);
}

beforeEach(() => ColorfulClouds.clearL1Cache());

test("L1 hit skips caches.default.match on the second call", async () => {
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
        assert.equal((await newInstance().CurrentWeather()).temperature, 20);
        assert.equal((await newInstance().CurrentWeather()).temperature, 20);
        assert.equal(fetchCalls, 1, "second call must not fetch upstream");
        assert.equal(mockCache.matchCalls, 1, "second call must not consult L2 at all");
        assert.equal(mockCache.putCalls.length, 1);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("L1 evicts the earliest entry past 64 entries", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = undefined;
    const fetchUrls = [];
    globalThis.fetch = async input => {
        const url = typeof input === "string" ? input : (input?.url ?? "");
        fetchUrls.push(url);
        return new Response(JSON.stringify(realtimeResponse(20)));
    };
    try {
        const coords = Array.from({ length: 65 }, (_, i) => ({ latitude: (22.54 + i * 0.01).toFixed(2), longitude: "114.06" }));
        for (const { latitude, longitude } of coords) await newInstance(latitude, longitude).CurrentWeather();
        assert.equal(fetchUrls.length, 65);
        await newInstance(coords[0].latitude, coords[0].longitude).CurrentWeather();
        assert.equal(fetchUrls.length, 66, "evicted earliest entry must fetch upstream again");
        assert.ok(fetchUrls[65].includes(`114.06,${coords[0].latitude}/realtime`), `re-fetch must target the evicted coordinates, got ${fetchUrls[65]}`);
        await newInstance(coords[64].latitude, coords[64].longitude).CurrentWeather();
        assert.equal(fetchUrls.length, 66, "newest entry must still be in L1");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("Minutely does not mutate the cached L1 body in place", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = undefined;
    globalThis.fetch = async () => new Response(JSON.stringify(minutelyResponse([0.1, 0.2, 0.3, 0.4])));
    try {
        const first = await newInstance().Minutely();
        assert.equal(first.minutes[0].precipitationChance, 10);
        assert.equal(first.minutes[31].precipitationChance, 20);
        const cached = await newInstance().prefetchMinutely();
        assert.deepEqual(cached.result.minutely.probability, [0.1, 0.2, 0.3, 0.4], `L1 body must keep the raw upstream probabilities, got ${JSON.stringify(cached.result.minutely.probability)}`);
        const second = await newInstance().Minutely();
        assert.equal(second.minutes[0].precipitationChance, 10);
        assert.equal(second.minutes[61].precipitationChance, 30);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("minutely uses 2-digit coordinate precision in the L2 cache key", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.fetch = async () => new Response(JSON.stringify(minutelyResponse()));
    const mockCache = createMockCache();
    globalThis.caches = { default: mockCache };
    try {
        await newInstance().Minutely();
        assert.equal(mockCache.putCalls.length, 1);
        assert.equal(mockCache.putCalls[0].url, "https://cache.internal/caiyun/v2.6/minutely/114.06,22.54?lang=zh_CN");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("hourly soft-expired L2 entry returns immediately and refreshes in the background via waitUntil", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    const seeded = hourlyResponse(2);
    mockCache.store.set("https://cache.internal/caiyun/v2.6/hourly/114.06,22.54?lang=zh_CN&steps=2", {
        text: JSON.stringify(seeded),
        headers: { "cache-control": "public, max-age=1800", "x-cached-at": String(Date.now() - 700 * 1000) },
    });
    let fetchCalls = 0;
    let resolveFetch;
    globalThis.fetch = () =>
        new Promise(resolve => {
            fetchCalls++;
            resolveFetch = () => resolve(new Response(JSON.stringify(hourlyResponse(2))));
        });
    const waitUntilCalls = [];
    globalThis.caches = { default: mockCache };
    try {
        const startedAt = Date.now();
        const result = await newInstance("22.54", "114.06", promise => {
            waitUntilCalls.push(promise);
        }).ForecastHourly(2);
        const elapsedMs = Date.now() - startedAt;
        assert.equal(result.hours.length, 2, "soft-expired entry must return immediately");
        assert.ok(elapsedMs < 2000, `must not wait for the background refresh, elapsed ${elapsedMs}ms`);
        assert.equal(waitUntilCalls.length, 1, "one background SWR refresh must be scheduled");
        assert.equal(fetchCalls, 1, "background refresh must fetch upstream once");
        resolveFetch();
        await waitUntilCalls[0];
        const refreshed = JSON.parse(mockCache.store.get("https://cache.internal/caiyun/v2.6/hourly/114.06,22.54?lang=zh_CN&steps=2").text);
        assert.equal(refreshed.result.hourly.skycon.length, 2);
        assert.ok(mockCache.store.get("https://cache.internal/caiyun/v2.6/hourly/114.06,22.54?lang=zh_CN&steps=2").headers["x-cached-at"], "refreshed entry must carry a fresh X-Cached-At");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("hourly SWR refresh is deduplicated by swrInflight", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    mockCache.store.set("https://cache.internal/caiyun/v2.6/hourly/114.06,22.54?lang=zh_CN&steps=2", {
        text: JSON.stringify(hourlyResponse(2)),
        headers: { "cache-control": "public, max-age=1800", "x-cached-at": String(Date.now() - 700 * 1000) },
    });
    let fetchCalls = 0;
    let resolveFetch;
    globalThis.fetch = () =>
        new Promise(resolve => {
            fetchCalls++;
            resolveFetch = () => resolve(new Response(JSON.stringify(hourlyResponse(2))));
        });
    const waitUntilCalls = [];
    const waitUntil = promise => {
        waitUntilCalls.push(promise);
    };
    globalThis.caches = { default: mockCache };
    try {
        const first = await newInstance("22.54", "114.06", waitUntil).ForecastHourly(2);
        assert.equal(first.hours.length, 2);
        assert.equal(fetchCalls, 1, "first call must start exactly one background refresh");
        ColorfulClouds.clearL1Cache();
        const second = await newInstance("22.54", "114.06", waitUntil).ForecastHourly(2);
        assert.equal(second.hours.length, 2);
        assert.equal(waitUntilCalls.length, 1, "second call must not schedule a duplicate refresh while one is in flight");
        assert.equal(fetchCalls, 1, "second call must not start a duplicate upstream fetch");
        resolveFetch();
        await waitUntilCalls[0];
        assert.equal(fetchCalls, 1);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("daily soft-expired L2 entry returns immediately and refreshes in the background via waitUntil", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    mockCache.store.set("https://cache.internal/caiyun/v2.6/daily/114.06,22.54?lang=zh_CN&steps=1", {
        text: JSON.stringify(dailyResponse()),
        headers: { "cache-control": "public, max-age=3600", "x-cached-at": String(Date.now() - 1500 * 1000) },
    });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify(dailyResponse()));
    };
    const waitUntilCalls = [];
    globalThis.caches = { default: mockCache };
    try {
        const result = await newInstance("22.54", "114.06", promise => {
            waitUntilCalls.push(promise);
        }).Daily(1);
        assert.equal(result.days.length, 1, "soft-expired entry must return immediately");
        assert.equal(waitUntilCalls.length, 1, "one background SWR refresh must be scheduled");
        await waitUntilCalls[0];
        assert.equal(fetchCalls, 1, "background refresh must fetch upstream once");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("realtime past hard expiry re-fetches instead of serving stale data", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const mockCache = createMockCache();
    mockCache.store.set("https://cache.internal/caiyun/v2.6/realtime/114.06,22.54?lang=zh_CN", {
        text: JSON.stringify(realtimeResponse(10)),
        headers: { "cache-control": "public, max-age=120", "x-cached-at": String(Date.now() - 1000 * 1000) },
    });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify(realtimeResponse(20)));
    };
    const waitUntilCalls = [];
    globalThis.caches = { default: mockCache };
    try {
        const result = await newInstance("22.54", "114.06", promise => {
            waitUntilCalls.push(promise);
        }).CurrentWeather();
        assert.equal(result.temperature, 20, "expired realtime must come from upstream, not the stale entry");
        assert.equal(fetchCalls, 1, "expired realtime must re-fetch synchronously with no background refresh fetch");
        assert.equal(waitUntilCalls.length, 1, "the single waitUntil call is the non-blocking write of the fresh fetch, not an SWR refresh");
        await waitUntilCalls[0];
        assert.equal(JSON.parse(mockCache.store.get("https://cache.internal/caiyun/v2.6/realtime/114.06,22.54?lang=zh_CN").text).result.realtime.temperature, 20, "L2 must hold the fresh upstream body after the write");
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("L2 realtime entry keeps its real age when backfilled into L1 and re-fetches once past hard expiry", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    const originalDateNow = Date.now;
    const mockCache = createMockCache();
    const T0 = Date.now();
    let fakeNow = T0;
    Date.now = () => fakeNow;
    mockCache.store.set("https://cache.internal/caiyun/v2.6/realtime/114.06,22.54?lang=zh_CN", {
        text: JSON.stringify(realtimeResponse(10)),
        headers: { "cache-control": "public, max-age=120", "x-cached-at": String(T0 - 115 * 1000) },
    });
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(JSON.stringify(realtimeResponse(20)));
    };
    globalThis.caches = { default: mockCache };
    try {
        const first = await newInstance().CurrentWeather();
        assert.equal(first.temperature, 10, "115s-old L2 entry must serve immediately");
        assert.equal(fetchCalls, 0, "L2 hit must not fetch upstream");
        assert.equal(mockCache.matchCalls, 1, "first call must consult L2 once");
        const second = await newInstance().CurrentWeather();
        assert.equal(second.temperature, 10, "same-time second call must serve the backfilled L1 entry");
        assert.equal(fetchCalls, 0, "L1 hit must not fetch upstream");
        assert.equal(mockCache.matchCalls, 1, "L1 hit must not consult L2 again, proving the backfill happened");
        fakeNow = T0 + 6 * 1000;
        const third = await newInstance().CurrentWeather();
        assert.equal(third.temperature, 20, "entry past its real 120s hard expiry must come from upstream, not a renewed L1");
        assert.equal(fetchCalls, 1, "expired entry must re-fetch exactly once");
    } finally {
        Date.now = originalDateNow;
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
