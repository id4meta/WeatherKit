import { fetch } from "@nsnanocat/util";
import { Hono } from "hono/tiny";
import HonoWorkerAdapter from "./class/HonoWorkerAdapter.mjs";
import { Request } from "./process/Request.mjs";
import { Response, resolveCountryForResponse } from "./process/Response.mjs";
import ColorfulClouds from "./class/ColorfulClouds.mjs";
import database from "./function/database.mjs";
import parseWeatherKitURL from "./function/parseWeatherKitURL.mjs";
import setENV from "./function/setENV.mjs";
/***************** Processing *****************/

export default new Hono()
    .get("/", c => c.text("OK"))
    .all("/:rest{.*}", async c => {
        let $request = await HonoWorkerAdapter.buildRequest(c.req);
        $request = HonoWorkerAdapter.buildArgument($request);
        let waitUntil;
        try {
            waitUntil = typeof c.executionCtx?.waitUntil === "function" ? p => c.executionCtx.waitUntil(p) : undefined;
        } catch {}
        if (waitUntil) $request._waitUntil = waitUntil;
        let $response;
        ({ $request, $response } = await Request($request));
        switch (typeof $response) {
            case "undefined": {
                try {
                    const reqUrl = new URL($request.url);
                    if (reqUrl.pathname.startsWith("/api/v3/weather/") || reqUrl.pathname.startsWith("/api/v2/weather/")) {
                        const params = parseWeatherKitURL(reqUrl);
                        params.country = resolveCountryForResponse(reqUrl, params);
                        if (params.country === "CN") {
                            const { Settings } = setENV("iRingo", "WeatherKit", database);
                            if (Settings?.Weather?.Provider === "ColorfulClouds" || Settings?.NextHour?.Provider === "ColorfulClouds") {
                                const cc = new ColorfulClouds(params, Settings?.API?.ColorfulClouds?.Token || "Y2FpeXVuX25vdGlmeQ==", waitUntil);
                                const ds = new Set(params.dataSets);
                                if (ds.has("currentWeather") || ds.has("airQuality")) cc.prefetchRealTime();
                                if (ds.has("forecastNextHour")) cc.prefetchMinutely();
                                $request._prefetchedColorfulClouds = cc;
                            }
                        } else if (params.country === "HK" || params.country === "MO") {
                            const { Settings } = setENV("iRingo", "WeatherKit", database);
                            const ds = new Set(params.dataSets);
                            if (
                                ds.has("airQuality") &&
                                (Settings?.AirQuality?.Current?.Pollutants?.Provider === "ColorfulClouds" || Settings?.AirQuality?.Current?.Index?.Provider === "ColorfulCloudsCN")
                            ) {
                                const cc = new ColorfulClouds(params, Settings?.API?.ColorfulClouds?.Token || "Y2FpeXVuX25vdGlmeQ==", waitUntil);
                                cc.prefetchRealTime();
                                $request._prefetchedColorfulClouds = cc;
                            }
                        }
                    }
                } catch {}
                $response = await fetch($request);
                $response = await Response($request, $response);
                break;
            }
            case "object":
                break;
            default:
                throw new TypeError(`Invalid response type: ${typeof $response}`);
        }
        return HonoWorkerAdapter.writeResponse(c, $response);
    })
    .onError((e, c) => {
        console.error(e);
        return c.text("Internal Server Error", 500);
    });
