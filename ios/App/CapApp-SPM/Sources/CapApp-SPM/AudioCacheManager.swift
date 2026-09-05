import Foundation
import CryptoKit

/**
 * 音频缓存管理器
 * 负责音频缓存磁盘目录管理、MD5键映射、大小统计、LRU淘汰及两档缓存策略
 */
public final class AudioCacheManager: NSObject {

    public static let shared = AudioCacheManager()

    private let userDefaults = UserDefaults.standard
    private let queue = DispatchQueue(label: "com.xiaoxiong.music.audiocache", qos: .utility)

    private let enabledKey = "audio_cache_config.enabled"
    private let maxSizeKey = "audio_cache_config.maxSize"
    private let strategyKey = "audio_cache_config.strategy"

    public private(set) var enabled: Bool {
        didSet { userDefaults.set(enabled, forKey: enabledKey) }
    }

    public private(set) var maxSizeMB: Double {
        didSet { userDefaults.set(maxSizeMB, forKey: maxSizeKey) }
    }

    public private(set) var strategy: String {
        didSet { userDefaults.set(strategy, forKey: strategyKey) }
    }

    public var maxCacheSizeBytes: Int64 {
        return Int64(maxSizeMB * 1024.0 * 1024.0)
    }

    public var cacheDirectory: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("audio_cache")
        if !FileManager.default.fileExists(atPath: dir.path) {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
        return dir
    }

    private override init() {
        if userDefaults.object(forKey: enabledKey) != nil {
            self.enabled = userDefaults.bool(forKey: enabledKey)
        } else {
            self.enabled = true
        }

        let savedMaxSize = userDefaults.double(forKey: maxSizeKey)
        self.maxSizeMB = savedMaxSize > 0 ? savedMaxSize : 500.0

        let savedStrategy = userDefaults.string(forKey: strategyKey)
        self.strategy = (savedStrategy == "all" || savedStrategy == "complete") ? savedStrategy! : "complete"

        super.init()
    }

    /**
     * 计算字符串的 MD5 哈希
     *
     * - Parameter string: 待哈希字符串
     * - Returns: 32 位小写 MD5 十六进制字符串
     */
    public func md5Hash(_ string: String) -> String {
        let digest = Insecure.MD5.hash(data: Data(string.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /**
     * 获取缓存文件 URL
     *
     * - Parameter key: 缓存键或原始地址
     * - Returns: 若文件存在且有效（大小 >= 1KB）则返回路径，否则返回 nil
     */
    public func getCachedFileURL(for key: String) -> URL? {
        guard enabled else { return nil }
        let hash = md5Hash(key)
        let fileUrl = cacheDirectory.appendingPathComponent("\(hash).cache")
        let path = fileUrl.path

        guard FileManager.default.isReadableFile(atPath: path) else { return nil }

        if let attrs = try? FileManager.default.attributesOfItem(atPath: path),
           let size = attrs[.size] as? Int64, size >= 1024 {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: path)
            return fileUrl
        }

        return nil
    }

    /**
     * 创建临时下载文件
     *
     * - Parameter key: 缓存键
     * - Returns: 临时文件路径及句柄
     */
    public func createTempFile(for key: String) -> (url: URL, handle: FileHandle)? {
        let hash = md5Hash(key)
        let tempName = "\(hash)_\(UUID().uuidString).tmp"
        let tempUrl = cacheDirectory.appendingPathComponent(tempName)

        FileManager.default.createFile(atPath: tempUrl.path, contents: nil)
        guard let handle = try? FileHandle(forWritingTo: tempUrl) else {
            return nil
        }
        return (tempUrl, handle)
    }

    /**
     * 将临时文件原子重命名为正式缓存文件
     *
     * - Parameters:
     *   - tempUrl: 临时文件路径
     *   - key: 缓存键
     */
    public func commitTempFile(tempUrl: URL, for key: String) {
        let hash = md5Hash(key)
        let targetUrl = cacheDirectory.appendingPathComponent("\(hash).cache")

        queue.async { [weak self] in
            guard let self = self else { return }
            do {
                if FileManager.default.fileExists(atPath: targetUrl.path) {
                    try FileManager.default.removeItem(at: targetUrl)
                }
                try FileManager.default.moveItem(at: tempUrl, to: targetUrl)
                try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: targetUrl.path)
                self.trimCacheIfNeeded()
            } catch {
                NSLog("[AudioCacheManager] 提交缓存失败: \(error)")
                try? FileManager.default.removeItem(at: tempUrl)
            }
        }
    }

    /**
     * 放弃并删除临时文件
     *
     * - Parameter tempUrl: 临时文件路径
     */
    public func discardTempFile(tempUrl: URL) {
        queue.async {
            try? FileManager.default.removeItem(at: tempUrl)
        }
    }

    /**
     * 统计当前缓存大小与文件数量
     *
     * - Returns: 大小（MB，保留 2 位小数）与有效缓存文件数（排除 .tmp）
     */
    public func getCacheSize() -> (sizeMB: Double, count: Int) {
        let fileManager = FileManager.default
        guard let files = try? fileManager.contentsOfDirectory(at: cacheDirectory, includingPropertiesForKeys: [.fileSizeKey]) else {
            return (0.0, 0)
        }

        var totalBytes: Int64 = 0
        var cacheCount = 0

        for file in files {
            if file.pathExtension == "cache" {
                cacheCount += 1
                if let resourceValues = try? file.resourceValues(forKeys: [.fileSizeKey]),
                   let size = resourceValues.fileSize {
                    totalBytes += Int64(size)
                }
            }
        }

        let mb = Double(totalBytes) / (1024.0 * 1024.0)
        let roundedMB = (mb * 100.0).rounded() / 100.0
        return (roundedMB, cacheCount)
    }

    /**
     * 清理超出最大限制的旧缓存文件（LRU 策略）
     */
    public func trimCacheIfNeeded() {
        queue.async { [weak self] in
            guard let self = self else { return }
            let fileManager = FileManager.default
            guard let files = try? fileManager.contentsOfDirectory(
                at: self.cacheDirectory,
                includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey]
            ) else { return }

            var cacheFiles: [(url: URL, size: Int64, date: Date)] = []
            var totalBytes: Int64 = 0

            for file in files where file.pathExtension == "cache" {
                if let values = try? file.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey]),
                   let size = values.fileSize,
                   let date = values.contentModificationDate {
                    let fileSize = Int64(size)
                    cacheFiles.append((file, fileSize, date))
                    totalBytes += fileSize
                }
            }

            guard totalBytes > self.maxCacheSizeBytes else { return }

            cacheFiles.sort { $0.date < $1.date }

            for item in cacheFiles {
                if totalBytes <= self.maxCacheSizeBytes { break }
                try? fileManager.removeItem(at: item.url)
                totalBytes -= item.size
            }
        }
    }

    /**
     * 清理 mtime 超过 5 分钟的过期临时文件
     */
    public func cleanupOldTempFiles() {
        queue.async { [weak self] in
            guard let self = self else { return }
            let fileManager = FileManager.default
            guard let files = try? fileManager.contentsOfDirectory(
                at: self.cacheDirectory,
                includingPropertiesForKeys: [.contentModificationDateKey]
            ) else { return }

            let fiveMinutesAgo = Date().addingTimeInterval(-300)

            for file in files where file.pathExtension == "tmp" {
                if let values = try? file.resourceValues(forKeys: [.contentModificationDateKey]),
                   let date = values.contentModificationDate,
                   date < fiveMinutesAgo {
                    try? fileManager.removeItem(at: file)
                }
            }
        }
    }

    /**
     * 清空全部缓存与临时文件
     */
    public func clearCache() {
        queue.sync { [weak self] in
            guard let self = self else { return }
            let fileManager = FileManager.default
            if let files = try? fileManager.contentsOfDirectory(at: self.cacheDirectory, includingPropertiesForKeys: nil) {
                for file in files {
                    try? fileManager.removeItem(at: file)
                }
            }
        }
    }

    /**
     * 更新缓存配置
     *
     * - Parameters:
     *   - enabled: 是否启用缓存
     *   - maxSizeMB: 最大缓存配额（单位：MB）
     *   - strategy: 缓存策略（"all" 或 "complete"）
     */
    public func setConfig(enabled: Bool, maxSizeMB: Double, strategy: String) {
        self.enabled = enabled
        self.maxSizeMB = maxSizeMB > 0 ? maxSizeMB : 500.0
        self.strategy = (strategy == "all" || strategy == "complete") ? strategy : "complete"

        if self.enabled {
            trimCacheIfNeeded()
        }
    }
}
