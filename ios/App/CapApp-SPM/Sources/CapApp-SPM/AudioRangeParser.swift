import Foundation

/**
 * Range 请求头解析结果
 */
struct AudioRangeResolution {
    /// 响应起始字节偏移
    let startOffset: Int64
    /// 响应结束字节偏移（含）
    let endOffset: Int64
    /// 是否为 Range 请求（决定 206/200 与 Content-Range 头）
    let isRangeRequest: Bool
    /// 起始偏移越界（≥ 资源总大小），应回 416
    let isUnsatisfiable: Bool
}

/**
 * Range 请求头解析纯逻辑
 * 供缓存命中路径与单元测试共用，保证与响应构造行为一致
 */
enum AudioRangeParser {

    /**
     * 解析 Range 请求头
     *
     * - Parameters:
     *   - rangeHeader: 原始 Range 请求头（可空）
     *   - totalSize: 资源总字节数
     * - Returns: 起止偏移与响应判定；无 Range 头或非 bytes= 前缀时按完整 200 响应处理
     */
    static func resolve(rangeHeader: String?, totalSize: Int64) -> AudioRangeResolution {
        var startOffset: Int64 = 0
        var endOffset: Int64 = totalSize - 1
        var isRangeRequest = false

        if let rangeHeader = rangeHeader, rangeHeader.hasPrefix("bytes=") {
            isRangeRequest = true
            let rangeSpec = String(rangeHeader.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            let parts = rangeSpec.components(separatedBy: "-")
            if let first = parts.first, let start = Int64(first) {
                startOffset = max(0, start)
            }
            if parts.count > 1, let second = parts.last, !second.isEmpty, let end = Int64(second) {
                endOffset = min(totalSize - 1, end)
            }
        }

        let isUnsatisfiable = isRangeRequest && startOffset >= totalSize
        return AudioRangeResolution(
            startOffset: startOffset,
            endOffset: endOffset,
            isRangeRequest: isRangeRequest,
            isUnsatisfiable: isUnsatisfiable
        )
    }
}
