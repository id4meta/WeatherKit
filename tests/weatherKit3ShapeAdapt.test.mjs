import assert from "node:assert/strict";
import test from "node:test";

globalThis.$environment = { "surge-version": "test" };
globalThis.$persistentStore = { read: () => null, write: () => true };
globalThis.$argument = { LogLevel: "OFF", Storage: "Argument" };
const { adaptWK3ConditionCode, adaptWK3PrecipitationAmount, syncCurrentConditionWithNextHour, resolveCountryForResponse } = await import("../src/process/Response.dev.mjs");

// WK3 二进制分支形状适配：注入的标量 conditionCode 必须包回单元素数组，
// 否则 WeatherKit3.encode.compile 报 Invalid WK3 vector（真机诊断 WK3_DIAG 已定位）。
// precipitationAmount 在 WK3 二进制协议下是对象 { expected, minimum, maximum }，
// 注入的标量数字须按该键回填（键结构见 tests/weatherKit3WeatherReplacement.test.mjs:65,81）。

test("adaptWK3ConditionCode wraps scalar conditionCode into a single-element array", () => {
    const patch = {
        currentWeather: { temperature: 20, conditionCode: "CLOUDY" },
        forecastDaily: {
            days: [
                { forecastStart: 1, conditionCode: "RAIN", daytimeForecast: { conditionCode: "RAIN" }, overnightForecast: { conditionCode: "CLEAR" }, restOfDayForecast: { conditionCode: "CLOUDY" } },
                { forecastStart: 2, conditionCode: "SNOW", daytimeForecast: {} },
            ],
        },
        forecastHourly: {
            hours: [
                { forecastStart: 1, conditionCode: "DRIZZLE" },
                { forecastStart: 2, conditionCode: "CLEAR" },
            ],
        },
    };
    adaptWK3ConditionCode(patch);
    assert.deepEqual(patch.currentWeather.conditionCode, ["CLOUDY"]);
    assert.deepEqual(patch.forecastDaily.days[0].conditionCode, ["RAIN"]);
    assert.deepEqual(patch.forecastDaily.days[0].daytimeForecast.conditionCode, ["RAIN"]);
    assert.deepEqual(patch.forecastDaily.days[0].overnightForecast.conditionCode, ["CLEAR"]);
    assert.deepEqual(patch.forecastDaily.days[0].restOfDayForecast.conditionCode, ["CLOUDY"]);
    assert.deepEqual(patch.forecastDaily.days[1].conditionCode, ["SNOW"]);
    assert.equal(patch.forecastDaily.days[1].daytimeForecast.conditionCode, undefined);
    assert.deepEqual(patch.forecastHourly.hours[0].conditionCode, ["DRIZZLE"]);
    assert.deepEqual(patch.forecastHourly.hours[1].conditionCode, ["CLEAR"]);
});

test("adaptWK3ConditionCode is idempotent for arrays and tolerates missing products", () => {
    const patch = {
        currentWeather: { conditionCode: ["RAIN"] },
        forecastDaily: { days: [{ conditionCode: ["SNOW"], daytimeForecast: { conditionCode: ["SNOW"] }, overnightForecast: { conditionCode: ["CLEAR"] }, restOfDayForecast: { conditionCode: ["CLOUDY"] } }] },
        forecastHourly: { hours: [{ conditionCode: ["DRIZZLE"] }] },
    };
    adaptWK3ConditionCode(patch);
    adaptWK3ConditionCode(patch);
    assert.deepEqual(patch.currentWeather.conditionCode, ["RAIN"]);
    assert.deepEqual(patch.forecastDaily.days[0].conditionCode, ["SNOW"]);
    assert.deepEqual(patch.forecastDaily.days[0].daytimeForecast.conditionCode, ["SNOW"]);
    assert.deepEqual(patch.forecastDaily.days[0].overnightForecast.conditionCode, ["CLEAR"]);
    assert.deepEqual(patch.forecastDaily.days[0].restOfDayForecast.conditionCode, ["CLOUDY"]);
    assert.deepEqual(patch.forecastHourly.hours[0].conditionCode, ["DRIZZLE"]);
    assert.doesNotThrow(() => adaptWK3ConditionCode({}));
    assert.doesNotThrow(() => adaptWK3ConditionCode(undefined));
    assert.doesNotThrow(() => adaptWK3ConditionCode({ forecastDaily: {}, forecastHourly: {} }));
});

test("syncCurrentConditionWithNextHour keeps array shape when input is an array", () => {
    const raining = { minutes: [{ precipitationIntensity: 0.5 }], summary: [{ clear: false, condition: ["RAIN"], maxCondition: "RAIN" }] };
    const currentWeather = { conditionCode: ["CLOUDY"] };
    assert.equal(syncCurrentConditionWithNextHour(currentWeather, raining), true);
    assert.deepEqual(currentWeather.conditionCode, ["RAIN"]);

    const lightRain = { minutes: [{ precipitationIntensity: 0.05 }], summary: [{ clear: false, condition: ["DRIZZLE"], maxCondition: "DRIZZLE" }] };
    const drizzly = { conditionCode: ["CLOUDY"] };
    assert.equal(syncCurrentConditionWithNextHour(drizzly, lightRain), true);
    assert.deepEqual(drizzly.conditionCode, ["DRIZZLE"]);
});

test("syncCurrentConditionWithNextHour keeps scalar shape when input is a scalar", () => {
    const raining = { minutes: [{ precipitationIntensity: 0.5 }], summary: [{ clear: false, condition: ["RAIN"], maxCondition: "RAIN" }] };
    const currentWeather = { conditionCode: "CLOUDY" };
    assert.equal(syncCurrentConditionWithNextHour(currentWeather, raining), true);
    assert.equal(currentWeather.conditionCode, "RAIN");
});

test("syncCurrentConditionWithNextHour leaves non-rainy or already-rainy conditions untouched", () => {
    const dry = { minutes: [{ precipitationIntensity: 0 }], summary: [{ clear: true, condition: ["CLEAR"], maxCondition: "CLEAR" }] };
    const cloudy = { conditionCode: ["CLOUDY"] };
    assert.equal(syncCurrentConditionWithNextHour(cloudy, dry), false);
    assert.deepEqual(cloudy.conditionCode, ["CLOUDY"]);

    const raining = { minutes: [{ precipitationIntensity: 0.5 }], summary: [{ clear: false, condition: ["RAIN"], maxCondition: "RAIN" }] };
    const alreadyRaining = { conditionCode: ["RAIN"] };
    assert.equal(syncCurrentConditionWithNextHour(alreadyRaining, raining), false);
    assert.deepEqual(alreadyRaining.conditionCode, ["RAIN"]);

    const scalarRaining = { conditionCode: "RAIN" };
    assert.equal(syncCurrentConditionWithNextHour(scalarRaining, raining), false);
    assert.equal(scalarRaining.conditionCode, "RAIN");

    assert.equal(syncCurrentConditionWithNextHour(undefined, raining), false);
    assert.equal(syncCurrentConditionWithNextHour({ conditionCode: ["CLOUDY"] }, undefined), false);
});

test("adaptWK3PrecipitationAmount backfills a scalar number into the WK3 object shape", () => {
    const patch = {
        forecastHourly: {
            hours: [
                { forecastStart: 1, precipitationAmount: 2.5 },
                { forecastStart: 2, precipitationAmount: 0 },
                { forecastStart: 3, precipitationAmount: { expected: 1, minimum: 0.5, maximum: 2 } },
                { forecastStart: 4 },
            ],
        },
    };
    adaptWK3PrecipitationAmount(patch);
    assert.deepEqual(patch.forecastHourly.hours[0].precipitationAmount, { expected: 2.5, minimum: 2.5, maximum: 2.5 });
    assert.deepEqual(patch.forecastHourly.hours[1].precipitationAmount, { expected: 0, minimum: 0, maximum: 0 });
    assert.deepEqual(patch.forecastHourly.hours[2].precipitationAmount, { expected: 1, minimum: 0.5, maximum: 2 });
    assert.equal(patch.forecastHourly.hours[3].precipitationAmount, undefined);
    assert.doesNotThrow(() => adaptWK3PrecipitationAmount({}));
    assert.doesNotThrow(() => adaptWK3PrecipitationAmount(undefined));
    assert.doesNotThrow(() => adaptWK3PrecipitationAmount({ forecastHourly: {} }));
});

test("syncCurrentConditionWithNextHour syncs intensities upward when already DRIZZLE but weaker than the first minute", () => {
    const currentWeather = { conditionCode: "DRIZZLE", precipitationIntensity: 0.0069, perceivedPrecipitationIntensity: 0 };
    const forecastNextHour = { minutes: [{ condition: "DRIZZLE", precipitationIntensity: 0.25, perceivedPrecipitationIntensity: 0.606 }] };
    assert.equal(syncCurrentConditionWithNextHour(currentWeather, forecastNextHour), true);
    assert.equal(currentWeather.conditionCode, "DRIZZLE");
    assert.equal(currentWeather.precipitationIntensity, 0.25);
    assert.equal(currentWeather.perceivedPrecipitationIntensity, 0.606);
});

test("syncCurrentConditionWithNextHour does nothing when perceivedPrecipitationIntensity is below 0.1", () => {
    const currentWeather = { conditionCode: ["CLOUDY"], precipitationIntensity: 0, perceivedPrecipitationIntensity: 0 };
    const forecastNextHour = { minutes: [{ condition: "POSSIBLE_DRIZZLE", precipitationIntensity: 0.02, perceivedPrecipitationIntensity: 0.05 }] };
    assert.equal(syncCurrentConditionWithNextHour(currentWeather, forecastNextHour), false);
    assert.deepEqual(currentWeather.conditionCode, ["CLOUDY"]);
    assert.equal(currentWeather.precipitationIntensity, 0);
    assert.equal(currentWeather.perceivedPrecipitationIntensity, 0);
});

test("resolveCountryForResponse infers CN/HK from domestic coordinates when country query param is omitted", () => {
    const yangzhou = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-US/32.390/119.499?timezone=Asia/Shanghai&dataSets=currentWeather");
    assert.equal(resolveCountryForResponse(yangzhou, { country: "US", latitude: "32.390", longitude: "119.499" }), "CN");

    const shenzhen = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-US/22.5431/114.0579?dataSets=currentWeather");
    assert.equal(resolveCountryForResponse(shenzhen, { country: "US", latitude: "22.5431", longitude: "114.0579" }), "CN");

    const sf = new URL("https://weatherkit.apple.com/api/v3/weather/en-US/37.774/-122.419?timezone=America/Los_Angeles");
    assert.equal(resolveCountryForResponse(sf, { country: "US", latitude: "37.774", longitude: "-122.419" }), "US");

    const explicit = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-US/32.390/119.499?country=US");
    assert.equal(resolveCountryForResponse(explicit, { country: "US", latitude: "32.390", longitude: "119.499" }), "US");

    const southPacific = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/-1.284/157.931");
    assert.equal(resolveCountryForResponse(southPacific, { country: "CN", latitude: "-1.284", longitude: "157.931" }), undefined);

    const stLawrence = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/48.0/-62.0");
    assert.equal(resolveCountryForResponse(stLawrence, { country: "CN", latitude: "48.0", longitude: "-62.0" }), undefined);

    const taipei = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/25.033/121.565?country=CN");
    assert.equal(resolveCountryForResponse(taipei, { country: "CN", latitude: "25.033", longitude: "121.565" }), "TW");

    const centralTaiwan = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/23.188/120.924?country=CN");
    assert.equal(resolveCountryForResponse(centralTaiwan, { country: "CN", latitude: "23.188", longitude: "120.924" }), "TW");

    const hongKong = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/22.319/114.169?country=CN");
    assert.equal(resolveCountryForResponse(hongKong, { country: "CN", latitude: "22.319", longitude: "114.169" }), "HK");

    const macau = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/22.198/113.543?country=CN");
    assert.equal(resolveCountryForResponse(macau, { country: "CN", latitude: "22.198", longitude: "113.543" }), "MO");

    const shenzhenCN = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/22.543/114.058?country=CN");
    assert.equal(resolveCountryForResponse(shenzhenCN, { country: "CN", latitude: "22.543", longitude: "114.058" }), "CN");

    const xiamenCN = new URL("https://weatherkit.apple.com/api/v3/weather/zh-Hans-CN/24.479/118.089?country=CN");
    assert.equal(resolveCountryForResponse(xiamenCN, { country: "CN", latitude: "24.479", longitude: "118.089" }), "CN");
});
