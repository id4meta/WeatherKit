import assert from "node:assert/strict";
import test from "node:test";
import ColorfulClouds from "../src/class/ColorfulClouds.mjs";

function hourlyResponse(probabilities) {
    const hours = probabilities.map((probability, index) => ({
        skycon: { value: "CLEAR_DAY", datetime: `2026-11-24T${String(index).padStart(2, "0")}:00:00+08:00` },
        cloudrate: { value: 0.5 },
        humidity: { value: 0.8 },
        precipitation: { value: 0, probability },
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

async function hourlyChances(probabilities) {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(hourlyResponse(probabilities)));
    try {
        const colorfulClouds = new ColorfulClouds({ country: "CN", language: "zh-CN", latitude: "22.54", longitude: "114.06" }, "test-token");
        const result = await colorfulClouds.ForecastHourly(probabilities.length);
        return result.hours.map(hour => hour.precipitationChance);
    } finally {
        globalThis.fetch = originalFetch;
    }
}

test("ForecastHourly normalizes decimal-scale probabilities to 0-100", async () => {
    assert.deepEqual(
        await hourlyChances([0, 0.25, 0.96, 1, undefined]),
        [0, 25, 96, 100, undefined],
    );
});

test("ForecastHourly keeps percent-scale probabilities and missing values undefined", async () => {
    assert.deepEqual(
        await hourlyChances([0, 1, 10, 85, null]),
        [0, 1, 10, 85, undefined],
    );
});

test("ForecastHourly clamps out-of-range probabilities to 0-100", async () => {
    assert.deepEqual(
        await hourlyChances([-5, 120]),
        [0, 100],
    );
});

test("Minutely skips HK, MO, TW, UA and PL without fetching", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        throw new Error("fetch must not be called for unsupported Minutely countries");
    };
    try {
        for (const country of ["HK", "MO", "TW", "UA", "PL"]) {
            const colorfulClouds = new ColorfulClouds({ country, language: "zh-CN", latitude: "22.54", longitude: "114.06" }, "test-token");
            assert.equal(await colorfulClouds.Minutely(), undefined);
        }
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("CurrentAirQuality skips HK and MO without fetching", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        throw new Error("fetch must not be called for unsupported AirQuality countries");
    };
    try {
        for (const country of ["HK", "MO"]) {
            const colorfulClouds = new ColorfulClouds({ country, language: "zh-CN", latitude: "22.54", longitude: "114.06" }, "test-token");
            const result = await colorfulClouds.CurrentAirQuality();
            assert.equal(result.metadata.temporarilyUnavailable, true);
        }
        assert.equal(fetchCalls, 0);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

function realtimeResponse(intensity) {
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
                temperature: 20,
                apparent_temperature: 19,
                visibility: 10,
                wind: { direction: 90, speed: 3 },
                precipitation: { local: { intensity } },
            },
            alert: { status: "ok", content: [] },
        },
    };
}

test("CurrentWeather converts a 15.0 mm/h local intensity to the Weibull perceived scale", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(realtimeResponse(15.0)));
    try {
        const colorfulClouds = new ColorfulClouds({ country: "CN", language: "zh-CN", latitude: "22.54", longitude: "114.06" }, "test-token");
        const result = await colorfulClouds.CurrentWeather();
        assert.equal(result.precipitationIntensity, 15);
        assert.ok(result.perceivedPrecipitationIntensity > 2.4 && result.perceivedPrecipitationIntensity < 2.6, `perceivedPrecipitationIntensity must be a Weibull value in (2.4, 2.6), got ${result.perceivedPrecipitationIntensity}`);
        assert.notEqual(result.perceivedPrecipitationIntensity, 15);
    } finally {
        globalThis.fetch = originalFetch;
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

function assertNoNaN(value, path = "days") {
    if (typeof value === "number") assert.ok(!Number.isNaN(value), `${path} is NaN`);
    else if (Array.isArray(value)) value.forEach((item, index) => assertNoNaN(item, `${path}[${index}]`));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) assertNoNaN(item, `${path}.${key}`);
}

test("Daily(12) stops at the 2 returned skycon days without NaN", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify(dailyResponse()));
    try {
        const colorfulClouds = new ColorfulClouds({ country: "CN", language: "zh-CN", latitude: "22.54", longitude: "114.06" }, "test-token");
        const result = await colorfulClouds.Daily(12);
        assert.equal(result.days.length, 2);
        assertNoNaN(result.days);
    } finally {
        globalThis.fetch = originalFetch;
    }
});
