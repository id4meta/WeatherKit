# iRingo WeatherKit

本仓库是 [NSRingo/WeatherKit](https://github.com/NSRingo/WeatherKit) 的 Fork，部署于 Cloudflare Pages，作为 Apple 天气 App 的私有 WeatherKit 端点。基于上游 v4.0.0-beta4，支持 WK3 `/api/v3`。

数据来源：实况、逐分钟、逐小时、逐日数据来自彩云天气 v2.6 接口；预警数据来自和风天气；其余数据集保留 Apple 上游原始数据。

部署方式：GitHub Actions（`.github/workflows/deploy-pages.yml`，手动触发）经 Wrangler 直推 Cloudflare Pages。端点地址不公开。

## 本 Fork 的改动

### 1. 访问控制（`functions/_middleware.js`）

- 仅放行 `/api/v1`、`/api/v2`、`/api/v3` 与 `/weatherkit.apple.com/api/` 前缀，且 User-Agent 须匹配 Apple 天气客户端特征；其余请求返回 403。
- `/api/v1/weatherAlerts` 详情页路径另行放行：AppleWebKit UA，且 Origin 或 Referer 以 `https://weatherkit.apple.com` 开头。
- 说明：中间件仅校验 User-Agent，User-Agent 可以伪造；端点地址不公开是最重要的防线。

### 2. 空气质量（`src/function/database.mjs`、`src/class/AirQuality.mjs`）

- AQI 算法由 EU_EAQI 改为 WAQI_InstantCast_CN；指数源改为 ColorfulCloudsCN；污染物单位统一为 HJ6332012 并强制 µg/m³。
- 仅中国大陆走彩云 AQI（CN）；港澳台与国外坐标全量直通 Apple 原厂数据，不再走彩云 AQI；远洋坐标请求不传递 country 参数。
- 数值字段以 `scaleFinite` 守卫，避免 NaN 写入响应。
- 异常隔离：v3 二进制分支注入 `airQuality` 失败时捕获异常并保留 Apple 原厂数据，不击穿整城请求；彩云返回残缺 `air_quality`（缺失或 usa 描述为空）或昨日 `aqi` 为空时，`CurrentAirQuality` / `YesterdayAirQuality` 返回 `temporarilyUnavailable` 兜底对象，不抛错。

### 3. 第三方标识清理（`src/process/Response.mjs` 等）

- `providerNameToLogo` 全部返回 undefined；新增递归清理器 `sanitizeResponseObject`，对响应元数据与数据集做统一清理。
- 彩云归属链接改为 Apple 官方地址。界面不再出现第三方图标与归属链接。

### 4. 逐分钟降水（`src/class/ForecastNextHour.mjs`、`src/class/ColorfulClouds.mjs`）

- 有效期动态分档：有雨或预告有雨 300 秒，全无雨 3600 秒，以 forecastEnd 封顶。
- 降水概率自适应归一化：同一接口同时存在 0–1 与 0–100 两种口径，按实际值判定，不直接乘 100；缺失值返回 undefined，不回填 0。
- 雨强换算为 Weibull 曲线：`perceived = 3 × (1 − exp(−0.17117 × I^0.74272))`，钳制 [0.1, 3]；强度低于 0.08 mm/h 视为无雨。
- 实况与逐分钟正向同步：以 perceived ≥ 0.1 判定是否正在降雨；强度取两者较大值。
- 逐分钟数据仅对中国大陆开放。

### 5. WK3 二进制编码适配（`src/process/Response.mjs` 及相关类）

- conditionCode 向量化、precipitationAmount 形态适配、风向与降水概率整数化（`#RoundUInt`、`#NormalizeProbability`）。
- 编码失败时 fail-closed：失败的数据集保留 Apple 原厂数据，不输出损坏的二进制。
- 条件类型缺失时固定映射兜底（`WK2_CONDITION_FALLBACK`），如 FLURRIES→SNOW、HAIL→SLEET。

### 6. 港澳台与海外坐标处理（`src/process/Response.mjs`、`src/process/Request.mjs`）

- `resolveCountryForResponse`：按收紧矩形判定港澳台；显式 country=CN 但坐标落在港澳台时改写为 HK/MO/TW；远洋坐标删除 country 参数。
- 国家解析在请求阶段完成，早于数据拉取与预热。
- 仅 country=CN 的请求进入彩云注入与重编码；港澳台与国外请求在 `/api/v3/weather/`（二进制与 JSON）及 `/api/v2/weather/` 分支中直接跳过解码、全部注入、元数据清理与重编码，零拷贝原样透传 Apple 原厂响应。

### 7. 性能与边缘缓存

- 四合一预取：仅中国大陆请求触发；大陆完整请求（`forecastHourly` / `forecastDaily`）在请求阶段先发一次彩云 `/weather` 四合一接口，一次拉取实况、逐分钟、逐小时、逐日四路数据并回填内存与边缘缓存，下游不再重复请求；`begin` 由 `dailyStart` 或 `relativeDailyStart`（东八区当日 00:00 偏移）推导。半热命中时仅刷新未命中的路；港澳台与国外请求零预热。`prefetchWeather` 入口同步挂载并发槽，冷请求下 6 项并发调用只发 1 次 `/weather`；昨日 AQI 按 24 小时前整点取值。
- 流式 Gzip：响应体 ≥ 2048 字节且客户端支持 gzip 时压缩；204、304、HEAD 不压缩。
- `replaceWeather` 脏检查改为元数据快速短路；非中国大陆请求跳过全部注入与数据集清扫。
- 彩云上游分层缓存（L1 进程内内存 + L2 `caches.default` 边缘）：读取顺序 L1 → L2 → 上游；L1 为有界 Map（上限 64 条，超限淘汰最早插入项，命中做轻量 LRU），读写 key 与 L2 一致；L2 写入附带 `X-Cached-At` 响应头用于计算缓存年龄，L2 命中回填 L1 时沿用该真实时间戳，不重置年龄。realtime、minutely 硬过期 120 秒，不做 SWR；hourly 软过期 600 秒、硬过期 1800 秒（昨日历史查询软硬均为 1800 秒）；daily 软过期 1200 秒、硬过期 3600 秒。软过期区间内立即返回旧值，并经 Workers `waitUntil` 后台静默刷新（同 key 去重）；超硬过期回源。读写均校验 status 为 ok；缓存写入经 `waitUntil` 非阻塞，或无 `waitUntil` 时 await 写入。坐标精度统一为 2 位小数。
- 静态配置记忆化与单请求上下文：无 `$argument` 覆盖且无持久存储覆盖时，`setENV` 模块级缓存默认 Settings/Configs，每次返回浅拷贝外壳与全新的 `Caches: {}`；缓存命中判断在 `getStorage` 之前，前置快速路径直接返回，不再重复解析 `database`。字符串形式 `$argument`（生产环境为整条查询串）仅将大写字母开头的键视为插件覆盖，与 `buildArgument` 的 `/^[A-Z]/` 口径一致，小写原生查询参数不影响命中。`Request` 把解析结果挂载为 `$request._wkContext`（含 env、parameters 与改写后最终 country），`Hono.js` 与 `Response` 优先复用，缺失时降级现算。`/api/v1/airQualityScale/` 的静态构建响应按语言与量表名缓存，上限 32 条，超限淘汰最早插入项；`buildArgument` 仅在存在大写字母开头的查询参数键时才重写请求 URL。
- 懒加载：`MatchEnum` 仅在日志级别为 DEBUG 或 ALL 时实例化；`enviroments` 的 `qWeather` 与 `waqi` 改为按需构造的 getter；`Date.parse()` 替代 `new Date(...).getTime()`。
- 和风预警详情页 180 秒边缘缓存：仅 HTTP 200 且预警非空时写入，空结果绝不入缓存；`Response` 把 `$request._waitUntil` 透传给 `QWeather`，活跃预警页的缓存写入经 `waitUntil` 非阻塞完成。
- 上游超时保护：彩云与和风请求均设 4000 ms 超时，超时走既有 fail-closed 降级。
- 错误脱敏：服务端 500 响应统一为 `Internal Server Error`，详细异常仅记入日志。

### 8. 预警详情页（`src/class/WeatherAlerts.mjs`）

- messages 合并为至多 1 个元素：正文、标准段、指南段以双换行 `\n\n` 分隔；指南段内部以单换行 `\n` 连接，不加标签、不加序号。
- 无活跃预警时跳过和风网页抓取：`InjectWeatherAlerts` 入口遇空 `alerts` 直接返回，不再请求预警详情页。
- `attributionURL` 保留：Apple 前端将其视为必填字符串，缺键导致详情页黑屏；实测空字符串 `""` 可安全隐藏「查看警报源」链接且不黑屏。
- responses 由指南与响应字段推断；source、areaName、severity 等字段不变。

## 已解决的问题

| 现象 | 原因 | 修复 |
|---|---|---|
| `/api/v3` 请求返回 500 | `MatchEnum` 构造函数引用未声明的 `$request` | 修复引用 |
| `/api/v3` 请求返回 500 | `AirQuality.getScale` 读取不存在的 `scales.CN_AQHI` | 全部 case 加可选链 |
| 逐分钟降水卡片消失 | `ExpirationInterval` 固定 10 分钟，超过客户端相关性窗口 | 改为 300/3600 秒动态分档并以 forecastEnd 封顶 |
| 逐小时、逐日、实况编码失败（Invalid WK3 vector / ushort / float） | 上游包字段形态与 WK3 要求不一致（标量、浮点、条件码缺项） | 向量化、整数化、固定映射兜底；失败数据集 fail-closed，保留原厂数据 |
| 预警详情页黑屏 | `attributionURL` 被删除，Apple 前端视其为必填 | 恢复该字段；空字符串可安全隐藏链接 |
| 预警详情页三段显示为一段 | Apple 前端折叠单换行，仅双换行分段 | 段间改用 `\n\n` |
| AQI 数值与彩云 App 不符 | 算法、指数源与单位口径不一致 | 统一为 WAQI_InstantCast_CN、ColorfulCloudsCN、HJ6332012 |
| 界面出现第三方图标与归属链接 | 响应元数据携带上游提供方信息 | 递归清理器统一清理 |
| 港澳台坐标被判为大陆 | 国家判定矩形过宽 | 收紧矩形并在请求阶段改写 country |
| 免费档 CPU 超限导致 503 | 每次请求全量编码与重复拉取 | 脏检查短路、并发预热、Gzip 压缩 |

## 测试

- 运行：`node --test tests/*.test.mjs`
- 现状（2026-11-27）：239 项，193 通过、46 失败、0 跳过。46 项失败全部为缺真实协议编解码包所致（`@nsringo/weatherkit` 编解码包不在公开 npm registry），与业务代码无关；失败名录自建立基线以来无新增。
- `npm run build` 依赖 rollup，本地未安装时退出码 127，非代码错误。

## 已知限制

- 中间件仅校验 User-Agent，可伪造；端点地址不公开是最重要的防线，请勿转发。
- `attributionURL` 不可删除，否则 Apple 预警详情页黑屏；如需隐藏链接，使用空字符串。
- Cloudflare 免费档每次调用 CPU 上限 10 ms，偶发超限表现为 503。
- Workers / Pages Functions 免费档每天 10 万次请求为全账号共享，UTC 午夜重置。
