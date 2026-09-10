import Foundation

/**
 * 代理请求合法性校验纯逻辑
 * 供 scheme 拦截入口与单元测试共用，保证路径与协议白名单判定一致
 */
enum ProxyRequestValidator {

    /**
     * 校验自定义 scheme 请求路径是否为音频代理端点
     *
     * - Parameters:
     *   - host: URLComponents 解析出的 host（可空）
     *   - path: URL path
     * - Returns: host 与 path 拼接为 proxy/audio，或 path 直接为 /proxy/audio 时通过
     */
    static func isProxyAudioPath(host: String?, path: String) -> Bool {
        let fullPath = "\(host ?? "")\(path)"
        return fullPath == "proxy/audio" || path == "/proxy/audio"
    }

    /**
     * 校验上游目标协议是否在代理白名单内
     *
     * - Parameter scheme: 上游 URL scheme（可空，判定不区分大小写）
     * - Returns: 仅 http/https 放行，其余协议（file/ftp/自定义协议等）拒绝
     */
    static func isAllowedUpstreamScheme(_ scheme: String?) -> Bool {
        guard let lowered = scheme?.lowercased() else { return false }
        return lowered == "http" || lowered == "https"
    }
}
