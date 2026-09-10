import Foundation

/**
 * 缓存版本决策结果
 */
struct CacheVersionDecision {
    /// 是否执行缓存清理（同一时机持久化新版本号）
    let shouldClearAndPersist: Bool
}

/**
 * 版本化缓存清理决策纯逻辑
 * 供 WebViewCache 插件与单元测试共用，语义对齐 Android 版本清理行为
 */
enum CacheVersionPolicy {

    /**
     * 依据当前版本与上次记录版本判定是否触发清理
     *
     * - Parameters:
     *   - currentVersion: 当前应用版本（获取失败为空串）
     *   - previousVersion: 上次记录版本（首次安装为空串）
     * - Returns: 版本不同且当前版本非空时清理并持久化；首次安装视为版本变化
     */
    static func evaluate(currentVersion: String, previousVersion: String) -> CacheVersionDecision {
        let shouldClear = !currentVersion.isEmpty && currentVersion != previousVersion
        return CacheVersionDecision(shouldClearAndPersist: shouldClear)
    }
}
