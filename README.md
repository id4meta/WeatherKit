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
- 港澳地区走彩云 AQI（CN、HK、MO），台湾地区保留 Apple 原厂数据；远洋坐标请求不传递 country 参数。
- 数值字段以 `scaleFinite` 守卫，避免 NaN 写入响应。

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

### 7. 性能与边缘缓存

- 四合一预取：大陆完整请求（`forecastHourly` / `forecastDaily`）在请求阶段先发一次彩云 `/weather` 四合一接口，一次拉取实况、逐分钟、逐小时、逐日四路数据并回填内存与边缘缓存，下游不再重复请求；`begin` 由 `dailyStart` 或 `relativeDailyStart`（东八区当日 00:00 偏移）推导。半热命中时仅刷新未命中的路；港澳 airQuality 请求仅预热 realtime；台湾与国外请求零预热。
- 流式 Gzip：响应体 ≥ 2048 字节且客户端支持 gzip 时压缩；204、304、HEAD 不压缩。
- `replaceWeather` 脏检查改为元数据快速短路；非中国大陆请求不做数据集清扫（`sweepDataSets`）。
- 彩云上游分层短缓存（`caches.default`）：realtime、minutely 120 秒；hourly 600 秒（昨日历史查询 1800 秒）；daily 1200 秒；读写均校验 status 为 ok。缓存写入经 Workers `waitUntil` 非阻塞，或无 `waitUntil` 时 await 写入。
- 和风预警详情页 180 秒边缘缓存：仅 HTTP 200 且预警非空时写入，空结果绝不入缓存。
- 上游超时保护：彩云与和风请求均设 4000 ms 超时，超时走既有 fail-closed 降级。
- 错误脱敏：服务端 500 响应统一为 `Internal Server Error`，详细异常仅记入日志。

### 8. 预警详情页（`src/class/WeatherAlerts.mjs`）

- messages 合并为至多 1 个元素：正文、标准段、指南段以双换行 `\n\n` 分隔；指南段内部以单换行 `\n` 连接，不加标签、不加序号。
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
- 现状（2026-11-26）：208 项，162 通过、46 失败、0 跳过。46 项失败全部为缺真实协议编解码包所致（`@nsringo/weatherkit` 编解码包不在公开 npm registry），与业务代码无关；失败名录自建立基线以来无新增。
- `npm run build` 依赖 rollup，本地未安装时退出码 127，非代码错误。

## 已知限制

- 中间件仅校验 User-Agent，可伪造；端点地址不公开是最重要的防线，请勿转发。
- `attributionURL` 不可删除，否则 Apple 预警详情页黑屏；如需隐藏链接，使用空字符串。
- Cloudflare 免费档每次调用 CPU 上限 10 ms，偶发超限表现为 503。
- Workers / Pages Functions 免费档每天 10 万次请求为全账号共享，UTC 午夜重置。
