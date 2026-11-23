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
