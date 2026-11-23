import assert from "node:assert/strict";
import test from "node:test";
import ForecastNextHour from "../src/class/ForecastNextHour.mjs";

const BASE_TIME = 1_700_000_000;
const INTERVAL = 10 * 60;
const RAIN_CONDITIONS = ["DRIZZLE", "RAIN", "HEAVY_RAIN"];

test("Condition preserves every existing one-to-four segment output", () => {
    const cases = [
        ["C", [["CLEAR", 0, 0]]],
        ["R", [["CONSTANT", 0, 0]]],
        [
            "CR",
            [
                ["START", 1, 1, [["FIRST_AT", 1, "startTime"]]],
                ["CONSTANT", 1, 1],
            ],
        ],
        [
            "RC",
            [
                ["STOP", 0, 0, [["FIRST_AT", 0, "endTime"]]],
                ["CLEAR", 1, 1],
            ],
        ],
        [
            "RCR",
            [
                [
                    "STOP_START",
                    0,
                    2,
                    [
                        ["FIRST_AT", 0, "endTime"],
                        ["SECOND_AT", 2, "startTime"],
                    ],
                ],
                ["START", 2, 2, [["FIRST_AT", 2, "startTime"]]],
                ["CONSTANT", 2, 2],
            ],
        ],
        [
            "CRC",
            [
                [
                    "START_STOP",
                    1,
                    1,
                    [
                        ["FIRST_AT", 1, "startTime"],
                        ["SECOND_AT", 1, "endTime"],
                    ],
                ],
                ["STOP", 1, 1, [["FIRST_AT", 1, "endTime"]]],
                ["CLEAR", 2, 2],
            ],
        ],
        [
            "RCRC",
            [
                [
                    "STOP_START",
                    0,
                    2,
                    [
                        ["FIRST_AT", 0, "endTime"],
                        ["SECOND_AT", 2, "startTime"],
                    ],
                ],
                [
                    "START_STOP",
                    2,
                    2,
                    [
                        ["FIRST_AT", 2, "startTime"],
                        ["SECOND_AT", 2, "endTime"],
                    ],
                ],
                ["STOP", 2, 2, [["FIRST_AT", 2, "endTime"]]],
                ["CLEAR", 3, 3],
            ],
        ],
        [
            "CRCR",
            [
                [
                    "START_STOP",
                    1,
                    1,
                    [
                        ["FIRST_AT", 1, "startTime"],
                        ["SECOND_AT", 1, "endTime"],
                    ],
                ],
                [
                    "STOP_START",
                    1,
                    3,
                    [
                        ["FIRST_AT", 1, "endTime"],
                        ["SECOND_AT", 3, "startTime"],
                    ],
                ],
                ["START", 3, 3, [["FIRST_AT", 3, "startTime"]]],
                ["CONSTANT", 3, 3],
            ],
        ],
        [
            "RCRCRC",
            [
                [
                    "STOP_START",
                    0,
                    2,
                    [
                        ["FIRST_AT", 0, "endTime"],
                        ["SECOND_AT", 2, "startTime"],
                    ],
                ],
                [
                    "START_STOP",
                    2,
                    2,
                    [
                        ["FIRST_AT", 2, "startTime"],
                        ["SECOND_AT", 2, "endTime"],
                    ],
                ],
                [
                    "STOP_START",
                    2,
                    4,
                    [
                        ["FIRST_AT", 2, "endTime"],
                        ["SECOND_AT", 4, "startTime"],
                    ],
                ],
                [
                    "START_STOP",
                    4,
                    4,
                    [
                        ["FIRST_AT", 4, "startTime"],
                        ["SECOND_AT", 4, "endTime"],
                    ],
                ],
                ["STOP", 4, 4, [["FIRST_AT", 4, "endTime"]]],
                ["CLEAR", 5, 5],
            ],
        ],
        [
            "CRCRCR",
            [
                [
                    "START_STOP",
                    1,
                    1,
                    [
                        ["FIRST_AT", 1, "startTime"],
                        ["SECOND_AT", 1, "endTime"],
                    ],
                ],
                [
                    "STOP_START",
                    1,
                    3,
                    [
                        ["FIRST_AT", 1, "endTime"],
                        ["SECOND_AT", 3, "startTime"],
                    ],
                ],
                [
                    "START_STOP",
                    3,
                    3,
                    [
                        ["FIRST_AT", 3, "startTime"],
                        ["SECOND_AT", 3, "endTime"],
                    ],
                ],
                [
                    "STOP_START",
                    3,
                    5,
                    [
                        ["FIRST_AT", 3, "endTime"],
                        ["SECOND_AT", 5, "startTime"],
                    ],
                ],
                ["START", 5, 5, [["FIRST_AT", 5, "startTime"]]],
                ["CONSTANT", 5, 5],
            ],
        ],
    ];

    for (const [pattern, specs] of cases) {
        const summaries = makeSummaries(pattern);
        assert.deepEqual(ForecastNextHour.Condition(summaries), materializeConditions(summaries, specs), pattern);
    }
});

test("Condition supports one-to-ten alternating segments without dropping the product", () => {
    for (const first of ["C", "R"]) {
        for (let length = 1; length <= 10; length++) {
            const pattern = Array.from({ length }, (_, index) => (index % 2 === 0 ? first : first === "C" ? "R" : "C")).join("");
            const summaries = makeSummaries(pattern);
            const conditions = ForecastNextHour.Condition(summaries);

            assert.equal(conditions.length, summaries.length, pattern);
            assert.deepEqual(
                conditions.map(condition => condition.forecastToken),
                expectedTokens(pattern),
                pattern,
            );
            conditions.forEach((condition, index) => {
                assert.equal(condition.startTime, summaries[index].startTime, `${pattern}[${index}] startTime`);
                assert.equal(condition.endTime, summaries[index].endTime, `${pattern}[${index}] endTime`);
                assert.equal(condition.parameters.length, parameterCount(condition.forecastToken), `${pattern}[${index}] parameters`);
                if (condition.parameters.length === 2) {
                    assert.ok(condition.parameters[0].date < condition.parameters[1].date, `${pattern}[${index}] parameter order`);
                }
            });
        }
    }
});

test("Minute to Summary to Condition retains six intermittent rain segments", () => {
    const minutes = Array.from({ length: 71 }, (_, index) => {
        const raining = index < 10 || (index >= 20 && index < 30) || (index >= 40 && index < 50);
        return {
            precipitationChance: 100,
            precipitationIntensity: raining ? 1 : 0,
            startTime: BASE_TIME + index * 60,
        };
    });

    const normalized = ForecastNextHour.Minute(minutes, "未来两小时有间歇性小雨");
    const summaries = ForecastNextHour.Summary(normalized);
    const conditions = ForecastNextHour.Condition(summaries);

    assert.deepEqual(
        summaries.map(summary => summary.clear),
        [false, true, false, true, false, true],
    );
    assert.deepEqual(
        conditions.map(condition => condition.forecastToken),
        ["STOP_START", "START_STOP", "STOP_START", "START_STOP", "STOP", "CLEAR"],
    );
    assert.equal(conditions.length, summaries.length);
});

test("Condition preserves empty output for missing or unsupported non-alternating summaries", () => {
    assert.deepEqual(ForecastNextHour.Condition([]), []);
    assert.deepEqual(ForecastNextHour.Condition(makeSummaries("RRC")), []);
});

function makeSummaries(pattern) {
    return [...pattern].map((symbol, index) => ({
        clear: symbol === "C",
        endTime: index === pattern.length - 1 ? 0 : BASE_TIME + (index + 1) * INTERVAL,
        maxCondition: symbol === "C" ? "CLEAR" : RAIN_CONDITIONS[index % RAIN_CONDITIONS.length],
        startTime: BASE_TIME + index * INTERVAL,
    }));
}

function materializeConditions(summaries, specs) {
    return specs.map(([forecastToken, beginIndex, endIndex, parameters = []], index) => ({
        beginCondition: summaries[beginIndex].maxCondition,
        endCondition: summaries[endIndex].maxCondition,
        forecastToken,
        parameters: parameters.map(([type, summaryIndex, field]) => ({ date: summaries[summaryIndex][field], type })),
        startTime: summaries[index].startTime,
        endTime: summaries[index].endTime,
    }));
}

function expectedTokens(pattern) {
    return [...pattern].map((symbol, index) => {
        if (index === pattern.length - 1) return symbol === "C" ? "CLEAR" : "CONSTANT";
        if (symbol === "C") return index + 2 < pattern.length ? "START_STOP" : "START";
        return index + 2 < pattern.length ? "STOP_START" : "STOP";
    });
}

function parameterCount(token) {
    if (token === "START_STOP" || token === "STOP_START") return 2;
    if (token === "START" || token === "STOP") return 1;
    return 0;
}

test("Summary keeps the final minute switch as its own segment in v3", () => {
    const minutes = Array.from({ length: 60 }, (_, index) => {
        const raining = index < 14 || (index >= 39 && index < 59);
        return {
            summaryCondition: raining ? "RAIN" : "CLEAR",
            condition: raining ? "RAIN" : "CLEAR",
            clear: !raining,
            startTime: BASE_TIME + index * 60,
            precipitationChance: raining ? 100 : 0,
            precipitationIntensity: raining ? 1 : 0,
        };
    });

    const summaries = ForecastNextHour.Summary(minutes, "v3");
    assert.equal(summaries.length, 4);
    assert.deepEqual(
        summaries.map(summary => summary.clear),
        [false, true, false, true],
    );
    assert.equal("endTime" in summaries[3], false);

    const conditions = ForecastNextHour.Condition(summaries, "v3");
    assert.ok(conditions.length > 0);
    assert.equal(conditions.length, 4);
});

test("Summary ignores rain beyond the 60-minute window in v3", () => {
    const minutes = Array.from({ length: 85 }, (_, index) => {
        const raining = index >= 66 && index <= 68;
        return {
            summaryCondition: raining ? "RAIN" : "CLEAR",
            condition: raining ? "RAIN" : "CLEAR",
            clear: !raining,
            startTime: BASE_TIME + index * 60,
            precipitationChance: raining ? 100 : 0,
            precipitationIntensity: raining ? 1 : 0,
        };
    });

    const summaries = ForecastNextHour.Summary(minutes, "v3");
    assert.equal(summaries.length, 1);
    assert.deepEqual(
        summaries.map(summary => summary.clear),
        [true],
    );
});

test("ConvertPrecipitationIntensity follows the Weibull saturation curve for heavy rain", () => {
    assert.ok(ForecastNextHour.ConvertPrecipitationIntensity(10, "mmph") > 2.0);
    assert.ok(Math.abs(ForecastNextHour.ConvertPrecipitationIntensity(50, "mmph") - 2.881) < 0.005);
});

test("ConvertPrecipitationIntensity calibrates mmph to the Weibull saturation curve", () => {
    assert.equal(ForecastNextHour.ConvertPrecipitationIntensity(0, "mmph"), 0);
    assert.equal(ForecastNextHour.ConvertPrecipitationIntensity(0.03, "mmph"), 0);
    assert.ok(ForecastNextHour.ConvertPrecipitationIntensity(0.08, "mmph") >= 0.1);
    assert.ok(Math.abs(ForecastNextHour.ConvertPrecipitationIntensity(2.6655, "mmph") - 1.526) < 0.005);
    assert.ok(Math.abs(ForecastNextHour.ConvertPrecipitationIntensity(6.2356, "mmph") - 2.003) < 0.005);
    assert.ok(Math.abs(ForecastNextHour.ConvertPrecipitationIntensity(24.2901, "mmph") - 2.675) < 0.005);
    const extreme = ForecastNextHour.ConvertPrecipitationIntensity(100, "mmph");
    assert.ok(extreme < 3.0 && extreme > 2.95);
});

// 第 15 轮记录的真实 WK2 ConditionType 表（自真实 FlatBuffer schema 解码）：
// CLEAR 0 / SLEET 3 / POSSIBLE_SLEET 4 / HEAVY_RAIN 5 / RAIN 6 / DRIZZLE 7 /
// POSSIBLE_DRIZZLE 8 / HEAVY_SNOW 9 / SNOW 10；无 FLURRIES / HAIL 等项。
// 本地桩 @nsringo/weatherkit 的 WK2 表比真实包丰富（含 FLURRIES/HAIL），
// 故本地 Condition() 不会因过滤而清空；以下断言以真实表为准，
// 验证 Condition 输出的每一项 begin/endCondition 均可被真实 WK2 schema 编码。
const REAL_WK2_CONDITION_TYPES = new Set([
    "CLEAR",
    "SLEET",
    "POSSIBLE_SLEET",
    "HEAVY_RAIN",
    "RAIN",
    "DRIZZLE",
    "POSSIBLE_DRIZZLE",
    "HEAVY_SNOW",
    "SNOW",
]);

function lastMinuteSwitchMinutes(description, intensity) {
    const minutes = Array.from({ length: 85 }, (_, index) => {
        const raining = index < 43 || (index >= 59 && index < 65);
        return {
            precipitationChance: raining ? 100 : 0,
            precipitationIntensity: raining ? intensity : 0,
            startTime: BASE_TIME + index * 60,
        };
    });
    return ForecastNextHour.Minute(minutes, description, "mmph");
}

test("Condition keeps three segments when the last minute switches to light snow", () => {
    const minutes = lastMinuteSwitchMinutes("未来2小时有降雪", 0.2);
    const summaries = ForecastNextHour.Summary(minutes, "v3");
    assert.deepEqual(
        summaries.map(summary => summary.clear),
        [false, true, false],
    );
    const conditions = ForecastNextHour.Condition(summaries, "v3");
    assert.equal(conditions.length, 3);
    for (const condition of conditions) {
        assert.ok(REAL_WK2_CONDITION_TYPES.has(condition.beginCondition), `beginCondition ${condition.beginCondition} is not in the real WK2 table`);
        assert.ok(REAL_WK2_CONDITION_TYPES.has(condition.endCondition), `endCondition ${condition.endCondition} is not in the real WK2 table`);
    }
});

test("Condition keeps three segments when the last minute switches to hail", () => {
    const minutes = lastMinuteSwitchMinutes("未来2小时有冰雹", 1.0);
    const summaries = ForecastNextHour.Summary(minutes, "v3");
    assert.deepEqual(
        summaries.map(summary => summary.clear),
        [false, true, false],
    );
    const conditions = ForecastNextHour.Condition(summaries, "v3");
    assert.equal(conditions.length, 3);
    for (const condition of conditions) {
        assert.ok(REAL_WK2_CONDITION_TYPES.has(condition.beginCondition), `beginCondition ${condition.beginCondition} is not in the real WK2 table`);
        assert.ok(REAL_WK2_CONDITION_TYPES.has(condition.endCondition), `endCondition ${condition.endCondition} is not in the real WK2 table`);
    }
});

test("Condition keeps three segments when the last minute switches to rain", () => {
    const minutes = lastMinuteSwitchMinutes("未来2小时有降水", 1.0);
    const summaries = ForecastNextHour.Summary(minutes, "v3");
    assert.deepEqual(
        summaries.map(summary => summary.clear),
        [false, true, false],
    );
    const conditions = ForecastNextHour.Condition(summaries, "v3");
    assert.equal(conditions.length, 3);
    for (const condition of conditions) {
        assert.ok(REAL_WK2_CONDITION_TYPES.has(condition.beginCondition), `beginCondition ${condition.beginCondition} is not in the real WK2 table`);
        assert.ok(REAL_WK2_CONDITION_TYPES.has(condition.endCondition), `endCondition ${condition.endCondition} is not in the real WK2 table`);
    }
});
