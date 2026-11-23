import { Console } from "@nsnanocat/util";

export default class Weather {
    static Name = "Weather";
    static Version = "0.3.0";
    static Author = "Virgil Clyne & 001";

    /**
     * 将 DSWRF（W/m²）估算为 UV Index（整数）
     * @param {number} dswrf - 向下短波辐射通量
     * @param {number} k - UV 占比系数，可选，默认 0.04
     * @returns {number} UV Index（四舍五入为整数）
     */
    static ConvertDSWRF(dswrf, k = 0.04) {
        Console.info("☑️ ConvertDSWRF");
        const uvIndex = Math.round((Math.max(dswrf, 0) * k) / 0.025); // 估算 UV Index
        //Console.debug(`UV Index: ${uvIndex}`);
        Console.info("✅ ConvertDSWRF");
        // 限制结果在 0~11，并四舍五入为整数
        return Math.min(uvIndex, 11);
    }

    /**
     * 将新的气象数组合并到原始气象数组
     * @param {array} to - 原始气象数组
     * @param {array} from - 新的气象数组
     * @param {{ mutate?: boolean }} [options] - mutate 为 true（默认）时原地合并并返回 to；为 false 时不修改 to 并返回合并后的新数组
     * @returns {array} 合并后的气象数组
     */
    static mergeForecast(to = [], from = [], { mutate = true } = {}) {
        const result = mutate ? to : new Array(to.length);
        let i = 0;
        let j = 0;
        while (i < to.length) {
            const target = to[i];
            const forecastStart = target.forecastStart;
            const newForecastStart = j < from.length ? from[j].forecastStart : Number.POSITIVE_INFINITY;

            if (forecastStart === newForecastStart) {
                const source = from[j];
                if (mutate) {
                    if (Object.hasOwn(source, "daytimeForecast")) source.daytimeForecast = { ...target.daytimeForecast, ...source.daytimeForecast };
                    if (Object.hasOwn(source, "overnightForecast")) source.overnightForecast = { ...target.overnightForecast, ...source.overnightForecast };
                    if (Object.hasOwn(source, "restOfDayForecast")) source.restOfDayForecast = { ...target.restOfDayForecast, ...source.restOfDayForecast };
                    Object.assign(target, source);
                } else {
                    const item = { ...target, ...source };
                    if (Object.hasOwn(source, "daytimeForecast")) item.daytimeForecast = { ...target.daytimeForecast, ...source.daytimeForecast };
                    if (Object.hasOwn(source, "overnightForecast")) item.overnightForecast = { ...target.overnightForecast, ...source.overnightForecast };
                    if (Object.hasOwn(source, "restOfDayForecast")) item.restOfDayForecast = { ...target.restOfDayForecast, ...source.restOfDayForecast };
                    result[i] = item;
                }
                i++;
                j++;
            } else if (newForecastStart < forecastStart) {
                j++;
            } else {
                if (!mutate) result[i] = target;
                i++;
            }
        }
        return result;
    }

    static ConvertWeatherCode(skycon) {
        switch (skycon) {
            // 晴天
            case "晴":
            case "CLEAR_DAY":
            case "CLEAR_NIGHT":
                return "CLEAR";

            // 多云相关
            case "多云":
            case "PARTLY_CLOUDY_DAY":
            case "PARTLY_CLOUDY_NIGHT":
                return "PARTLY_CLOUDY";
            case "少云":
                return "MOSTLY_CLEAR";
            case "晴间多云":
                return "PARTLY_CLOUDY";
            case "阴":
            case "CLOUDY":
                return "CLOUDY";

            // 风相关
            case "WIND":
                return "WINDY";

            // 雾霾相关
            case "薄雾":
            case "雾":
            case "浓雾":
            case "强浓雾":
            case "大雾":
            case "特强浓雾":
            case "FOG":
                return "FOGGY";
            case "霾":
            case "中度霾":
            case "重度霾":
            case "严重霾":
            case "LIGHT_HAZE":
            case "MODERATE_HAZE":
            case "HEAVY_HAZE":
                return "HAZE";

            // 沙尘相关(Apple 缺失 DUST/SAND 定义，暂用 HAZE 代替)
            case "扬沙":
            case "浮尘":
            case "沙尘暴":
            case "强沙尘暴":
            case "DUST":
            case "SAND":
                return "HAZE";

            // 降雨相关
            case "小雨":
            case "毛毛雨/细雨":
            case "LIGHT_RAIN":
                return "DRIZZLE";
            case "雨":
            case "阵雨":
            case "中雨":
            case "小到中雨":
            case "MODERATE_RAIN":
                return "RAIN";
            case "大雨":
            case "中到大雨":
                return "HEAVY_RAIN";
            case "暴雨":
            case "大暴雨":
            case "强降雨":
            case "特大暴雨":
            case "大到暴雨":
            case "暴雨到大暴雨":
            case "大暴雨到特大暴雨":
            case "极端降雨":
            case "HEAVY_RAIN":
                return "HEAVY_RAIN";
            case "雷阵雨":
            case "强雷阵雨":
            case "STORM_RAIN":
            case "雷阵雨伴有冰雹":
                return "THUNDERSTORMS";

            // 降雪相关
            case "小雪":
            case "LIGHT_SNOW":
                return "FLURRIES";
            case "雪":
            case "阵雪":
            case "中雪":
            case "小到中雪":
            case "MODERATE_SNOW":
                return "SNOW";
            case "大雪":
            case "中到大雪":
            case "HEAVY_SNOW":
                return "HEAVY_SNOW";
            case "暴雪":
            case "大到暴雪":
            case "STORM_SNOW":
                return "BLIZZARD";

            // 雨雪混合
            case "雨夹雪":
            case "雨雪天气":
            case "阵雨夹雪":
            case "冻雨":
                return "FREEZING_DRIZZLE";

            // 温度相关
            case "热":
            case "冷":

            // 未知
            case "未知":
            default:
                Console.debug(`skycon: ${skycon}`);
                return null;
        }
    }

    static ConvertWeatherCodeField(skycon) {
        const conditionCode = Weather.ConvertWeatherCode(skycon);
        // 未知 provider 值必须省略；写入 null 会覆盖 Apple 原值并被 FlatBuffer 编成 CLEAR。
        return conditionCode == null ? {} : { conditionCode };
    }

    static ConvertMoonPhase(moonPhase) {
        switch (moonPhase) {
            case "新月":
                return "NEW";
            case "蛾眉月":
                return "WAXING_CRESCENT";
            case "上弦月":
                return "FIRST_QUARTER";
            case "盈凸月":
                return "WAXING_GIBBOUS";
            case "满月":
                return "FULL";
            case "亏凸月":
                return "WANING_GIBBOUS";
            case "下弦月":
                return "THIRD_QUARTER";
            case "残月":
                return "WANING_CRESCENT";
            default:
                Console.debug(`moonPhase: ${moonPhase}`);
                return null;
        }
    }
}
