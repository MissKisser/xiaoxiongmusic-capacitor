import Foundation

/**
 * 设备侧诊断日志
 *
 * 将关键运行时事件写入沙盒 Documents/diag.log，供无 Mac 调试通道（文件管理器导出）排查真机问题。
 * 写入经串行队列串行化，超过上限自动截断，日志自身失败静默不影响业务。
 */
public enum DiagLog {
    private static let queue = DispatchQueue(label: "com.xiaoxiong.music.diag")
    private static let maxSize: UInt64 = 512 * 1024

    private static var fileURL: URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return docs.appendingPathComponent("diag.log")
    }

    /**
     * 追加一行诊断日志
     *
     * - Parameter tag: 模块标签（如 SESSION / PROXY / MEDIA / JS）
     * - Parameter line: 日志内容（不含时间戳）
     */
    public static func write(_ tag: String, _ line: String) {
        queue.async {
            let formatter = DateFormatter()
            formatter.dateFormat = "HH:mm:ss.SSS"
            let text = "[\(formatter.string(from: Date()))] [\(tag)] \(line)\n"
            let url = fileURL
            let fm = FileManager.default
            do {
                if !fm.fileExists(atPath: url.path) {
                    fm.createFile(atPath: url.path, contents: nil)
                }
                let handle = try FileHandle(forWritingTo: url)
                defer { try? handle.close() }
                let attrs = try fm.attributesOfItem(atPath: url.path)
                let size = (attrs[.size] as? NSNumber)?.uint64Value ?? 0
                if size > maxSize {
                    try? handle.truncate(atOffset: 0)
                }
                _ = try? handle.seekToEnd()
                try? handle.write(contentsOf: text.data(using: .utf8)!)
            } catch {
                // 诊断日志自身失败静默
            }
        }
    }
}
