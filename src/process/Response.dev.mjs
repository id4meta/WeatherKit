import { Console, Storage } from "@nsnanocat/util";
import * as flatbuffers from "flatbuffers";
import AirQuality from "../class/AirQuality.mjs";
import ColorfulClouds from "../class/ColorfulClouds.mjs";
import ForecastNextHour from "../class/ForecastNextHour.mjs";
import MatchEnum from "../class/MatchEnum.mjs";
import QWeather from "../class/QWeather.mjs";
import WAQI from "../class/WAQI.mjs";
import Weather from "../class/Weather.mjs";
import WeatherAlerts from "../class/WeatherAlerts.mjs";
import WeatherKit2 from "../class/WeatherKit2.mjs";
import WeatherKit3 from "../class/WeatherKit3.mjs";
import database from "../function/database.mjs";
import mergeWeatherKitAvailability from "../function/mergeWeatherKitAvailability.mjs";
import parseWeatherKitURL from "../function/parseWeatherKitURL.mjs";
import providerNameToLogo from "../function/providerNameToLogo.mjs";
import setENV from "../function/setENV.mjs";
/***************** Processing *****************/
export async function Response($request, $response) {
    // 解构URL
    const url = new URL($request.url);
    Console.info(`url: ${url.toJSON()}`);
    // 获取连接参数
    const PATHs = url.pathname.split("/").filter(Boolean);
    Console.info(`PATHs: ${PATHs}`);
    // 解析格式
    const FORMAT = ($response.headers?.["Content-Type"] ?? $response.headers?.["content-type"])?.split(";")?.[0];
    Console.info(`FORMAT: ${FORMAT}`);
    /**
     * 设置
     * @type {{Settings: import('./types').Settings}}
     */
    const { Settings, Caches, Configs } = setENV("iRingo", "WeatherKit", database);
    Console.logLevel = Settings.LogLevel;
    // 创建空数据
    let body = {};
    // 格式判断
    switch (FORMAT) {
        case undefined: // 视为无body
            break;
        case "application/x-www-form-urlencoded":
        case "text/plain":
        default:
            //Console.debug(`body: ${body}`);
            break;
        case "application/x-mpegURL":
        case "application/x-mpegurl":
        case "application/vnd.apple.mpegurl":
        case "audio/mpegurl":
            //body = M3U8.parse($response.body);
            //Console.debug(`body: ${JSON.stringify(body)}`);
            //$response.body = M3U8.stringify(body);
            break;
        case "text/xml":
        case "text/html":
        case "text/plist":
        case "application/xml":
        case "application/plist":
        case "application/x-plist":
            //body = XML.parse($response.body);
            //Console.debug(`body: ${JSON.stringify(body)}`);
            //$response.body = XML.stringify(body);
            break;
        case "text/vtt":
        case "application/vtt":
            //body = VTT.parse($response.body);
            //Console.debug(`body: ${JSON.stringify(body)}`);
            //$response.body = VTT.stringify(body);
            break;
        case "text/json":
        case "application/json": {
            // v3 天气的 JSON 可能因 binary-body-mode 以 bodyBytes 到达；仅 200 且可解析时处理，否则原样透传。
            // v3 weather JSON may arrive as bodyBytes under binary-body-mode; process only 200 and parseable bodies, else pass through.
            const isWeatherKit3JSON = url.hostname === "weatherkit.apple.com" && url.pathname.startsWith("/api/v3/weather/");
            let rawText;
            let skipDefaultWrite = false;
            if (isWeatherKit3JSON) {
                if ($response.status !== 200) break;
                // JSON 最多 4 MiB；超限、非对象或解析失败均原样透传 / JSON is capped at 4 MiB; oversize, non-object or parse failures pass through untouched.
                rawText = $response.bodyBytes ? new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array($response.bodyBytes)) : $response.body;
                if ((typeof rawText === "string" ? rawText.length : 0) > 4 * 1024 * 1024) break;
                try {
                    body = JSON.parse(rawText);
                } catch {
                    break;
                }
                if (!body || typeof body !== "object" || Array.isArray(body)) break;
            } else body = JSON.parse($response.body);
            switch (url.hostname) {
                case "weatherkit.apple.com":
                    // 路径判断
                    switch (url.pathname) {
                        default:
                            if (url.pathname.startsWith("/api/v3/weather/")) {
                                Console.info("🟪 WeatherKit.api.v3.weather (JSON)");
                                const parameters = parseWeatherKitURL(url);
                                parameters.country = resolveCountryForResponse(url, parameters);
                                const dataSets = parameters.dataSets.filter(dataSet => Settings.DataSets.includes(dataSet) && ["airQuality", "currentWeather", "forecastDaily", "forecastHourly", "forecastNextHour", "weatherAlerts"].includes(dataSet));
                                let changed = false;
                                if (dataSets.length > 0) {
                                    // REST JSON 表示沿用标量形状，供应商按标量产出 / REST JSON uses scalar shapes, so providers produce scalars.
                                    const providerParameters = { ...parameters, version: "v2", weatherKitLanguage: body.weatherAlerts?.metadata?.language };
                                    const enviroments = {
                                        colorfulClouds: $request?._prefetchedColorfulClouds ?? new ColorfulClouds(providerParameters, Settings?.API?.ColorfulClouds?.Token || "Y2FpeXVuX25vdGlmeQ=="),
                                        qWeather: new QWeather(providerParameters, Settings?.API?.QWeather?.Token || "bdd98ec1d87747f3a2e8b1741a5af796", Settings?.API?.QWeather?.Host),
                                        waqi: new WAQI(parameters, Settings?.API?.WAQI?.Token),
                                        country: parameters.country,
                                    };
                                    const replaceWeather = async (name, inject) => {
                                        const original = body[name];
                                        try {
                                            const result = await inject(original === undefined ? undefined : JSON.parse(JSON.stringify(original)));
                                            if (result?.metadata && result.metadata.temporarilyUnavailable !== true) {
                                                body[name] = result;
                                                changed = true;
                                            }
                                        } catch (error) {
                                            Console.warn("WeatherKit.api.v3.weather", `preserved ${name}: ${error?.name ?? "Error"}`);
                                        }
                                    };
                                    await Promise.all(
                                        dataSets.map(async dataSet => {
                                            switch (dataSet) {
                                                case "airQuality":
                                                    // 物理缺失时按既有补齐语义注入 / Backfill when physically missing, as in the binary path.
                                                    await replaceWeather("airQuality", product => InjectAirQuality(product, Settings, Caches, enviroments));
                                                    break;
                                                case "currentWeather":
                                                    await replaceWeather("currentWeather", product => InjectCurrentWeather(product, Settings, enviroments));
                                                    break;
                                                case "forecastDaily":
                                                    await replaceWeather("forecastDaily", product => InjectForecastDaily(product, Settings, enviroments));
                                                    break;
                                                case "forecastHourly":
                                                    await replaceWeather("forecastHourly", product => InjectForecastHourly(product, Settings, enviroments));
                                                    break;
                                                case "forecastNextHour":
                                                    await replaceWeather("forecastNextHour", product => InjectForecastNextHour(product, Settings, enviroments));
                                                    break;
                                                case "weatherAlerts":
                                                    await replaceWeather("weatherAlerts", product => InjectWeatherAlerts(product, Settings, enviroments));
                                                    break;
                                                default:
                                                    break;
                                            }
                                        }),
                                    );
                                    // 分钟雷达确认正在下雨、实况却报无雨云况时，同步实况状况
                                    if (syncCurrentConditionWithNextHour(body.currentWeather, body.forecastNextHour)) changed = true;
                                    // 最终输出前兜底清理各数据集元数据：删第三方图标链接，第三方归属链接改苹果官方地址
                                    if (sanitizeResponseMetadata(body)) changed = true;
                                }
                                skipDefaultWrite = true;
                                let text;
                                try {
                                    text = JSON.stringify(body);
                                } catch {
                                    // 不可序列化的结果保留原包（控制流，不是数值防御）/ Unserializable results keep the original package (control flow, not value defense).
                                    break;
                                }
                                // 仅在实际改写时重写并清理缓存验证头 / Rewrite and revalidate headers only when actually changed.
                                if (changed) {
                                    // 改写后移除旧正文长度、编码与缓存验证头；bodyBytes 旧载荷一并移除。
                                    // After rewriting, drop stale length/encoding/cache-validation headers and any old bodyBytes payload.
                                    for (const key of Object.keys($response.headers ?? {})) if (["content-length", "content-encoding", "etag", "last-modified", "content-md5", "digest", "cache-control"].includes(key.toLowerCase())) delete $response.headers[key];
                                    $response.headers["Cache-Control"] = "no-store";
                                    $response.bodyBytes = undefined;
                                    $response.body = text;
                                }
                            } else if (url.pathname.startsWith("/api/v1/availability/")) {
                                if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`body: ${JSON.stringify(body)}`);
                                body = mergeWeatherKitAvailability(body, Configs?.Availability?.v2);
                            }
                            break;
                    }
                    break;
            }
            if (!skipDefaultWrite) $response.body = JSON.stringify(body);
            break;
        }
        case "application/vnd.apple.flatbuffer":
        case "application/protobuf":
        case "application/x-protobuf":
        case "application/vnd.google.protobuf":
        case "application/grpc":
        case "application/grpc+proto":
        case "application/octet-stream": {
            //Console.debug(`$response: ${JSON.stringify($response, null, 2)}`);
            let rawBody = $response.bodyBytes ? new Uint8Array($response.bodyBytes) : ($response.body ?? new Uint8Array());
            //Console.debug(`isBuffer? ${ArrayBuffer.isView(rawBody)}: ${JSON.stringify(rawBody)}`);
            switch (FORMAT) {
                case "application/vnd.apple.flatbuffer": {
                    // 解析FlatBuffer
                    const ByteBuffer = new flatbuffers.ByteBuffer(rawBody);
                    // 主机判断
                    switch (url.hostname) {
                        case "weatherkit.apple.com":
                            // 路径判断
                            switch (true) {
                                case url.pathname.startsWith("/api/v2/weather/"): {
                                    Console.info("🟦 WeatherKit.api.v2.weather");
                                    const parameters = parseWeatherKitURL(url);
                                    parameters.country = resolveCountryForResponse(url, parameters);
                                    const dataSets = parameters.dataSets.filter(dataSet => Settings.DataSets.includes(dataSet));
                                    const rootNames = dataSets.map(dataSet => Configs.DataSets[dataSet] ?? dataSet);
                                    body = WeatherKit2.decode(ByteBuffer, rootNames);
                                    const providerParameters = { ...parameters, weatherKitLanguage: body.weatherAlerts?.metadata?.language };
                                    const matchEnum = new MatchEnum(body, parameters.version, $request);
                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                        await matchEnum.init();
                                    }
                                    const enviroments = {
                                        colorfulClouds: $request?._prefetchedColorfulClouds ?? new ColorfulClouds(providerParameters, Settings?.API?.ColorfulClouds?.Token || "Y2FpeXVuX25vdGlmeQ=="),
                                        qWeather: new QWeather(providerParameters, Settings?.API?.QWeather?.Token || "bdd98ec1d87747f3a2e8b1741a5af796", Settings?.API?.QWeather?.Host),
                                        waqi: new WAQI(parameters, Settings?.API?.WAQI?.Token),
                                        country: parameters.country,
                                    };

                                    await Promise.all(
                                        dataSets.map(async dataSet => {
                                            switch (dataSet) {
                                                case "airQuality": {
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.airQuality();
                                                    }
                                                    body.airQuality = await InjectAirQuality(body.airQuality, Settings, Caches, enviroments);
                                                    break;
                                                }
                                                case "currentWeather": {
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.weatherCondition();
                                                        matchEnum.pressureTrend();
                                                    }
                                                    body.currentWeather = await InjectCurrentWeather(body.currentWeather, Settings, enviroments);
                                                    break;
                                                }
                                                case "forecastDaily": {
                                                    body.forecastDaily = await InjectForecastDaily(body.forecastDaily, Settings, enviroments);
                                                    break;
                                                }
                                                case "forecastHourly": {
                                                    body.forecastHourly = await InjectForecastHourly(body.forecastHourly, Settings, enviroments);
                                                    break;
                                                }
                                                case "forecastNextHour": {
                                                    if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`body.forecastNextHour: ${JSON.stringify(body?.forecastNextHour, null, 2)}`);
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.conditionType();
                                                        matchEnum.forecastToken();
                                                    }
                                                    body.forecastNextHour = await InjectForecastNextHour(body.forecastNextHour, Settings, enviroments);
                                                    break;
                                                }
                                                case "news": {
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.placementType();
                                                    }
                                                    if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`body.news: ${JSON.stringify(body?.news, null, 2)}`);
                                                    break;
                                                }
                                                case "weatherAlerts": {
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.severity();
                                                        matchEnum.significanceType();
                                                        matchEnum.urgency();
                                                        matchEnum.certainty();
                                                        matchEnum.importanceType();
                                                        matchEnum.responseType();
                                                    }
                                                    body.weatherAlerts = await InjectWeatherAlerts(body.weatherAlerts, Settings, enviroments);
                                                    if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`body.weatherAlerts: ${JSON.stringify(body?.weatherAlerts, null, 2)}`);
                                                    break;
                                                }
                                                case "locationInfo": {
                                                    if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`body.locationInfo: ${JSON.stringify(body?.locationInfo, null, 2)}`);
                                                    break;
                                                }
                                                default:
                                                    break;
                                            }
                                        }),
                                    );
                                    syncCurrentConditionWithNextHour(body.currentWeather, body.forecastNextHour);
                                    sanitizeResponseMetadata(body);
                                    rawBody = WeatherKit2.encode(ByteBuffer, body);
                                    break;
                                }
                                case url.pathname.startsWith("/api/v3/weather/"): {
                                    Console.info("🟪 WeatherKit.api.v3.weather");
                                    const parameters = parseWeatherKitURL(url);
                                    parameters.country = resolveCountryForResponse(url, parameters);
                                    // 解码选中的可注入产品（注入用）与仅做归属清理的非注入产品（兜底清理用）；
                                    // 其余根产品保持原始 arena；解码失败的产品保留原始 arena，不参与注入与重写。
                                    const dataSets = parameters.dataSets.filter(dataSet => Settings.DataSets.includes(dataSet) && ["airQuality", "currentWeather", "forecastDaily", "forecastHourly", "forecastNextHour", "weatherAlerts"].includes(dataSet));
                                    const sweepDataSets = parameters.dataSets.filter(dataSet => ["dataNotice", "forecastPeriodic", "historicalComparisons", "weatherChanges", "news"].includes(dataSet));
                                    if (dataSets.length === 0 && sweepDataSets.length === 0) break;
                                    const rootNames = [...dataSets, ...sweepDataSets].map(dataSet => Configs.DataSets[dataSet] ?? dataSet);
                                    const { json, failures } = WeatherKit3.decodeWithReport(ByteBuffer, rootNames);
                                    body = json;
                                    // 读取或解码失败的产品保留原始 arena，不参与注入与重写。
                                    // Products that fail to read or decode keep their original arenas and are neither injected nor rewritten.
                                    const failed = new Set(failures.map(failure => failure.name));
                                    const providerParameters = { ...parameters, weatherKitLanguage: body.weatherAlerts?.metadata?.language };
                                    const matchEnum = new MatchEnum(body, parameters.version, $request);
                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                        await matchEnum.init();
                                    }
                                    const enviroments = {
                                        colorfulClouds: $request?._prefetchedColorfulClouds ?? new ColorfulClouds(providerParameters, Settings?.API?.ColorfulClouds?.Token || "Y2FpeXVuX25vdGlmeQ=="),
                                        qWeather: new QWeather(providerParameters, Settings?.API?.QWeather?.Token || "bdd98ec1d87747f3a2e8b1741a5af796", Settings?.API?.QWeather?.Host),
                                        waqi: new WAQI(parameters, Settings?.API?.WAQI?.Token),
                                        country: parameters.country,
                                    };
                                    const patch = {};
                                    const replaceWeather = async (name, inject) => {
                                        const original = body[name];
                                        try {
                                            const copy = name === "weatherAlerts" ? (original ? structuredClone(original) : undefined) : original;
                                            const result = await inject(copy, Settings, enviroments);
                                            if (result?.metadata && result.metadata.temporarilyUnavailable !== true) {
                                                const metadataChanged =
                                                    !original ||
                                                    result.metadata.providerName !== original.metadata?.providerName ||
                                                    result.metadata.readTime !== original.metadata?.readTime ||
                                                    result.metadata.expireTime !== original.metadata?.expireTime ||
                                                    result.detailsUrl !== original.detailsUrl;
                                                if (metadataChanged || JSON.stringify(result) !== JSON.stringify(original)) patch[name] = result;
                                            }
                                        } catch (error) {
                                            Console.warn("WeatherKit.api.v3.weather", `preserved ${name}: ${error?.name ?? "Error"}`);
                                        }
                                    };

                                    await Promise.all(
                                        dataSets.map(async dataSet => {
                                            if (failed.has(dataSet)) {
                                                Console.warn(`WeatherKit.api.v3.weather`, `skip failed dataSet: ${dataSet}`);
                                                return;
                                            }
                                            switch (dataSet) {
                                                case "currentWeather": {
                                                    await replaceWeather("currentWeather", InjectCurrentWeather);
                                                    break;
                                                }
                                                case "forecastDaily": {
                                                    await replaceWeather("forecastDaily", InjectForecastDaily);
                                                    break;
                                                }
                                                case "forecastHourly": {
                                                    await replaceWeather("forecastHourly", InjectForecastHourly);
                                                    break;
                                                }
                                                case "airQuality": {
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.airQuality();
                                                    }
                                                    const airQualityResult = await InjectAirQuality(body.airQuality, Settings, Caches, enviroments);
                                                    if (airQualityResult !== undefined) patch.airQuality = airQualityResult;
                                                    else delete patch.airQuality;
                                                    break;
                                                }
                                                case "forecastNextHour": {
                                                    if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`body.forecastNextHour: ${JSON.stringify(body?.forecastNextHour, null, 2)}`);
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.conditionType();
                                                        matchEnum.forecastToken();
                                                    }
                                                    await replaceWeather("forecastNextHour", InjectForecastNextHour);
                                                    break;
                                                }
                                                case "weatherAlerts": {
                                                    if (Settings?.LogLevel === "DEBUG" || Settings?.LogLevel === "ALL") {
                                                        matchEnum.severity();
                                                        matchEnum.significanceType();
                                                        matchEnum.urgency();
                                                        matchEnum.certainty();
                                                        matchEnum.importanceType();
                                                        matchEnum.responseType();
                                                    }
                                                    await replaceWeather("weatherAlerts", InjectWeatherAlerts);
                                                    break;
                                                }
                                                default:
                                                    break;
                                            }
                                        }),
                                    );
                                    const effectiveCurrentWeather = patch.currentWeather ?? body.currentWeather;
                                    const effectiveNextHour = patch.forecastNextHour ?? body.forecastNextHour;
                                    if (syncCurrentConditionWithNextHour(effectiveCurrentWeather, effectiveNextHour)) patch.currentWeather = effectiveCurrentWeather;
                                    sanitizeResponseMetadata(body, patch);
                                    adaptWK3ConditionCode(patch);
                                    adaptWK3PrecipitationAmount(patch);
                                    if (Object.keys(patch).length > 0) rawBody = WeatherKit3.encode(ByteBuffer, patch);
                                    break;
                                }
                            }
                            break;
                    }
                    break;
                }
                case "application/protobuf":
                case "application/x-protobuf":
                case "application/vnd.google.protobuf":
                    break;
                case "application/grpc":
                case "application/grpc+proto":
                    break;
                case "application/octet-stream":
                    break;
            }
            // 写入二进制数据
            $response.body = rawBody;
            break;
        }
    }
    return $response;
}

/**
 * 注入当前天气数据
 * @param {any} currentWeather - 当前天气数据对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} enviroments - 环境变量
 * @returns {Promise<any>} 注入后的当前天气数据
 */
async function InjectCurrentWeather(currentWeather, Settings, enviroments) {
    Console.info("☑️ InjectCurrentWeather");
    if (!Settings?.Weather?.Replace?.includes(enviroments.country)) {
        Console.warn("InjectCurrentWeather", `Unreplaced country: ${enviroments.country}`);
        Console.info("✅ InjectCurrentWeather");
        return currentWeather;
    }
    let newCurrentWeather;
    switch (Settings?.Weather?.Provider) {
        case "WeatherKit":
        default:
            break;
        case "QWeather": {
            newCurrentWeather = await enviroments.qWeather.WeatherNow();
            break;
        }
        case "ColorfulClouds": {
            newCurrentWeather = await enviroments.colorfulClouds.CurrentWeather();
            break;
        }
    }
    if (newCurrentWeather?.metadata) {
        newCurrentWeather.metadata = { ...currentWeather?.metadata, ...newCurrentWeather.metadata };
        currentWeather = { ...currentWeather, ...newCurrentWeather };
        currentWeather.metadata.providerLogo ||= providerNameToLogo(currentWeather.metadata.providerName);
        //Console.debug(`currentWeather: ${JSON.stringify(currentWeather, null, 2)}`);
    }
    Console.info("✅ InjectCurrentWeather");
    return currentWeather;
}

/**
 * WK3 二进制分支专用形状适配：把注入的标量字符串 conditionCode 包回单元素数组。
 * WK3 协议里 conditionCode 是单元素字符串数组；彩云/和风注入写入标量字符串，
 * 会导致 WeatherKit3.encode.compile 报 Invalid WK3 vector。已是数组则保持不变（幂等）。
 * 仅在 v3 二进制分支调用；v2 与 v3 JSON 分支不受影响。
 */
export function adaptWK3ConditionCode(patch) {
    if (!patch || typeof patch !== "object") return;
    const adapt = value => {
        if (typeof value?.conditionCode === "string") value.conditionCode = [value.conditionCode];
    };
    adapt(patch.currentWeather);
    if (Array.isArray(patch.forecastDaily?.days)) {
        for (const day of patch.forecastDaily.days) {
            adapt(day);
            adapt(day?.daytimeForecast);
            adapt(day?.overnightForecast);
            adapt(day?.restOfDayForecast);
        }
    }
    if (Array.isArray(patch.forecastHourly?.hours)) {
        for (const hour of patch.forecastHourly.hours) adapt(hour);
    }
}

/**
 * WK3 二进制分支专用形状适配：把注入的标量数字 precipitationAmount 回填为
 * WK3 降水量对象 { expected, minimum, maximum }（对象键结构见
 * tests/weatherKit3WeatherReplacement.test.mjs:65,81；三键取同一彩云数值，
 * 与该测试的 mock 形态一致）。已是对象则保持不变。
 * 仅在 v3 二进制分支调用；v2 与 v3 JSON 分支不受影响（JSON 里降水量本就是数字）。
 */
export function adaptWK3PrecipitationAmount(patch) {
    if (!patch || typeof patch !== "object") return;
    const hours = patch.forecastHourly?.hours;
    if (!Array.isArray(hours)) return;
    for (const hour of hours) {
        if (!hour || typeof hour !== "object") continue;
        const amount = hour.precipitationAmount;
        if (typeof amount === "number" && Number.isFinite(amount)) {
            hour.precipitationAmount = { expected: amount, minimum: amount, maximum: amount };
        }
    }
}

/**
 * 当逐分钟雷达确认当前正在有效降雨时，将无雨实况天况同步为对应雨况，
 * 并将实况降水强度/体感降水强度向上对齐至首分钟数值，避免 Slot 1 与 Slot 5 跨槽位失步。
 * @param {any} currentWeather - 当前天气数据对象
 * @param {any} forecastNextHour - 未来一小时降水数据对象
 * @returns {boolean} 是否改写了 conditionCode / precipitationIntensity / perceivedPrecipitationIntensity 任一字段
 */
export function syncCurrentConditionWithNextHour(currentWeather, forecastNextHour) {
    if (!currentWeather || !forecastNextHour) return false;
    const isConditionArray = Array.isArray(currentWeather.conditionCode);
    const currentCondition = isConditionArray ? currentWeather.conditionCode[0] : currentWeather.conditionCode;
    const firstMinute = Array.isArray(forecastNextHour.minutes) ? forecastNextHour.minutes[0] : undefined;
    const firstIntensity = Number(firstMinute?.precipitationIntensity);
    const hasPerceived = typeof firstMinute?.perceivedPrecipitationIntensity === "number" && Number.isFinite(firstMinute.perceivedPrecipitationIntensity);
    const firstPerceived = Number(firstMinute?.perceivedPrecipitationIntensity);
    const firstSummary = Array.isArray(forecastNextHour.summary) ? forecastNextHour.summary[0] : undefined;
    const summaryConditions = Array.isArray(firstSummary?.condition) ? firstSummary.condition : firstSummary?.condition == null ? [] : [firstSummary.condition];
    const summaryRaining = firstSummary?.clear === false && summaryConditions.some(condition => RAIN_SUMMARY_CONDITIONS.has(condition));
    const rainingNow = (Number.isFinite(firstPerceived) && firstPerceived >= 0.1) || summaryRaining;
    if (!rainingNow) return false;

    let changed = false;

    if (NO_RAIN_CONDITIONS.has(currentCondition)) {
        let nextCondition;
        if (typeof firstMinute?.condition === "string" && firstMinute.condition && firstMinute.condition !== "CLEAR") {
            nextCondition = firstMinute.condition;
        } else if (Number.isFinite(firstPerceived)) {
            if (firstPerceived > 2) nextCondition = "HEAVY_RAIN";
            else if (firstPerceived > 1) nextCondition = "RAIN";
            else if (firstPerceived >= 0.1) nextCondition = "DRIZZLE";
        }
        if (nextCondition === undefined) {
            if (firstSummary?.maxCondition === "DRIZZLE" || firstSummary?.maxCondition === "POSSIBLE_DRIZZLE") nextCondition = "DRIZZLE";
            else nextCondition = "RAIN";
        }
        if (nextCondition !== currentCondition) {
            Console.info("syncCurrentConditionWithNextHour", `conditionCode: ${currentWeather.conditionCode} -> ${nextCondition}`, `firstMinuteIntensity: ${firstIntensity}`);
            currentWeather.conditionCode = isConditionArray ? [nextCondition] : nextCondition;
            changed = true;
        }
    }

    if (hasPerceived && firstMinute.perceivedPrecipitationIntensity >= 0.1) {
        if (
            Number.isFinite(firstIntensity) &&
            (!(typeof currentWeather.precipitationIntensity === "number" && Number.isFinite(currentWeather.precipitationIntensity)) ||
                currentWeather.precipitationIntensity < firstIntensity)
        ) {
            currentWeather.precipitationIntensity = firstIntensity;
            changed = true;
        }
        if (
            !(typeof currentWeather.perceivedPrecipitationIntensity === "number" && Number.isFinite(currentWeather.perceivedPrecipitationIntensity)) ||
            currentWeather.perceivedPrecipitationIntensity < firstMinute.perceivedPrecipitationIntensity
        ) {
            currentWeather.perceivedPrecipitationIntensity = firstMinute.perceivedPrecipitationIntensity;
            changed = true;
        }
    }

    return changed;
}

/**
 * 当请求 URL 缺失 country 查询参数（如美区设置下的小组件请求）时，
 * 按国内经纬度兜底推断国家代码，避免将国内坐标误判为国外（Issue #100）。
 * 显式传入的非 CN 国家码（如 country=US、country=JP）始终原样返回；
 * 显式传入 country=CN（国行设备）时仍先按收紧矩形判定港澳台，
 * 大陆矩形内保持 CN，大陆矩形外（海域）返回 undefined（第 36 轮海洋守卫）。
 * @param {URL} url - 请求 URL 对象
 * @param {{ country?: string, latitude?: string | number, longitude?: string | number }} parameters - parseWeatherKitURL 解析结果
 * @returns {string | undefined}
 */
export function resolveCountryForResponse(url, parameters) {
    const explicitCountry = url?.searchParams?.get("country")?.toUpperCase();
    if (explicitCountry && explicitCountry !== "CN") return explicitCountry;
    const lat = Number(parameters?.latitude);
    const lon = Number(parameters?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (lat >= 22.15 && lat <= 22.50 && lon >= 113.83 && lon <= 114.44) return "HK";
        if (lat >= 22.09 && lat <= 22.21 && lon >= 113.52 && lon <= 113.60) return "MO";
        if (lat >= 21.85 && lat <= 25.35 && lon >= 119.95 && lon <= 122.05) return "TW";
        if (lat >= 18 && lat <= 54 && lon >= 73 && lon <= 135) return "CN";
        if (parameters?.country === "CN") return undefined;
    }
    return parameters?.country;
}


const APPLE_ATTRIBUTION_URL = "https://developer.apple.com/weatherkit/data-source-attribution/";
const THIRD_PARTY_ATTRIBUTION_PATTERN = /qweather\.com|caiyunapp\.com/i;
const NO_RAIN_CONDITIONS = new Set(["CLEAR", "MOSTLY_CLEAR", "PARTLY_CLOUDY", "MOSTLY_CLOUDY", "CLOUDY", "HAZE", "FOGGY", "WINDY", "BREEZY"]);
const RAIN_SUMMARY_CONDITIONS = new Set(["RAIN", "DRIZZLE", "HEAVY_RAIN", "THUNDERSTORMS", "FREEZING_DRIZZLE", "POSSIBLE_DRIZZLE"]);
const SANITIZE_SKIP_KEYS = new Set(["hours", "minutes", "summary", "condition", "pollutants", "parameters"]);

/**
 * 递归清理对象内所有归属/图标字段：删除 providerLogo，把命中的第三方归属链接统一为苹果官方地址。
 * 覆盖顶层 metadata 与嵌套字段（如预警项 attributionUrl）；不改动 providerName、detailsUrl 与其他字段。
 * @param {any} value - 待清理的对象或数组
 * @param {Set<object>} [seen] - 已访问对象（防循环引用）
 * @returns {boolean} 是否改动了任何字段
 */
function sanitizeResponseObject(value, seen = new Set()) {
    if (!value || typeof value !== "object" || seen.has(value)) return false;
    seen.add(value);
    let changed = false;
    if (Array.isArray(value)) {
        for (const item of value) if (sanitizeResponseObject(item, seen)) changed = true;
        return changed;
    }
    if ("providerLogo" in value) {
        if (value.providerLogo !== undefined) changed = true;
        delete value.providerLogo;
    }
    for (const key of ["attributionUrl", "attributionURL"]) {
        if (typeof value[key] === "string" && THIRD_PARTY_ATTRIBUTION_PATTERN.test(value[key])) {
            value[key] = APPLE_ATTRIBUTION_URL;
            changed = true;
        }
    }
    for (const key of Object.keys(value)) {
        if (SANITIZE_SKIP_KEYS.has(key)) continue;
        if (sanitizeResponseObject(value[key], seen)) changed = true;
    }
    return changed;
}

/**
 * 最终输出前兜底清理全部数据集的归属/图标字段：动态遍历 body 与 patch 的全部顶层键，
 * 覆盖 11 个 dataSets 及后续新增数据集（含 dataNotice、forecastPeriodic、historicalComparisons、
 * weatherChanges、news 等非注入产品）；嵌套字段一并清理。
 * v3 二进制分支用 patch 视图：改动落在 body 原对象上时写回 patch，保证编码时生效。
 * @param {any} body - 解码后的响应体
 * @param {any} [patch] - v3 二进制分支的补丁对象（无补丁时不传）
 * @returns {boolean} 是否改动了任何字段
 */
function sanitizeResponseMetadata(body, patch) {
    if (!body || typeof body !== "object") return false;
    let changed = false;
    for (const key of new Set([...Object.keys(body), ...(patch ? Object.keys(patch) : [])])) {
        const effective = patch?.[key] ?? body?.[key];
        if (sanitizeResponseObject(effective)) {
            changed = true;
            if (patch && effective !== patch[key]) patch[key] = effective;
        }
    }
    return changed;
}

/**
 * 注入每日天气预报数据
 * @param {any} forecastDaily - 每日预报数据对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} enviroments - 环境变量
 * @returns {Promise<any>} 注入后的每日预报数据
 */
async function InjectForecastDaily(forecastDaily, Settings, enviroments) {
    Console.info("☑️ InjectForecastDaily");
    if (!Settings?.Weather?.Replace?.includes(enviroments.country)) {
        Console.warn("InjectForecastDaily", `Unreplaced country: ${enviroments.country}`);
        Console.info("✅ InjectForecastDaily");
        return forecastDaily;
    }
    let newForecastDaily;
    switch (Settings?.Weather?.Provider) {
        case "WeatherKit":
        default:
            break;
        case "QWeather": {
            newForecastDaily = await enviroments.qWeather.Daily();
            break;
        }
        case "ColorfulClouds": {
            const dailysteps = forecastDaily?.days?.length || 11;
            const begin = forecastDaily?.days?.[0]?.forecastStart;
            //Console.debug(`dailysteps: ${dailysteps}, begin: ${begin}`);
            newForecastDaily = await enviroments.colorfulClouds.Daily(dailysteps, begin);
            break;
        }
    }
    if (newForecastDaily?.metadata) {
        forecastDaily = {
            ...forecastDaily,
            metadata: { ...forecastDaily?.metadata, ...newForecastDaily.metadata },
            days: Weather.mergeForecast(forecastDaily?.days, newForecastDaily?.days, { mutate: false }),
        };
        forecastDaily.metadata.providerLogo ||= providerNameToLogo(forecastDaily.metadata.providerName);
    }
    Console.info("✅ InjectForecastDaily");
    return forecastDaily;
}

/**
 * 注入小时天气预报数据
 * @param {any} forecastHourly - 小时预报数据对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} enviroments - 环境变量
 * @returns {Promise<any>} 注入后的小时预报数据
 */
async function InjectForecastHourly(forecastHourly, Settings, enviroments) {
    Console.info("☑️ InjectForecastHourly");
    if (!Settings?.Weather?.Replace?.includes(enviroments.country)) {
        Console.warn("InjectForecastHourly", `Unreplaced country: ${enviroments.country}`);
        Console.info("✅ InjectForecastHourly");
        return forecastHourly;
    }
    let newForecastHourly;
    switch (Settings?.Weather?.Provider) {
        case "WeatherKit":
        default:
            break;
        case "QWeather": {
            newForecastHourly = await enviroments.qWeather.Hourly();
            break;
        }
        case "ColorfulClouds": {
            const hourlysteps = forecastHourly?.hours?.length || 273;
            const begin = forecastHourly?.hours?.[0]?.forecastStart;
            //Console.debug(`hourlysteps: ${hourlysteps}, begin: ${begin}`);
            newForecastHourly = await enviroments.colorfulClouds.ForecastHourly(hourlysteps, begin);
            break;
        }
    }
    if (newForecastHourly?.metadata) {
        forecastHourly = {
            ...forecastHourly,
            metadata: { ...forecastHourly?.metadata, ...newForecastHourly.metadata },
            hours: Weather.mergeForecast(forecastHourly?.hours, newForecastHourly?.hours, { mutate: false }),
        };
        forecastHourly.metadata.providerLogo ||= providerNameToLogo(forecastHourly.metadata.providerName);
    }
    Console.info("✅ InjectForecastHourly");
    return forecastHourly;
}

/**
 * 注入下一小时天气预报数据
 * @param {any} forecastNextHour - 下一小时预报数据对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} enviroments - 环境变量
 * @returns {Promise<any>} 注入后的下一小时预报数据
 */
async function InjectForecastNextHour(forecastNextHour, Settings, enviroments) {
    Console.info("☑️ InjectForecastNextHour");

    if (forecastNextHour) {
        Console.info("✅ InjectForecastNextHour");
        return forecastNextHour;
    }

    let newForecastNextHour;
    switch (Settings?.NextHour?.Provider) {
        case "WeatherKit":
            break;
        case "QWeather": {
            newForecastNextHour = await enviroments.qWeather.Minutely();
            break;
        }
        case "ColorfulClouds":
        default: {
            newForecastNextHour = await enviroments.colorfulClouds.Minutely();
            break;
        }
    }
    if (newForecastNextHour?.metadata) {
        newForecastNextHour.metadata = { ...forecastNextHour?.metadata, ...newForecastNextHour.metadata };
        forecastNextHour = { ...forecastNextHour, ...newForecastNextHour };
        forecastNextHour.metadata.providerLogo ||= providerNameToLogo(forecastNextHour.metadata.providerName);
        if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`forecastNextHour: ${JSON.stringify(forecastNextHour, null, 2)}`);
    }
    Console.info("✅ InjectForecastNextHour");
    return forecastNextHour;
}

/**
 * 补全预警数据
 * @param {any} weatherAlerts - 预警集合数据对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} enviroments - 环境变量
 * @returns {Promise<any>} 补全后的预警集合数据
 */
async function InjectWeatherAlerts(weatherAlerts, Settings, enviroments) {
    Console.info("☑️ InjectWeatherAlerts");
    // 仅在已有集合上合并；无集合时不创建，直接返回 / Merge only onto an existing collection; never create one.
    if (!weatherAlerts) return weatherAlerts;
    const isNationalWarningCenter = ["国家预警信息发布中心", "國家預警信息發布中心", "National Early Warning Center"].includes(weatherAlerts?.metadata?.providerName);
    let newWeatherAlerts;
    switch (Settings?.WeatherAlerts?.Provider) {
        case "WeatherKit": {
            break;
        }
        case "ColorfulClouds": {
            if (isNationalWarningCenter) newWeatherAlerts = await enviroments.colorfulClouds.WeatherAlert();
            break;
        }
        case "QWeather": {
            if (isNationalWarningCenter) newWeatherAlerts = await enviroments.qWeather.WeatherAlert();
            break;
        }
        case "QWeatherWeb":
        default: {
            newWeatherAlerts = await enviroments.qWeather.WeatherAlertWeb(weatherAlerts?.detailsUrl);
            break;
        }
    }
    if (newWeatherAlerts?.metadata) {
        weatherAlerts.metadata = { ...weatherAlerts?.metadata, ...newWeatherAlerts.metadata };
        weatherAlerts.detailsUrl = newWeatherAlerts.detailsUrl ?? weatherAlerts.detailsUrl;
        weatherAlerts.alerts = WeatherAlerts.mergeAlerts(weatherAlerts?.alerts, newWeatherAlerts?.alerts);
        weatherAlerts.metadata.providerLogo ||= providerNameToLogo(weatherAlerts.metadata.providerName);
    }
    Console.info("✅ InjectWeatherAlerts");
    return weatherAlerts;
}

/**
 * 注入并合并空气质量数据（污染物、指数、昨日对比）
 * @param {any} airQuality - WeatherKit 原始空气质量对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} Caches - 缓存对象
 * @param {any} enviroments - 各数据源实例与定位信息
 * @returns {Promise<any>} 合并后的空气质量对象
 */
async function InjectAirQuality(airQuality, Settings, Caches, enviroments) {
    // Step1. 修复污染物单位（Apple 原始产品入口，CO 误标场景按 PR #107 幂等处理）
    // Step 1. Fix pollutant units.
    airQuality = AirQuality.FixPollutantsUnits(airQuality, { appleProduct: true });

    // Step2. 判断原始污染物是否为空，并在需要时注入污染物数据
    const isPollutantEmpty = !Array.isArray(airQuality?.pollutants) || airQuality.pollutants.length === 0;
    const injectedPollutants = isPollutantEmpty ? await InjectPollutants(Settings, enviroments) : airQuality;
    const needPollutants = isPollutantEmpty && !!(injectedPollutants?.metadata && !injectedPollutants.metadata.temporarilyUnavailable);

    // 海域/空 AQ 短路：原始苹果 airQuality 缺失且彩云未成功注入污染物时，
    // 直接原样返回，跳过 InjectIndex、InjectComparison 与对象拼接。
    if (!airQuality?.metadata && !needPollutants) {
        return airQuality;
    }

    // Step3. 根据污染物补齐情况与替换配置，决定是否注入 AQI 指数
    const needInjectIndex = needPollutants || Settings?.AirQuality?.Current?.Index?.Replace?.some(scaleName => AirQuality.ScaleMatches(airQuality?.scale, scaleName));
    const injectedIndex = needInjectIndex ? await InjectIndex(injectedPollutants, Settings, enviroments) : injectedPollutants;

    // Step4. 计算昨日对比是否需要重算；若未知则注入昨日对比结果
    const weatherKitComparison = airQuality?.previousDayComparison ?? AirQuality.Config.CompareCategoryIndexes.UNKNOWN;
    const previousDayComparison = needInjectIndex && Settings?.AirQuality?.Comparison?.ReplaceWhenCurrentChange ? AirQuality.Config.CompareCategoryIndexes.UNKNOWN : weatherKitComparison;
    const needInjectComparison = previousDayComparison === AirQuality.Config.CompareCategoryIndexes.UNKNOWN;
    const currentIndexProvider = needInjectIndex ? Settings?.AirQuality?.Current?.Index?.Provider : "WeatherKit";
    const injectedComparison = needInjectComparison ? await InjectComparison(injectedIndex, currentIndexProvider, Settings, Caches, enviroments) : { ...injectedIndex, previousDayComparison: weatherKitComparison };

    // Step5. 生成单行来源文案：只显示数据源名，不再换行堆叠
    const weatherKitMetadata = airQuality?.metadata;
    const pollutantMetadata = injectedPollutants?.metadata;
    const indexMetadata = injectedIndex?.metadata;
    const sourceProviderName =
        (needInjectIndex && indexMetadata?.providerName && !indexMetadata.temporarilyUnavailable ? indexMetadata.providerName : undefined)
        ?? (needPollutants && pollutantMetadata?.providerName && !pollutantMetadata.temporarilyUnavailable ? pollutantMetadata.providerName : undefined)
        ?? (weatherKitMetadata?.providerName && !weatherKitMetadata.temporarilyUnavailable ? weatherKitMetadata.providerName : undefined);
    const providerName = sourceProviderName ?? "";

    // Step7. 合并输出：优先使用可用注入结果，并统一 metadata / pollutants / previousDayComparison
    airQuality = {
        ...airQuality,
        ...(injectedIndex?.metadata && !injectedIndex.metadata.temporarilyUnavailable ? injectedIndex : {}),
        metadata: {
            ...(airQuality?.metadata ? airQuality.metadata : injectedPollutants?.metadata),
            providerName,
            // 不下发任何第三方图标或第三方官网归属链接：归属链接统一为苹果官方地址
            attributionUrl: APPLE_ATTRIBUTION_URL,
        },
        pollutants: AirQuality.ConvertPollutants(airQuality, injectedPollutants, needInjectIndex, injectedIndex, Settings) ?? [],
        previousDayComparison: injectedComparison?.previousDayComparison ?? AirQuality.Config.CompareCategoryIndexes.UNKNOWN,
    };
    // 展开后显式删除透传进来的 providerLogo（苹果原厂元数据可能自带第三方图标链接）
    delete airQuality.metadata.providerLogo;
    if (Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.debug(`airQuality: ${JSON.stringify(airQuality, null, 2)}`);
    return airQuality;
}

async function InjectPollutants(Settings, enviroments) {
    Console.info("☑️ InjectPollutants");

    switch (Settings?.AirQuality?.Current?.Pollutants?.Provider) {
        case "QWeather": {
            const currentAirQuality = await enviroments.qWeather.CurrentAirQuality();
            Console.info("✅ InjectPollutants");
            return currentAirQuality;
        }
        case "ColorfulClouds":
        default: {
            const currentAirQuality = await enviroments.colorfulClouds.CurrentAirQuality();
            Console.info("✅ InjectPollutants");
            return currentAirQuality;
        }
    }
}

/**
 * 注入空气质量数据
 * @param {any} airQuality - 空气质量数据对象
 * @param {import('./types').Settings} Settings - 设置对象
 * @param {any} enviroments - 环境变量
 * @returns {Promise<any>} 注入后的空气质量数据
 */
async function InjectIndex(airQuality, Settings, enviroments) {
    Console.info("☑️ InjectIndex");

    switch (Settings?.AirQuality?.Current?.Index?.Provider) {
        case "QWeather": {
            const currentAirQuality = await enviroments.qWeather.CurrentAirQuality(Settings.AirQuality.Current.Index.ForceCNPrimaryPollutants);
            Console.info("✅ InjectIndex");
            return currentAirQuality;
        }
        case "ColorfulCloudsUS":
        case "ColorfulCloudsCN": {
            const currentAirQuality = await enviroments.colorfulClouds.CurrentAirQuality(Settings.AirQuality.Current.Index.Provider === "ColorfulCloudsUS", Settings.AirQuality.Current.Index.ForceCNPrimaryPollutants);
            Console.info("✅ InjectIndex");
            return currentAirQuality;
        }
        case "Calculate":
        default: {
            const currentAirQuality = AirQuality.Pollutants2AQI(airQuality, Settings);
            Console.info("✅ InjectIndex");
            return currentAirQuality;
        }
        // TODO
        case "WAQI": {
            if (Settings?.API?.WAQI?.Token) {
                return await enviroments.waqi.AQI2();
            } else {
                const Nearest = await enviroments.waqi.Nearest();
                const Token = await enviroments.waqi.Token(Nearest?.metadata?.stationId);
                //Caches.WAQI.set(stationId, Token);
                const aqi = await enviroments.waqi.AQI(Nearest?.metadata?.stationId, Token);

                return {
                    metadata: { ...Nearest?.metadata, ...aqi?.metadata },
                    ...Nearest,
                    ...aqi,
                };
            }
        }
    }
}

async function InjectComparison(airQuality, currentIndexProvider, Settings, Caches, enviroments) {
    Console.info("☑️ InjectComparison");

    const { UNKNOWN } = AirQuality.Config.CompareCategoryIndexes;

    /**
     * HJ 633—2012
     * [环境空气质量指数（AQI）技术规定（试行）_中华人民共和国生态环境部]{@link https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/201203/t20120302_224166.shtml}
     */
    const isHJ6332012 = (currentIndexProvider, currentScale, Settings) => {
        Console.info("☑️ isHJ6332012", `currentIndexProvider: ${currentIndexProvider}`);

        switch (currentIndexProvider) {
            case "Calculate": {
                Console.debug(`Settings?.AirQuality?.Calculate?.Algorithm: ${Settings?.AirQuality?.Calculate?.Algorithm}`);
                const result = Settings?.AirQuality?.Calculate?.Algorithm === "WAQI_InstantCast_CN";
                Console.info("✅ isHJ6332012", result);
                return result;
            }
            case "QWeather":
            case "ColorfulCloudsCN": {
                Console.info("✅ isHJ6332012", true);
                return true;
            }
            case "WeatherKit": {
                const result = AirQuality.ScaleMatches(currentScale, AirQuality.Config.Scales.HJ6332012.weatherKitScale.name);
                Console.info("✅ isHJ6332012", result);
                return result;
            }
            default: {
                Console.info("✅ isHJ6332012", false);
                return false;
            }
        }
    };
    /**
     * EPA 454/B-18-007
     * [Technical Assistance Document for the Reporting of Daily Air Quality – the Air Quality Index (AQI)]{@link https://www.airnow.gov/sites/default/files/2020-05/aqi-technical-assistance-document-sept2018.pdf}
     */
    const isEPA454_B18007 = currentIndexProvider => {
        Console.info("☑️ isHJ6332012", `currentIndexProvider: ${currentIndexProvider}`);

        switch (currentIndexProvider) {
            case "WAQI":
            case "ColorfulCloudsUS": {
                Console.info("✅ isHJ6332012", true);
                return true;
            }
            default: {
                Console.info("✅ isHJ6332012", false);
                return false;
            }
        }
    };

    const colorfulCloudsComparison = async (useUsa, currentCategoryIndex) => {
        Console.info("☑️ colorfulCloudsComparison", `currentCategoryIndex: ${currentCategoryIndex}`);
        const yesterdayAirQuality = await enviroments.colorfulClouds.YesterdayAirQuality(useUsa);

        const getMetadata = (temporarilyUnavailable = false) => ({
            ...yesterdayAirQuality.metadata,
            providerName: `指数：${AirQuality.appendScaleToProviderName(yesterdayAirQuality)}`,
            temporarilyUnavailable,
        });

        if (!yesterdayAirQuality.metadata.temporarilyUnavailable) {
            if (currentCategoryIndex) {
                const comparisonAirQuality = {
                    ...yesterdayAirQuality,
                    metadata: getMetadata(false),
                    previousDayComparison: AirQuality.CompareCategoryIndexes(currentCategoryIndex, yesterdayAirQuality.categoryIndex),
                };
                Console.info("✅ colorfulCloudsComparison");
                return comparisonAirQuality;
            } else {
                const colorfulCloudsCurrent = await enviroments.colorfulClouds.CurrentAirQuality(useUsa);
                if (!colorfulCloudsCurrent.metadata.temporarilyUnavailable) {
                    Console.debug(`colorfulCloudsCurrent?.index: ${colorfulCloudsCurrent?.index}`);
                    const comparisonAirQuality = {
                        ...yesterdayAirQuality,
                        metadata: getMetadata(false),
                        previousDayComparison: AirQuality.CompareCategoryIndexes(colorfulCloudsCurrent.categoryIndex, yesterdayAirQuality.categoryIndex),
                    };
                    Console.info("✅ colorfulCloudsComparison");
                    return comparisonAirQuality;
                }
            }
        }

        Console.error("colorfulCloudsComparison", `无法从彩云天气获取${yesterdayAirQuality.metadata.temporarilyUnavailable ? "昨日" : "今日"}的空气质量数据`);
        return {
            ...yesterdayAirQuality,
            metadata: getMetadata(true),
            previousDayComparison: UNKNOWN,
        };
    };
    const qweatherComparison = async (currentCategoryIndex, pollutantsToAirQuality) => {
        Console.info("☑️ qweatherComparison", `currentCategoryIndex: ${currentCategoryIndex}`);
        const setQWeatherCache = qweatherCache => {
            Caches.qweather = qweatherCache;
            Storage.setItem("@iRingo.WeatherKit.Caches", { ...Caches, qweather: qweatherCache });
        };

        const locationsGrid = await QWeather.GetLocationsGrid(Caches?.qweather, setQWeatherCache);
        const { latitude, longitude } = enviroments.qWeather;
        const locationInfo = QWeather.GetLocationInfo(locationsGrid, latitude, longitude);

        const yesterdayQWeather = await enviroments.qWeather.YesterdayAirQuality(locationInfo);

        const getMetadata = (indexProvider, temporarilyUnavailable = false) => ({
            ...yesterdayQWeather.metadata,
            providerName: `污染物：和风天气，指数：${indexProvider}`,
            temporarilyUnavailable,
        });

        if (!yesterdayQWeather.metadata.temporarilyUnavailable) {
            const airQualityFromPollutants = pollutantsToAirQuality(yesterdayQWeather);
            const yesterdayAirQuality = pollutantsToAirQuality
                ? {
                      ...airQualityFromPollutants,
                      metadata: {
                          ...airQualityFromPollutants.metadata,
                          providerName: AirQuality.appendScaleToProviderName(airQualityFromPollutants, Settings),
                      },
                  }
                : {
                      ...yesterdayQWeather,
                      metadata: {
                          ...yesterdayQWeather.metadata,
                          providerName: AirQuality.appendScaleToProviderName(yesterdayQWeather),
                      },
                  };

            if (currentCategoryIndex) {
                const comparisonAirQuality = {
                    ...yesterdayQWeather,
                    metadata: getMetadata(yesterdayAirQuality.metadata.providerName, false),
                    previousDayComparison: AirQuality.CompareCategoryIndexes(currentCategoryIndex, yesterdayAirQuality.categoryIndex),
                };
                Console.info("✅ qweatherComparison");
                return comparisonAirQuality;
            } else {
                const qweatherCurrent = await enviroments.qWeather.CurrentAirQuality(locationInfo);
                if (!qweatherCurrent.metadata.temporarilyUnavailable) {
                    Console.debug(`qweatherCurrent?.index: ${qweatherCurrent?.index}`);

                    const comparisonAirQuality = {
                        ...yesterdayQWeather,
                        metadata: getMetadata(yesterdayAirQuality.metadata.providerName, false),
                        previousDayComparison: AirQuality.CompareCategoryIndexes(qweatherCurrent.categoryIndex, yesterdayAirQuality.categoryIndex),
                    };
                    Console.info("✅ qweatherComparison");
                    return comparisonAirQuality;
                }
            }
        }

        Console.error("qweatherComparison", `无法从和风天气获取${yesterdayQWeather.metadata.temporarilyUnavailable ? "昨日" : "今日"}空气质量数据`);
        return {
            ...yesterdayQWeather,
            metadata: getMetadata(yesterdayQWeather.metadata.providerName, true),
            previousDayComparison: UNKNOWN,
        };
    };

    switch (Settings?.AirQuality?.Comparison?.Yesterday?.IndexProvider) {
        case "Calculate": {
            const algorithm = AirQuality.chooseAlogrithm(airQuality, Settings);
            const PollutantsProvider = Settings?.AirQuality?.Comparison?.Yesterday?.PollutantsProvider;
            Console.debug(`Settings?.AirQuality?.Comparison?.Yesterday?.PollutantsProvider: ${PollutantsProvider}`);

            if (algorithm !== "") {
                switch (PollutantsProvider) {
                    case "QWeather":
                    default: {
                        const pollutantsToAirQuality = airQuality => AirQuality.Pollutants2AQI(airQuality, Settings, { algorithm });
                        const comparisonAirQuality = await qweatherComparison(airQuality?.categoryIndex, pollutantsToAirQuality);
                        Console.info("✅ InjectComparison");
                        return comparisonAirQuality;
                    }
                }
            }

            Console.error("InjectComparison", "不支持今日空气质量的标准");
            return { metadata: { temporarilyUnavailable: true }, previousDayComparison: UNKNOWN };
        }
        case "QWeather": {
            const comparisonAirQuality = await qweatherComparison(isHJ6332012(currentIndexProvider, airQuality?.scale, Settings) ? airQuality?.categoryIndex : undefined);
            Console.info("✅ InjectComparison");
            return comparisonAirQuality;
        }
        case "ColorfulCloudsCN": {
            // Use injected AQI or ColorfulClouds AQI depends on data source
            const comparisonAirQuality = colorfulCloudsComparison(false, isHJ6332012(currentIndexProvider, airQuality?.scale, Settings) ? airQuality?.categoryIndex : undefined);
            Console.info("✅ InjectComparison");
            return comparisonAirQuality;
        }
        case "ColorfulCloudsUS":
        default: {
            const comparisonAirQuality = colorfulCloudsComparison(true, isEPA454_B18007(currentIndexProvider) ? airQuality?.categoryIndex : undefined);
            Console.info("✅ InjectComparison");
            return comparisonAirQuality;
        }
    }
}
