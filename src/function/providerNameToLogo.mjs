/**
 * 不再下发任何第三方图标：无论传入任何数据源名与版本，一律返回空。
 * No third-party logos are served: always returns empty, for any provider and version.
 * 原厂已有 providerLogo 的由调用处透传保留，响应组装末端的兜底清理会删掉透传的第三方图标链接。
 * @param {string | null | undefined} providerName - 数据源名称（已不再用于查表）。
 * Provider name (no longer used for lookup).
 * @param {string} [version="v2"] - 标志资源版本（已不再使用）。
 * Logo asset version (no longer used).
 * @returns {undefined} 恒为空。
 * Always undefined.
 */
export default function providerNameToLogo(providerName, version = "v2") {
    return undefined;
}
