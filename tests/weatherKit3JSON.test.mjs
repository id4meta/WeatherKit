import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

globalThis.$environment = { "surge-version": "test" };
globalThis.$persistentStore = { read: () => null, write: () => true };
globalThis.$argument = { LogLevel: "OFF", Storage: "Argument" };

const [{ Response }, { default: WeatherKit3 }, { default: WeatherKit2 }, { default: ColorfulClouds }, { default: QWeather }, { FlatBufferRootProcessor }] = await Promise.all([
    import("../src/process/Response.dev.mjs"),
    import("../src/class/WeatherKit3.mjs"),
    import("../src/class/WeatherKit2.mjs"),
    import("../src/class/ColorfulClouds.mjs"),
    import("../src/class/QWeather.mjs"),
    import("@nsnanocat/flatbuffer-root"),
]);

const time = 1800000000;
const metadata = { providerName: "Apple", latitude: 22.54, longitude: 114.06, readTime: time, temporarilyUnavailable: false };
const forecast = { forecastStart: time, forecastEnd: time + 3600, conditionCode: "RAIN", precipitationAmount: 6, precipitationType: "RAIN", temperature: 20, retainedField: "keep" };
// Synthetic reader-contract fixture derived from PR #107's documented macOS observations,
// not a capture or proof of native acceptance on this Mac.
function appleBody() {
    return structuredClone({
        currentWeather: { metadata, temperature: 20, conditionCode: "RAIN", humidity: 80, retainedField: "keep" },
        forecastDaily: { metadata, days: [{ ...forecast, daytimeForecast: forecast, overnightForecast: forecast }] },
        forecastHourly: { metadata, hours: [forecast] },
        forecastPeriodic: { metadata, series: [{ periods: [forecast] }] },
        weatherAlerts: { metadata, alerts: [{ id: "00010203-0405-0607-0809-0a0b0c0d0e0f", description: "Apple alert" }] },
        unknownRoot: { conditionCode: "DO_NOT_TOUCH", nested: { expected: 17 } },
    });
}
function request(dataSets = "currentWeather,forecastDaily,forecastHourly,forecastPeriodic,weatherAlerts") {
    return {
        method: "GET",
        headers: { "User-Agent": "WeatherKit_Weather_macOS_Version_27.3", accept: "application/vnd.apple.flatbuffer" },
        url: `https://weatherkit.apple.com/api/v3/weather/zh-Hans/22.54/114.06?country=CN&dataSets=${dataSets}`,
    };
}
function response(body = appleBody()) {
    return { status: 200, headers: { "Content-Type": "application/json; charset=utf-8", ETag: "old", "content-length": "100", Digest: "old", "X-Keep": "yes" }, body: JSON.stringify(body) };
}
beforeEach(() => {
    globalThis.$argument = {
        LogLevel: "OFF",
        Storage: "Argument",
        DataSets: ["currentWeather", "forecastDaily", "forecastHourly"],
        Weather: { Provider: "ColorfulClouds", Replace: ["CN"] },
    };
    globalThis.$httpClient = { get: () => assert.fail("unexpected real provider request") };
});

test("passive WK3 JSON reuses Caiyun once per product without entering the binary codec", async t => {
    t.mock.method(WeatherKit3, "decodeWithReport", () => assert.fail("JSON responses must not enter the FlatBuffer decoder"));
    t.mock.method(FlatBufferRootProcessor.prototype, "encode", () => assert.fail("JSON responses must not enter the FlatBuffer encoder"));
    const now = t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27, humidity: 65.4, conditionCode: "CLEAR" }));
    const daily = t.mock.method(ColorfulClouds.prototype, "Daily", async () => ({ metadata: { providerName: "彩云天气" }, days: [{ forecastStart: time, temperatureMax: 30, conditionCode: "CLEAR" }] }));
    const hourly = t.mock.method(ColorfulClouds.prototype, "ForecastHourly", async () => ({ metadata: { providerName: "彩云天气" }, hours: [{ forecastStart: time, temperature: 28, conditionCode: "CLEAR" }] }));
    const input = response();
    const output = await Response(request(), input);
    for (const provider of [now, daily, hourly]) assert.equal(provider.mock.callCount(), 1);
    const body = JSON.parse(output.body);
    assert.equal(body.currentWeather.temperature, 27);
    assert.equal(body.currentWeather.humidity, 65.4, "provider hygiene rounding is not applied");
    assert.equal(body.currentWeather.metadata.providerName, "彩云天气");
    assert.equal(body.currentWeather.retainedField, "keep");
    assert.equal(body.forecastDaily.days[0].temperatureMax, 30);
    assert.equal(body.forecastHourly.hours[0].temperature, 28);
    assert.equal(body.forecastDaily.days[0].precipitationAmount, 6);
    assert.equal(body.forecastDaily.days[0].daytimeForecast.precipitationAmount, 6);
    // 未注入的产品保持 Apple 原始表示 / Un-injected products keep Apple's original representation.
    assert.equal(body.forecastPeriodic.series[0].periods[0].conditionCode, "RAIN");
    assert.equal(body.weatherAlerts.alerts[0].id, "00010203-0405-0607-0809-0a0b0c0d0e0f");
    assert.deepEqual(body.unknownRoot, appleBody().unknownRoot);
    assert.equal(output.headers.ETag, undefined);
    assert.equal(output.headers.Digest, undefined);
    assert.equal(output.headers["content-length"], undefined);
    assert.equal(output.headers["Cache-Control"], "no-store");
    assert.equal(output.headers["X-Keep"], "yes");
});

test("QWeather uses existing injectors; only requested AND enabled weather products are replaced", async t => {
    globalThis.$argument.Weather.Provider = "QWeather";
    globalThis.$argument.DataSets = ["currentWeather", "forecastDaily"];
    const now = t.mock.method(QWeather.prototype, "WeatherNow", async () => ({ metadata: { providerName: "和风天气" }, temperature: 25 }));
    t.mock.method(QWeather.prototype, "Daily", async () => assert.fail("daily not requested"));
    t.mock.method(QWeather.prototype, "Hourly", async () => assert.fail("hourly disabled"));
    const output = JSON.parse((await Response(request("currentWeather,forecastHourly"), response())).body);
    assert.equal(output.currentWeather.temperature, 25);
    assert.equal(now.mock.callCount(), 1);
    assert.equal(output.forecastHourly.hours[0].temperature, 20);
    assert.equal(output.forecastDaily.metadata.providerName, "Apple");
});

test("provider failure rolls back one product without discarding healthy replacements", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27 }));
    t.mock.method(ColorfulClouds.prototype, "Daily", async () => {
        throw new Error("offline");
    });
    t.mock.method(ColorfulClouds.prototype, "ForecastHourly", async () => ({ metadata: { providerName: "彩云天气" }, hours: [{ forecastStart: time, temperature: 29 }] }));
    const output = JSON.parse((await Response(request(), response())).body);
    assert.equal(output.currentWeather.temperature, 27);
    assert.equal(output.forecastDaily.metadata.providerName, "Apple", "throwing provider preserves the original product");
    assert.equal(output.forecastHourly.hours[0].temperature, 29);
});

test("Surge binary-body-mode JSON bytes are decoded and stale bodyBytes removed", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27 }));
    const input = response();
    input.bodyBytes = new TextEncoder().encode(input.body);
    input.body = "stale";
    const output = await Response(request("currentWeather"), input);
    assert.equal(JSON.parse(output.body).currentWeather.temperature, 27);
    assert.equal(output.bodyBytes, undefined);
});

test("provider's unavailable result preserves usable Apple data and attribution", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气", temporarilyUnavailable: true } }));
    const output = JSON.parse((await Response(request("currentWeather"), response())).body);
    assert.equal(output.currentWeather.metadata.providerName, "Apple");
    assert.equal(output.currentWeather.metadata.temporarilyUnavailable, false);
    assert.equal(output.currentWeather.temperature, 20);
});

test("unselected products and unknown roots pass through byte-identical", async () => {
    globalThis.$argument.DataSets = ["forecastPeriodic"];
    const input = response();
    const output = await Response(request(), input);
    assert.equal(output.body, input.body);
    assert.equal(output.headers.ETag, "old");
});

test("EAQI's unsupported CO sub-index does not roll back the whole AQ product", async t => {
    globalThis.$argument.DataSets = "airQuality,currentWeather";
    globalThis.$argument.AirQuality = { Current: { Index: { Provider: "Calculate" } }, Calculate: { Algorithm: "EU_EAQI" }, Comparison: { ReplaceWhenCurrentChange: false } };
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => undefined);
    // Minimal synthetic copy of the native response shape that exposed the -1 sentinel regression.
    // 官方 pollutant 仅含 amount/units/pollutantType；单项 index/categoryIndex 是内部分析字段，原样透传，App 不读取。
    const apple = appleBody();
    apple.airQuality = {
        metadata: { ...metadata, providerName: "和风天气" },
        index: 40,
        categoryIndex: 1,
        scale: "HJ6332012.2604",
        previousDayComparison: "UNKNOWN",
        pollutants: [
            ["PM10", 40],
            ["NO2", 57],
            ["CO", 0.6],
            ["OZONE", 46],
            ["PM2_5", 26],
            ["SO2", 9],
        ].map(([pollutantType, amount]) => ({ pollutantType, amount, units: "MICROGRAMS_PER_CUBIC_METER" })),
    };
    const body = JSON.parse((await Response(request("airQuality,currentWeather"), response(apple))).body);
    assert.match(body.airQuality.scale, /^EU\.EAQI/);
    const co = body.airQuality.pollutants.find(pollutant => pollutant.pollutantType === "CO");
    assert.equal(co.amount, 600, "existing provider-unit correction still applies");
    assert.equal(co.index, -1, "internal sub-index sentinel passes through without special handling");
});

test("unserializable provider graphs preserve the original product", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27, extra: 1n }));
    const output = JSON.parse((await Response(request("currentWeather"), response())).body);
    assert.equal(output.currentWeather.temperature, 20, "BigInt fails serialization and the original product is preserved");
    assert.equal(output.currentWeather.conditionCode, "RAIN");
});

test("combined products serialize without an artificial size cap", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27 }));
    t.mock.method(ColorfulClouds.prototype, "ForecastHourly", async () => ({ metadata: { providerName: "彩云天气" }, hours: [{ forecastStart: time, temperature: 29 }] }));
    const body = JSON.parse((await Response(request(), response())).body);
    assert.equal(body.currentWeather.temperature, 27);
    assert.equal(body.forecastHourly.hours[0].temperature, 29);
});

test("malformed/error/oversized JSON responses are returned untouched without provider calls", async () => {
    const cases = [
        { ...response(), status: 503 },
        { ...response(), body: "{" },
        { ...response(), body: "[]" },
        { ...response(), body: " ".repeat(4 * 1024 * 1024 + 1) },
    ];
    for (const input of cases) assert.equal(await Response(request(), input), input);
});

test("non-CN v3 JSON request passes Apple through without provider calls", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => assert.fail("non-CN must not call the Caiyun provider"));
    t.mock.method(QWeather.prototype, "WeatherNow", async () => assert.fail("non-CN must not call the QWeather provider"));
    const input = response();
    const req = request("currentWeather");
    req.url = "https://weatherkit.apple.com/api/v3/weather/zh-Hans/25.03/121.56?country=TW&dataSets=currentWeather";
    const output = await Response(req, input);
    assert.equal(output, input, "non-CN JSON must return the Apple response object untouched");
    assert.equal(JSON.parse(output.body).currentWeather.temperature, 20);
});

test("non-CN v3 binary request skips decodeWithReport and passes bytes through untouched", async t => {
    t.mock.method(WeatherKit3, "decodeWithReport", () => assert.fail("non-CN must not enter the FlatBuffer decoder"));
    t.mock.method(WeatherKit3, "encode", () => assert.fail("non-CN must not enter the FlatBuffer encoder"));
    const inputBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const input = { status: 200, headers: { "Content-Type": "application/vnd.apple.flatbuffer" }, bodyBytes: inputBytes };
    const req = {
        method: "GET",
        headers: { "User-Agent": "WeatherKit_Weather_macOS_Version_27.3", accept: "application/vnd.apple.flatbuffer" },
        url: "https://weatherkit.apple.com/api/v3/weather/zh-Hans/25.03/121.56?country=TW&dataSets=currentWeather",
    };
    const output = await Response(req, input);
    assert.equal(output, input, "non-CN binary must return the Apple response object untouched");
    assert.deepEqual(output.body, inputBytes, "non-CN binary body must pass through byte-identical");
    assert.equal(output.bodyBytes, inputBytes);
});

test("non-CN v2 binary request skips decode and passes bytes through untouched", async t => {
    t.mock.method(WeatherKit2, "decode", () => assert.fail("non-CN must not enter the FlatBuffer decoder"));
    t.mock.method(WeatherKit2, "encode", () => assert.fail("non-CN must not enter the FlatBuffer encoder"));
    const inputBytes = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
    const input = { status: 200, headers: { "Content-Type": "application/vnd.apple.flatbuffer" }, bodyBytes: inputBytes };
    const req = {
        method: "GET",
        headers: { "User-Agent": "WeatherKit_Weather_macOS_Version_27.3", accept: "application/vnd.apple.flatbuffer" },
        url: "https://weatherkit.apple.com/api/v2/weather/zh-Hans/25.03/121.56?country=TW&dataSets=currentWeather",
    };
    const output = await Response(req, input);
    assert.equal(output, input, "non-CN binary must return the Apple response object untouched");
    assert.deepEqual(output.body, inputBytes, "non-CN binary body must pass through byte-identical");
    assert.equal(output.bodyBytes, inputBytes);
});

test("WARN-level CN request does not instantiate MatchEnum, QWeather or WAQI", async t => {
    globalThis.$argument.LogLevel = "WARN";
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27 }));
    const seen = [];
    const originalLog = console.log;
    console.log = (...args) => {
        seen.push(args.join(" "));
    };
    try {
        const output = await Response(request("currentWeather"), response());
        assert.equal(JSON.parse(output.body).currentWeather.temperature, 27);
    } finally {
        console.log = originalLog;
    }
    assert.ok(seen.some(line => line.includes("ColorfulClouds")), `ColorfulClouds must still construct eagerly, got ${JSON.stringify(seen)}`);
    assert.equal(seen.some(line => line.includes("MatchEnum")), false, `MatchEnum must not instantiate below DEBUG, got ${JSON.stringify(seen)}`);
    assert.equal(seen.some(line => line.includes("QWeather")), false, `QWeather must stay lazy for a pure-Caiyun request, got ${JSON.stringify(seen)}`);
    assert.equal(seen.some(line => line.includes("WAQI")), false, `WAQI must stay lazy for a pure-Caiyun request, got ${JSON.stringify(seen)}`);
});

test("empty weatherAlerts skips QWeather fetch and passes through; non-empty alerts still merge", async t => {
    globalThis.$argument.DataSets = ["weatherAlerts"];
    let allowFetch = false;
    const web = t.mock.method(QWeather.prototype, "WeatherAlertWeb", async () => {
        if (!allowFetch) assert.fail("empty alerts must not fetch the QWeather alert page");
        return {
            metadata: { providerName: "和风天气" },
            detailsUrl: "https://weatherkit.apple.com/alertDetails/index.html?ids=jianye-101190110&lang=zh-CN&party=qweather",
            alerts: [{ id: "merged-1", description: "merged" }],
        };
    });
    const seen = [];
    const originalLog = console.log;
    const originalFetch = globalThis.fetch;
    console.log = (...args) => {
        seen.push(args.join(" "));
    };
    globalThis.fetch = () => assert.fail("empty alerts must not make any network request");
    const detailsUrl = "https://www.qweather.com/severe-weather/jianye-101190110.html?from=AppleWeatherService";
    try {
        const empty = appleBody();
        empty.weatherAlerts = { metadata, detailsUrl, alerts: [] };
        const emptyOut = JSON.parse((await Response(request("weatherAlerts"), response(empty))).body);
        assert.deepEqual(emptyOut.weatherAlerts.alerts, []);
        assert.equal(emptyOut.weatherAlerts.detailsUrl, detailsUrl);
        assert.equal(emptyOut.weatherAlerts.metadata.providerName, "Apple");
        assert.equal(web.mock.callCount(), 0);
        assert.equal(seen.some(line => line.includes("QWeather")), false, `QWeather must stay lazy for empty alerts, got ${JSON.stringify(seen)}`);
        allowFetch = true;
        seen.length = 0;
        const one = appleBody();
        one.weatherAlerts = { metadata, detailsUrl, alerts: [{ id: "00010203-0405-0607-0809-0a0b0c0d0e0f", description: "Apple alert" }] };
        const oneOut = JSON.parse((await Response(request("weatherAlerts"), response(one))).body);
        assert.equal(web.mock.callCount(), 1);
        assert.equal(oneOut.weatherAlerts.alerts[0].id, "00010203-0405-0607-0809-0a0b0c0d0e0f");
    } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
    }
});

test("Response reuses $request._wkContext instead of re-parsing the request URL", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27 }));
    const { Request } = await import("../src/process/Request.mjs");
    const { $request } = await Request(request("currentWeather"));
    assert.ok($request._wkContext, "Request must mount _wkContext on the request");
    assert.equal($request._wkContext.country, "CN");
    $request.url = $request.url.replace("country=CN", "country=TW");
    const output = JSON.parse((await Response($request, response())).body);
    assert.equal(output.currentWeather.temperature, 27, "injection must still run from the mounted CN context after the URL was rewritten to TW");
});

test("direct Response() without _wkContext still injects CN weather", async t => {
    t.mock.method(ColorfulClouds.prototype, "CurrentWeather", async () => ({ metadata: { providerName: "彩云天气" }, temperature: 27 }));
    const req = request("currentWeather");
    assert.equal(req._wkContext, undefined, "plain request carries no _wkContext");
    const output = JSON.parse((await Response(req, response())).body);
    assert.equal(output.currentWeather.temperature, 27);
});
