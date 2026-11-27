import { Lodash as _, Console, Storage } from "@nsnanocat/util";
import AirQualityScale from "../class/AirQualityScale.mjs";
import ColorfulClouds from "../class/ColorfulClouds.mjs";
import QWeather from "../class/QWeather.mjs";
import WeatherAlerts from "../class/WeatherAlerts.mjs";
import database from "../function/database.mjs";
import parseWeatherKitURL from "../function/parseWeatherKitURL.mjs";
import setENV from "../function/setENV.mjs";
import { resolveCountryForResponse } from "./Response.mjs";

// /api/v1/airQualityScale/ 静态构建响应缓存：key `${language}:${scaleName}`。
const airQualityScaleCache = new Map();
const MAX_SCALE_CACHE_ENTRIES = 32;
/***************** Processing *****************/
export async function Request($request) {
    // 构造回复数据
    let $response;
    // 解构URL
    const url = new URL($request.url);
    Console.info(`url: ${url.toJSON()}`);
    const parameters = parseWeatherKitURL(url);
    // 解析格式
    const FORMAT = ($request.headers?.["Content-Type"] ?? $request.headers?.["content-type"])?.split(";")?.[0];
    Console.info(`FORMAT: ${FORMAT}`);
    /**
     * 设置
     * @type {{Settings: import('./types').Settings}}
     */
    const { Settings, Caches, Configs } = setENV("iRingo", "WeatherKit", database);
    // 方法判断
    switch ($request.method) {
        case "POST":
        case "PUT":
        case "PATCH":
        // biome-ignore lint/suspicious/noFallthroughSwitchClause: <explanation>
        case "DELETE":
            // 格式判断
            switch (FORMAT) {
                case undefined: // 视为无body
                    break;
                case "application/x-www-form-urlencoded":
                case "text/plain":
                default:
                    break;
                case "application/x-mpegURL":
                case "application/x-mpegurl":
                case "application/vnd.apple.mpegurl":
                case "audio/mpegurl":
                    //body = M3U8.parse($request.body);
                    //Console.debug(`body: ${JSON.stringify(body)}`);
                    //$request.body = M3U8.stringify(body);
                    break;
                case "text/xml":
                case "text/html":
                case "text/plist":
                case "application/xml":
                case "application/plist":
                case "application/x-plist":
                    //body = XML.parse($request.body);
                    //Console.debug(`body: ${JSON.stringify(body)}`);
                    //$request.body = XML.stringify(body);
                    break;
                case "text/vtt":
                case "application/vtt":
                    //body = VTT.parse($request.body);
                    //Console.debug(`body: ${JSON.stringify(body)}`);
                    //$request.body = VTT.stringify(body);
                    break;
                case "text/json":
                case "application/json":
                    //body = JSON.parse($request.body ?? "{}");
                    //Console.debug(`body: ${JSON.stringify(body)}`);
                    //$request.body = JSON.stringify(body);
                    break;
                case "application/protobuf":
                case "application/x-protobuf":
                case "application/vnd.google.protobuf":
                case "application/grpc":
                case "application/grpc+proto":
                case "application/octet-stream": {
                    //Console.debug(`$request: ${JSON.stringify($request, null, 2)}`);
                    const rawBody = $request.bodyBytes ? new Uint8Array($request.bodyBytes) : ($request.body ?? new Uint8Array());
                    //Console.debug(`isBuffer? ${ArrayBuffer.isView(rawBody)}: ${JSON.stringify(rawBody, null, 2)}`);
                    // 写入二进制数据
                    $request.body = rawBody;
                    break;
                }
            }
        //break; // 不中断，继续处理URL
        case "GET":
        case "HEAD":
        case "OPTIONS":
        default:
            delete $request?.headers?.["If-None-Match"];
            delete $request?.headers?.["if-none-match"];
            // 主机判断
            switch (url.hostname) {
                case "weatherkit.apple.com":
                    // 路径判断
                    switch (url.pathname) {
                        case "/api/v1/weatherAlerts": {
                            $response = await GetWeatherAlerts(url.searchParams.get("ids")?.trim(), parameters, Settings, $request.headers, $request._waitUntil);
                            break;
                        }
                        default:
                            switch (true) {
                                case url.pathname.startsWith("/api/v1/airQualityScale/"): {
                                    const { version, language } = parameters;
                                    const scaleName = parameters.scale?.replace(/\.\d+$/, "");
                                    if (version && language && scaleName) {
                                        url.pathname = `/api/${version}/airQualityScale/${language}/${scaleName}`;
                                        switch (url.pathname) {
                                            case `/api/v1/airQualityScale/${language}/HK.AQHI`:
                                            case `/api/v1/airQualityScale/${language}/CN.AQHI`: {
                                                const scaleCacheKey = `${language}:${scaleName}`;
                                                const cachedScale = airQualityScaleCache.get(scaleCacheKey);
                                                if (cachedScale) $response = cachedScale;
                                                else {
                                                    $response = new AirQualityScale().Build(language, scaleName);
                                                    if ($response) {
                                                        if (airQualityScaleCache.has(scaleCacheKey)) airQualityScaleCache.delete(scaleCacheKey);
                                                        airQualityScaleCache.set(scaleCacheKey, $response);
                                                        while (airQualityScaleCache.size > MAX_SCALE_CACHE_ENTRIES) {
                                                            airQualityScaleCache.delete(airQualityScaleCache.keys().next().value);
                                                        }
                                                    }
                                                }
                                                break;
                                            }
                                        }
                                    }
                                    break;
                                }
                                case url.pathname.startsWith("/api/v2/weather/"):
                                case url.pathname.startsWith("/api/v3/weather/"): {
                                    // 国行设备发出的港澳台请求带 country=CN：发往苹果上游前改写为 HK/MO/TW，
                                    // 由上游直接返回港澳台原厂 AQI（第 40 轮）。
                                    const resolvedCountry = resolveCountryForResponse(url, parameters);
                                    const currentCountry = url.searchParams.get("country")?.toUpperCase();
                                    if (resolvedCountry === "HK" || resolvedCountry === "MO" || resolvedCountry === "TW") {
                                        if (!currentCountry || currentCountry === "CN") {
                                            url.searchParams.set("country", resolvedCountry);
                                        }
                                    } else if (resolvedCountry === undefined && currentCountry === "CN") {
                                        url.searchParams.delete("country");
                                    }
                                    // 解决 macOS 天气 app 如果使用国际版 Maps 时，country 丢失不显示未来一小时降水的问题
                                    switch (true) {
                                        case $request.headers["User-Agent"]?.startsWith("WeatherKit_Weather_macOS_Version"):
                                        case $request.headers["user-agent"]?.startsWith("WeatherKit_Weather_macOS_Version"):
                                            if (url.searchParams.has("country")) {
                                            } else {
                                                const gcc = Storage.getItem("@iRingo.Location.Caches")?.pep?.gcc;
                                                if (gcc) url.searchParams.set("country", gcc);
                                            }
                                            break;
                                    }
                                    break;
                                }
                            }
                            break;
                    }
                    break;
            }
            break;
        case "CONNECT":
        case "TRACE":
            break;
    }
    $request.url = url.toString();
    Console.debug(`$request.url: ${$request.url}`);
    // 单请求上下文：供 Hono.js 预热与 Response() 复用 env/parameters/country，避免重复解析。
    // country 为 country 改写后的最终值（发往苹果上游前的 URL 上由 resolveCountryForResponse 确定）。
    $request._wkContext = {
        env: { Settings, Caches, Configs },
        parameters,
        country: resolveCountryForResponse(url, parameters),
    };
    return { $request, $response };
}

/**
 * 获取天气预警响应
 * @param {string | undefined} identifier - 预警标识
 * @param {ReturnType<typeof parseWeatherKitURL>} parameters - WeatherKit 请求参数
 * @param {import('../types').Settings} Settings - 设置对象
 * @param {Record<string, string>} headers - 请求头
 * @returns {Promise<object>} 天气预警响应
 */
async function GetWeatherAlerts(identifier, parameters, Settings, headers, waitUntil) {
    let body = [];
    try {
        switch (true) {
            case /^[a-z0-9'-]+-[0-9]{9}$/i.test(identifier): {
                Console.info("☑️ QWeather.FetchWeatherAlertPage", `ids: ${identifier}`);
                const source = await QWeather.FetchWeatherAlertPage(identifier, parameters.language, headers, waitUntil);
                body = WeatherAlerts.Build(source, {
                    attributionUrl: QWeather.BuildWeatherAlertPageURL(identifier, parameters.language, false),
                    identifier,
                    language: parameters.language,
                    countryCode: identifier.match(/-([0-9]+)$/)?.[1]?.startsWith("101") ? "CN" : "",
                });
                break;
            }
            case /^-?[0-9]+(?:\.[0-9]+)?,-?[0-9]+(?:\.[0-9]+)?$/.test(identifier): {
                switch (Settings?.WeatherAlerts?.Provider) {
                    case "ColorfulClouds": {
                        Console.info("☑️ ColorfulClouds.WeatherAlert", `ids: ${identifier}`);
                        const colorfulClouds = new ColorfulClouds(parameters, Settings?.API?.ColorfulClouds?.Token || "Y2FpeXVuX25vdGlmeQ==");
                        const source = await colorfulClouds.WeatherAlert();
                        body = WeatherAlerts.Build(source, {
                            attributionUrl: source?.metadata?.attributionUrl ?? "https://developer.apple.com/weatherkit/data-source-attribution/",
                            identifier: `${parameters.latitude},${parameters.longitude}`,
                            language: parameters.language,
                            countryCode: parameters.country,
                        });
                        break;
                    }
                    case "QWeatherWeb":
                    case "QWeather": {
                        const qWeather = new QWeather(parameters, Settings?.API?.QWeather?.Token || "bdd98ec1d87747f3a2e8b1741a5af796", Settings?.API?.QWeather?.Host);
                        body = WeatherAlerts.Build(await qWeather.WeatherAlert(), {
                            attributionUrl: "https://www.12379.cn/",
                            identifier: `${parameters.latitude},${parameters.longitude}`,
                            language: parameters.language,
                            countryCode: parameters.country,
                        });
                        break;
                    }
                }
                break;
            }
        }
    } catch (error) {
        Console.error("WeatherAlerts", error?.stack ?? error?.message ?? String(error));
    }
    Console.info("✅ WeatherAlerts", `alerts: ${body.length}`, "status: 200");
    return {
        status: 200,
        statusCode: 200,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "max-age=0",
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    };
}
