import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { WK3 } from "@nsringo/weatherkit";
import { ByteBuffer, Builder } from "flatbuffers";

globalThis.$environment = { "surge-version": "test" };
globalThis.$persistentStore = { read: () => null, write: () => true };
globalThis.$argument = { LogLevel: "OFF", Storage: "Argument" };
const [{ Response }] = await Promise.all([import("../src/process/Response.dev.mjs")]);

// 合成的 WK3 根响应，所有取值均为虚构；news 槽位带第三方 providerLogo 标记，
// 用于验证非 CN 请求的 sweepDataSets 不应将其改写（第 42 轮）。
// 本地 stub 的 WK3 Codec 不可用时整份固件跳过构建，测试以 skip 计入。
function buildWeather() {
    const builder = new Builder(4096);
    const airQuality = WK3.Codec.encode("AirQuality", builder, { metadata: { providerName: "synthetic" }, pollutants: [] });
    const forecastDaily = WK3.Codec.encode("DailyForecastData", builder, { days: [{ forecastStart: 1763200000, temperatureMax: 30 }] });
    const forecastHourly = WK3.Codec.encode("HourlyForecastData", builder, { hours: [{ forecastStart: 1763200000, temperature: 21 }] });
    const forecastPeriodic = WK3.Codec.encode("PeriodicForecasts", builder, { forecasts: [] });
    const historicalComparisons = WK3.Codec.encode("HistoricalComparisons", builder, { comparisons: [] });
    const weatherChanges = WK3.Codec.encode("WeatherChanges", builder, { changes: [] });
    const weatherAlerts = WK3.Codec.encode("WeatherAlertCollectionData", builder, { alerts: [] });
    const news = WK3.Codec.encode("News", builder, { placements: [], metadata: { providerName: "ThirdParty", providerLogo: "https://example.com/logo.png" } });
    const currentWeather = WK3.Codec.encode("CurrentWeatherData", builder, { temperature: 20.5, conditionCode: ["CLOUDY"] });
    WK3.Weather.startWeather(builder);
    WK3.Weather.addAirQuality(builder, airQuality);
    WK3.Weather.addCurrentWeather(builder, currentWeather);
    WK3.Weather.addForecastDaily(builder, forecastDaily);
    WK3.Weather.addForecastHourly(builder, forecastHourly);
    WK3.Weather.addForecastPeriodic(builder, forecastPeriodic);
    WK3.Weather.addHistoricalComparisons(builder, historicalComparisons);
    WK3.Weather.addWeatherChanges(builder, weatherChanges);
    WK3.Weather.addWeatherAlerts(builder, weatherAlerts);
    WK3.Weather.addNews(builder, news);
    builder.finish(WK3.Weather.endWeather(builder));
    return builder.asUint8Array().slice();
}

let source = null;
let codecAvailable = true;
try {
    source = buildWeather();
} catch {
    codecAvailable = false;
}

const request = () => ({ method: "GET", url: "https://weatherkit.apple.com/api/v3/weather/en-US/37.7749/-122.4194?country=US&dataSets=currentWeather,forecastDaily,forecastHourly,forecastPeriodic,historicalComparisons,weatherChanges,news,weatherAlerts", headers: { Accept: "application/vnd.apple.flatbuffer;messageType=WK3.Weather", "User-Agent": "WeatherWidget" } });
const response = (body = source) => Response(request(), { status: 200, headers: { "Content-Type": "application/vnd.apple.flatbuffer;messageType=WK3.Weather" }, bodyBytes: body });
beforeEach(() => {
    globalThis.$request = request();
    globalThis.$argument = { LogLevel: "OFF", Storage: "Argument", DataSets: "currentWeather,forecastDaily,forecastHourly", Weather: { Replace: "CN", Provider: "ColorfulClouds" } };
});

test("non-CN v3 requests leave unmodified sweep slots byte-identical", { skip: codecAvailable ? false : "WK3 codec unavailable in stubbed local environment" }, async () => {
    const output = (await response()).body;
    assert.ok(output instanceof Uint8Array);
    assert.deepEqual(output, source);
    // 若 News 元数据字段在真实编解码下可往返，则第三方标记必须原样保留（未被清理改写）。
    const body = WK3.Codec.decode("Weather", WK3.Weather.getRootAsWeather(new ByteBuffer(output)));
    if (body.news?.metadata) assert.equal(body.news.metadata.providerLogo, "https://example.com/logo.png");
});
