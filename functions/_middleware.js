const ALLOWED_PATH_PREFIXES = ["/api/v1/", "/api/v2/", "/api/v3/", "/weatherkit.apple.com/api/"];
const APPLE_UA_PATTERN = /(Weather|weatherd|CFNetwork|Darwin)/i;
const ALERTS_WEBVIEW_UA_PATTERN = /AppleWebKit/i;
const ALERTS_ORIGIN = "https://weatherkit.apple.com";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathOk = ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  const ua = context.request.headers.get("user-agent") || "";
  const uaOk = APPLE_UA_PATTERN.test(ua);

  // 苹果天气预警详情页用内置 Safari WebView 打开 /api/v1/weatherAlerts：
  // 该请求不带天气 App 的 UA，改为校验 AppleWebKit + weatherkit.apple.com 来源头。
  const isAlertsPage = url.pathname === "/api/v1/weatherAlerts";
  const origin = context.request.headers.get("origin") || "";
  const referer = context.request.headers.get("referer") || "";
  const alertsOriginOk = (value) => value === ALERTS_ORIGIN || value.startsWith(`${ALERTS_ORIGIN}/`);
  const alertsWebViewOk = isAlertsPage && ALERTS_WEBVIEW_UA_PATTERN.test(ua) && (alertsOriginOk(origin) || alertsOriginOk(referer));

  if (!pathOk || (!uaOk && !alertsWebViewOk)) {
    return new Response("Forbidden", { status: 403 });
  }

  return context.next();
}
