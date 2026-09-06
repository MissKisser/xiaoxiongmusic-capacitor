import XCTest
@testable import CapApp_SPM

/**
 * 音频缓存管理器单元测试
 * 覆盖 MD5 稳定性、临时文件生命周期、缓存有效性判定、大小统计、LRU 淘汰与临时文件清理
 *
 * 说明：AudioCacheManager 为读取 UserDefaults.standard 的单例，测试通过 setConfig 修改配置后
 * 在 tearDown 统一恢复默认（enabled=true / 500MB / complete），对冲配置污染
 */
final class AudioCacheManagerTests: XCTestCase {

    private let manager = AudioCacheManager.shared

    override func setUp() {
        super.setUp()
        manager.clearCache()
    }

    override func tearDown() {
        manager.clearCache()
        manager.setConfig(enabled: true, maxSizeMB: 500, strategy: "complete")
        super.tearDown()
    }

    /// 轮询等待异步队列完成（commit/trim/cleanup 均为后台串行队列执行）
    private func waitUntil(
        timeout: TimeInterval = 5,
        _ condition: @escaping () -> Bool
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return }
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
    }

    private func makeCacheFile(named name: String, size: Int, modifiedAgo: TimeInterval = 0) -> URL {
        let url = manager.cacheDirectory.appendingPathComponent(name)
        let data = Data(repeating: 0x61, count: size)
        try? data.write(to: url)
        if modifiedAgo > 0 {
            try? FileManager.default.setAttributes(
                [.modificationDate: Date().addingTimeInterval(-modifiedAgo)],
                ofItemAtPath: url.path
            )
        }
        return url
    }

    func testMD5HashKnownVectors() {
        XCTAssertEqual(manager.md5Hash(""), "d41d8cd98f00b204e9800998ecf8427e")
        XCTAssertEqual(manager.md5Hash("abc"), "900150983cd24fb0d6963f7d28e17f72")
        XCTAssertEqual(manager.md5Hash("https://example.com/a.mp3").count, 32)
    }

    func testTempFileCreateCommitLifecycle() {
        guard let temp = manager.createTempFile(for: "lifecycle-key") else {
            return XCTFail("创建临时文件失败")
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: temp.url.path))
        temp.handle.write(Data(repeating: 0x62, count: 2048))
        try? temp.handle.close()

        manager.commitTempFile(tempUrl: temp.url, for: "lifecycle-key")
        waitUntil { AudioCacheManager.shared.getCachedFileURL(for: "lifecycle-key") != nil }
        XCTAssertNotNil(manager.getCachedFileURL(for: "lifecycle-key"))
    }

    func testDiscardTempFileRemovesFile() {
        guard let temp = manager.createTempFile(for: "discard-key") else {
            return XCTFail("创建临时文件失败")
        }
        temp.handle.write(Data(repeating: 0x63, count: 1024))
        try? temp.handle.close()

        manager.discardTempFile(tempUrl: temp.url)
        waitUntil { !FileManager.default.fileExists(atPath: temp.url.path) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: temp.url.path))
    }

    func testGetCachedFileURLRejectsTinyFiles() {
        let key = "tiny"
        let cacheUrl = manager.cacheDirectory.appendingPathComponent("\(manager.md5Hash(key)).cache")
        try? Data(repeating: 0x61, count: 100).write(to: cacheUrl)
        XCTAssertNil(manager.getCachedFileURL(for: key))
    }

    func testGetCachedFileURLRefreshesModificationDate() {
        let key = "stale"
        let cacheUrl = manager.cacheDirectory.appendingPathComponent("\(manager.md5Hash(key)).cache")
        try? Data(repeating: 0x61, count: 2048).write(to: cacheUrl)
        try? FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(-3600)],
            ofItemAtPath: cacheUrl.path
        )

        XCTAssertNotNil(manager.getCachedFileURL(for: key))
        let attrs = try? FileManager.default.attributesOfItem(atPath: cacheUrl.path)
        let mtime = attrs?[.modificationDate] as? Date
        XCTAssertNotNil(mtime)
        XCTAssertGreaterThan(mtime?.timeIntervalSinceNow ?? -3600, -10)
    }

    func testGetCacheSizeExcludesTmpAndRoundsToTwoDecimals() {
        makeCacheFile(named: "a.cache", size: 1_572_864)
        makeCacheFile(named: "b_XXXX.cache.tmp", size: 4096)
        let (sizeMB, count) = manager.getCacheSize()
        XCTAssertEqual(count, 1)
        XCTAssertEqual(sizeMB, 1.5)

        // 舍入行为：统计值经两位小数舍入，不足 0.01MB 的占用归零
        manager.clearCache()
        makeCacheFile(named: "c.cache", size: 1536)
        let (smallMB, smallCount) = manager.getCacheSize()
        XCTAssertEqual(smallCount, 1)
        XCTAssertEqual(smallMB, 0.0)
    }

    func testTrimCacheEvictsOldestByLRU() {
        manager.setConfig(enabled: true, maxSizeMB: 1, strategy: "complete")
        makeCacheFile(named: "old.cache", size: 700 * 1024, modifiedAgo: 300)
        makeCacheFile(named: "mid.cache", size: 700 * 1024, modifiedAgo: 200)
        makeCacheFile(named: "new.cache", size: 700 * 1024, modifiedAgo: 100)

        manager.setConfig(enabled: true, maxSizeMB: 1, strategy: "complete")
        waitUntil(timeout: 10) { AudioCacheManager.shared.getCacheSize().sizeMB <= 1.0 }

        let dir = manager.cacheDirectory
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("old.cache").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("new.cache").path))
    }

    func testCleanupOldTempFilesRemovesOnlyStale() {
        makeCacheFile(named: "stale_1.tmp", size: 512, modifiedAgo: 360)
        makeCacheFile(named: "fresh_1.tmp", size: 512)

        manager.cleanupOldTempFiles()
        waitUntil { !FileManager.default.fileExists(atPath: AudioCacheManager.shared.cacheDirectory.appendingPathComponent("stale_1.tmp").path) }

        let dir = manager.cacheDirectory
        XCTAssertFalse(FileManager.default.fileExists(atPath: dir.appendingPathComponent("stale_1.tmp").path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("fresh_1.tmp").path))
    }

    func testSetConfigValidationAndDefaults() {
        manager.setConfig(enabled: false, maxSizeMB: 0, strategy: "bogus")
        XCTAssertFalse(manager.enabled)
        XCTAssertEqual(manager.maxSizeMB, 500)
        XCTAssertEqual(manager.strategy, "complete")

        manager.setConfig(enabled: true, maxSizeMB: 250, strategy: "all")
        XCTAssertEqual(manager.maxSizeMB, 250)
        XCTAssertEqual(manager.strategy, "all")
    }
}
