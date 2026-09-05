import Foundation

/**
 * 音频代理运行时环境
 * 提供音频缓存及代理 Scheme 的全局访问单例与状态检索
 */
public final class AudioProxyRuntime {

    public static let shared = AudioProxyRuntime()

    public var cacheManager: AudioCacheManager {
        return AudioCacheManager.shared
    }

    private init() {}
}
