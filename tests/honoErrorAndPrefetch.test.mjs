import assert from "node:assert/strict";
import { test } from "node:test";

import app from "../src/Hono.js";

const caiyunRealtimeBody = {
    status: "ok",
    api_version: "v2.6",
    lang: "zh_CN",
    server_time: 1795415760,
    location: [114.17, 22.32],
    result: {
        realtime: {
            status: "ok",
            cloudrate: 0.5,
            skycon: "CLEAR_DAY",
            humidity: 0.6,
            precipitation: { local: { intensity: 0 } },
            pressure: 101000,
            temperature: 22,
            apparent_temperature: 22,
            visibility: 10,
            wind: { direction: 90, speed: 3 },
            air_quality: {
                aqi: { chn: 35, usa: 35 },
                pm25: 12,
                pm10: 20,
                o3: 40,
                so2: 5,
                no2: 10,
                co: 0.5,
                description: { chn: "优", usa: "Good" },
            },
        },
    },
};

function hourlyBody(firstTs) {
    const hours = Array.from({ length: 273 }, (_, i) => ({
        skycon: { value: "CLEAR_DAY", datetime: new Date((firstTs + i * 3600) * 1000).toISOString() },
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
        server_time: 1795415760,
        location: [114.06, 22.54],
        result: {
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
                air_quality: {
                    aqi: hours.map(() => ({ value: { chn: 30, usa: 30 } })),
                },
            },
        },
    };
}

function dailyBody() {
    const days = Array.from({ length: 11 }, (_, i) => {
        const date = new Date(Date.UTC(2026, 10, 26 + i)).toISOString().slice(0, 10);
        return { date: `${date}T00:00:00+08:00`, skycon: "CLEAR_DAY", probability: 10 };
    });
    return {
        status: "ok",
        server_time: 1795415760,
        location: [114.06, 22.54],
        result: {
            daily: {
                status: "ok",
                skycon: days.map(item => ({ value: item.skycon, date: item.date })),
                skycon_08h_20h: days.map(item => ({ value: item.skycon })),
                skycon_20h_32h: days.map(item => ({ value: item.skycon })),
                precipitation: days.map(item => ({ probability: item.probability })),
                precipitation_08h_20h: days.map(item => ({ probability: item.probability })),
                precipitation_20h_32h: days.map(item => ({ probability: item.probability })),
                humidity: days.map(() => ({ max: 0.9, min: 0.6 })),
                temperature: days.map(() => ({ max: 25, min: 15 })),
                temperature_08h_20h: days.map(() => ({ max: 25, min: 15 })),
                temperature_20h_32h: days.map(() => ({ max: 25, min: 15 })),
                visibility: days.map(() => ({ max: 20, min: 10 })),
                wind: days.map(() => ({ avg: { speed: 3 }, max: { speed: 6 } })),
                wind_08h_20h: days.map(() => ({ avg: { direction: 90, speed: 3 }, max: { speed: 6 } })),
                wind_20h_32h: days.map(() => ({ avg: { direction: 100, speed: 3 }, max: { speed: 6 } })),
                cloudrate: days.map(() => ({ avg: 0.5 })),
            },
        },
    };
}

function weatherBody() {
    return {
        status: "ok",
        server_time: 1795415760,
        location: [114.06, 22.54],
        result: {
            realtime: caiyunRealtimeBody.result.realtime,
            minutely: {
                status: "ok",
                description: "未来2小时无降水",
                precipitation_2h: Array.from({ length: 120 }, () => 0),
                probability: [0, 0, 0, 0],
            },
            hourly: hourlyBody(1795415760).result.hourly,
            daily: dailyBody().result.daily,
            alert: { status: "ok", content: [] },
        },
    };
}

function createMockFetch(fetchCalls) {
    return async input => {
        const url = typeof input === "string" ? input : (input?.url ?? "");
        fetchCalls.push(url);
        if (url.includes("api.caiyunapp.com/v2.6/") && url.includes("/weather?")) return new Response(JSON.stringify(weatherBody()), { headers: { "Content-Type": "application/json" } });
        if (url.includes("api.caiyunapp.com/v2.6/") && url.includes("/realtime?")) return new Response(JSON.stringify(caiyunRealtimeBody), { headers: { "Content-Type": "application/json" } });
        if (url.includes("api.caiyunapp.com/v2.6/") && url.includes("/minutely?")) {
            return new Response(JSON.stringify({ status: "ok", server_time: 1795415760, location: [114.06, 22.54], result: { minutely: weatherBody().result.minutely } }), { headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("api.caiyunapp.com/v2.6/") && url.includes("/hourly?")) return new Response(JSON.stringify(hourlyBody(1795415760)), { headers: { "Content-Type": "application/json" } });
        if (url.includes("api.caiyunapp.com/v2.6/") && url.includes("/daily?")) return new Response(JSON.stringify(dailyBody()), { headers: { "Content-Type": "application/json" } });
        if (url.includes("weatherkit.apple.com")) return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
        return new Response(JSON.stringify({}), { headers: { "Content-Type": "application/json" } });
    };
}

test("onError returns a generic Internal Server Error without leaking the cause", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
        throw new Error("upstream exploded with secret detail");
    };
    try {
        const res = await app.request("https://weatherkit.test/api/v3/weather/zh-Hans/22.54/114.06?country=CN&dataSets=currentWeather", { headers: { "User-Agent": "Weather/1.0" } });
        assert.equal(res.status, 500);
        const text = await res.text();
        assert.equal(text, "Internal Server Error");
        assert.equal(text.includes("secret detail"), false);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("HK airQuality request triggers zero Caiyun prefetch and passes Apple through untouched", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = undefined;
    const fetchCalls = [];
    globalThis.fetch = createMockFetch(fetchCalls);
    try {
        const res = await app.request("https://weatherkit.test/api/v3/weather/zh-Hans/22.32/114.17?country=HK&dataSets=airQuality", { headers: { "User-Agent": "Weather/1.0" } });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.airQuality, undefined, `HK must pass Apple through without injected airQuality, got ${JSON.stringify(body.airQuality)}`);
        assert.equal(fetchCalls.filter(url => url.includes("api.caiyunapp.com")).length, 0, `HK must not touch Caiyun, got ${JSON.stringify(fetchCalls)}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("TW request triggers zero Caiyun prefetch", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = undefined;
    const fetchCalls = [];
    globalThis.fetch = createMockFetch(fetchCalls);
    try {
        const res = await app.request("https://weatherkit.test/api/v3/weather/zh-Hans/25.03/121.56?country=TW&dataSets=airQuality", { headers: { "User-Agent": "Weather/1.0" } });
        assert.equal(res.status, 200);
        assert.equal(fetchCalls.filter(url => url.includes("api.caiyunapp.com")).length, 0, `TW must not touch Caiyun, got ${JSON.stringify(fetchCalls)}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});

test("CN full request with relativeDailyStart prefetches the four-in-one /weather endpoint once", async () => {
    const originalFetch = globalThis.fetch;
    const originalCaches = globalThis.caches;
    globalThis.caches = undefined;
    const fetchCalls = [];
    globalThis.fetch = createMockFetch(fetchCalls);
    try {
        const res = await app.request("https://weatherkit.test/api/v3/weather/zh-Hans/22.54/114.06?country=CN&relativeDailyStart=-1&dataSets=currentWeather,forecastDaily,forecastHourly,forecastNextHour,airQuality,weatherAlerts", { headers: { "User-Agent": "Weather/1.0" } });
        assert.equal(res.status, 200);
        const weatherCalls = fetchCalls.filter(url => url.includes("/weather?"));
        assert.equal(weatherCalls.length, 1, `exactly one /weather prefetch expected, got ${JSON.stringify(fetchCalls)}`);
        assert.ok(weatherCalls[0].includes("begin="), `four-in-one fetch must carry the derived begin, got ${weatherCalls[0]}`);
    } finally {
        globalThis.fetch = originalFetch;
        globalThis.caches = originalCaches;
    }
});
