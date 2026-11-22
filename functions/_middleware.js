const ALLOWED_PATH_PREFIXES = ["/api/v1/", "/api/v2/", "/weatherkit.apple.com/api/"];
const APPLE_UA_PATTERN = /(Weather|weatherd|CFNetwork|Darwin)/i;

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const pathOk = ALLOWED_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  const ua = context.request.headers.get("user-agent") || "";
  const uaOk = APPLE_UA_PATTERN.test(ua);

  if (!pathOk || !uaOk) {
    return new Response("Forbidden", { status: 403 });
  }

  return context.next();
}
