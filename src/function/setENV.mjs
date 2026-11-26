import { Lodash as _, Console, Storage } from "@nsnanocat/util";
import getStorage from "@nsnanocat/util/getStorage.mjs";

/**
 * Set Environment Variables
 * @author VirgilClyne
 * @param {String} name - Persistent Store Key
 * @param {Array} platforms - Platform Names
 * @param {Object} database - Default DataBase
 * @return {Object} { Settings, Caches, Configs }
 */

// 模块级默认环境记忆化：无 $argument 覆盖且无持久存储覆盖时，复用首次解析的默认 Settings/Configs。
// 每次返回浅拷贝外壳与全新的 Caches: {}，避免跨请求共享可变状态。
let cachedDefaultEnv = null;

// $argument（字符串或对象）中与默认 Settings 顶层键冲突的键，视为覆盖。
const argumentOverrideKeys = defaultSettings => {
    const argument = globalThis.$argument;
    if (!argument) return [];
    const keys = typeof argument === "object" ? Object.keys(argument) : typeof argument === "string" ? argument.split("&").map(part => part.split("=")[0]).filter(Boolean) : ["$argument"];
    return keys.filter(key => Object.prototype.hasOwnProperty.call(defaultSettings, key));
};

export default function setENV(name, platforms, database) {
    Console.info("☑️ Set Environment Variables");
    const { Settings, Caches, Configs } = getStorage(name, platforms, database);
    if (Console.logLevel === "INFO" || Console.logLevel === "DEBUG" || Console.logLevel === "ALL") Console.info(`typeof Settings: ${typeof Settings}`, `Settings: ${JSON.stringify(Settings, null, 2)}`);
    string2array("DataSets");
    string2array("Weather.Replace");
    string2array("AirQuality.Current.Index.Replace");
    string2array("AirQuality.Current.Pollutants.Units.Replace");
    if (Configs.Locale) Configs.Locale = new Map(Configs.Locale);
    if (Configs.i18n) for (const type in Configs.i18n) Configs.i18n[type] = new Map(Configs.i18n[type]);
    Console.info("✅ Set Environment Variables");
    if (!argumentOverrideKeys(Settings).length && !Storage.getItem(name)) {
        if (!cachedDefaultEnv) cachedDefaultEnv = { Settings, Configs };
        const cached = cachedDefaultEnv;
        const memoizedConfigs = { ...cached.Configs };
        if (memoizedConfigs.Locale) memoizedConfigs.Locale = new Map(memoizedConfigs.Locale);
        if (memoizedConfigs.i18n) {
            memoizedConfigs.i18n = { ...memoizedConfigs.i18n };
            for (const type in memoizedConfigs.i18n) memoizedConfigs.i18n[type] = new Map(memoizedConfigs.i18n[type]);
        }
        return { Settings: { ...cached.Settings }, Caches: {}, Configs: memoizedConfigs };
    }
    return { Settings, Caches, Configs };

    function string2array(path) {
        const setting = _.get(Settings, path);
        if (!Array.isArray(setting)) _.set(Settings, path, setting ? [setting] : []);
    }
}
