import Foundation
import Capacitor

/**
 * 音频缓存原生插件
 * 实现音频缓存配额、策略、大小统计与清理的 Capacitor 桥接
 */
@objc(AudioCache)
public class AudioCachePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "AudioCachePlugin"
    public let jsName = "AudioCache"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getCacheSize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearCache", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCacheConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getCacheStatus", returnType: CAPPluginReturnPromise)
    ]

    private var cacheManager: AudioCacheManager {
        return AudioCacheManager.shared
    }

    /**
     * 获取当前缓存大小与文件数量
     */
    @objc func getCacheSize(_ call: CAPPluginCall) {
        let (sizeMB, count) = cacheManager.getCacheSize()
        call.resolve([
            "size": sizeMB,
            "count": count
        ])
    }

    /**
     * 清空全部音频缓存
     */
    @objc func clearCache(_ call: CAPPluginCall) {
        cacheManager.clearCache()
        call.resolve([
            "success": true
        ])
    }

    /**
     * 设置音频缓存配置（开关、最大限制、淘汰策略）
     */
    @objc func setCacheConfig(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? true
        let maxSize = call.getDouble("maxSize") ?? 500.0
        let strategy = call.getString("strategy") ?? "complete"

        cacheManager.setConfig(enabled: enabled, maxSizeMB: maxSize, strategy: strategy)
        call.resolve([
            "success": true
        ])
    }

    /**
     * 获取当前缓存配置与占用状态
     */
    @objc func getCacheStatus(_ call: CAPPluginCall) {
        let (sizeMB, _) = cacheManager.getCacheSize()
        call.resolve([
            "enabled": cacheManager.enabled,
            "maxSize": cacheManager.maxSizeMB,
            "currentSize": sizeMB,
            "strategy": cacheManager.strategy
        ])
    }
}
