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
