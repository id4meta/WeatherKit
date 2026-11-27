import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

globalThis.$environment = { "surge-version": "test" };
globalThis.$persistentStore = undefined;

const [{ default: setENV }, { default: database }] = await Promise.all([import("../src/function/setENV.mjs"), import("../src/function/database.mjs")]);

beforeEach(() => {
    globalThis.$argument = undefined;
    globalThis.$persistentStore = undefined;
});

test("setENV memoizes the default environment and returns independent copies", () => {
    const first = setENV("iRingo", "WeatherKit", database);
    const second = setENV("iRingo", "WeatherKit", database);
    assert.deepEqual(first.Settings, second.Settings);
    assert.notEqual(first.Settings, second.Settings, "each call must get its own Settings shell");
    assert.notEqual(first.Caches, second.Caches, "each call must get a fresh Caches object");
    assert.deepEqual(first.Configs, second.Configs);
    assert.notEqual(first.Configs, second.Configs, "each call must get its own Configs shell");
    first.Settings.LogLevel = "DEBUG";
    const third = setENV("iRingo", "WeatherKit", database);
    assert.notEqual(third.Settings.LogLevel, "DEBUG", "mutating one caller's Settings must not corrupt the memoized default");
});

test("setENV honors $argument overrides instead of memoizing", () => {
    globalThis.$argument = { LogLevel: "DEBUG" };
    const overridden = setENV("iRingo", "WeatherKit", database);
    assert.equal(overridden.Settings.LogLevel, "DEBUG");
    globalThis.$argument = undefined;
    const fallback = setENV("iRingo", "WeatherKit", database);
    assert.notEqual(fallback.Settings.LogLevel, "DEBUG", "clearing the override must restore the default");
});

test("setENV skips memoization when a persistent-store override exists", () => {
    globalThis.$persistentStore = { read: () => JSON.stringify({ LogLevel: "DEBUG" }), write: () => true };
    const first = setENV("iRingo", "WeatherKit", database);
    const second = setENV("iRingo", "WeatherKit", database);
    assert.notEqual(first.Settings, second.Settings, "each call must re-parse when a persistent override may exist");
});

test("setENV fast path skips getStorage on repeated default calls and bypasses cache on different inputs", () => {
    let reads = 0;
    const counted = new Proxy(database, {
        get(target, prop, receiver) { reads++; return Reflect.get(target, prop, receiver); },
        ownKeys(target) { reads++; return Reflect.ownKeys(target); },
        getOwnPropertyDescriptor(target, prop) { reads++; return Reflect.getOwnPropertyDescriptor(target, prop); },
    });
    // 首次调用：与已缓存的 database 引用不同，未命中快速路径，必须读取 database。
    const first = setENV("iRingo", "WeatherKit", counted);
    const firstReads = reads;
    assert.ok(firstReads > 0, `first call must read database, got ${firstReads}`);
    // 第二次同参调用：命中快速路径，不再读取 database。
    const second = setENV("iRingo", "WeatherKit", counted);
    assert.equal(reads, firstReads, "second call must not read database");
    assert.deepEqual(second.Settings, first.Settings);
    assert.notEqual(second.Settings, first.Settings, "each call must get its own Settings shell");
    // 传入不同 database 引用：绕过缓存，重新解析；之后再用 counted 调用必须重新读取。
    const realDbCall = setENV("iRingo", "WeatherKit", database);
    assert.deepEqual(realDbCall.Settings, first.Settings);
    const beforeThird = reads;
    setENV("iRingo", "WeatherKit", counted);
    assert.ok(reads > beforeThird, "different database must evict the counted cache entry");
    // $argument 覆盖：绕过缓存，覆盖值生效。
    const beforeArgument = reads;
    globalThis.$argument = { LogLevel: "DEBUG" };
    const overridden = setENV("iRingo", "WeatherKit", counted);
    assert.equal(overridden.Settings.LogLevel, "DEBUG");
    assert.ok(reads > beforeArgument, "$argument override must bypass the fast path");
    globalThis.$argument = undefined;
    // Storage 覆盖：绕过缓存，重新解析。
    const beforeStore = reads;
    globalThis.$persistentStore = { read: () => JSON.stringify({ LogLevel: "DEBUG" }), write: () => true };
    const stored = setENV("iRingo", "WeatherKit", counted);
    assert.equal(typeof stored.Settings, "object");
    assert.ok(reads > beforeStore, "persistent-store override must bypass the fast path");
    globalThis.$persistentStore = undefined;
});
