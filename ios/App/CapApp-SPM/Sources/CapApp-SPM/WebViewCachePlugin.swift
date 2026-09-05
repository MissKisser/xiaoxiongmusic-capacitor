import Foundation
import WebKit
import Capacitor

/**
 * 网页视图缓存清理原生插件
 * 提供版本化缓存清理、WebsiteDataStore 剔除（保留 LocalStorage/IndexedDB/Cookie 登录态）以及 Caches 目录维护
 */
@objc(WebViewCache)
public class WebViewCachePlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "WebViewCachePlugin"
    public let jsName = "WebViewCache"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "clearCache", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearHistory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkVersionAndClear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveCurrentVersion", returnType: CAPPluginReturnPromise)
    ]

    private let versionKey = "webview_cache_prefs.last_version"

    private var currentAppVersion: String {
        return Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    /**
     * 清理 WKWebsiteDataStore 缓存（保留本地数据库、LocalStorage 及 Cookies）
     *
     * - Parameter completion: 完成回调
     */
    private func performClearCache(completion: @escaping () -> Void) {
        DispatchQueue.main.async {
            var dataTypes = WKWebsiteDataStore.allWebsiteDataTypes()
            dataTypes.remove(WKWebsiteDataTypeLocalStorage)
            dataTypes.remove(WKWebsiteDataTypeSessionStorage)
            dataTypes.remove(WKWebsiteDataTypeIndexedDBDatabases)
            dataTypes.remove(WKWebsiteDataTypeCookies)

            WKWebsiteDataStore.default().removeData(ofTypes: dataTypes, modifiedSince: .distantPast) {
                completion()
            }
        }
    }

    /**
     * 清理应用 Caches 目录（跳过 audio_cache 音频缓存目录）
     */
    private func performClearAppCaches() {
        guard let cachesURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
            return
        }

        let fileManager = FileManager.default
        guard let items = try? fileManager.contentsOfDirectory(at: cachesURL, includingPropertiesForKeys: nil) else {
            return
        }

        for item in items {
            if item.lastPathComponent != "audio_cache" {
                try? fileManager.removeItem(at: item)
            }
        }
    }

    /**
     * 清理网页缓存
     */
    @objc func clearCache(_ call: CAPPluginCall) {
        performClearCache {
            call.resolve([
                "success": true
            ])
        }
    }

    /**
     * 清理浏览历史（iOS 无独立历史 API，对齐协议返回成功）
     */
    @objc func clearHistory(_ call: CAPPluginCall) {
        call.resolve([
            "success": true
        ])
    }

    /**
     * 清理全部缓存（网页缓存 + 应用 Caches 目录，跳过 audio_cache）
     */
    @objc func clearAll(_ call: CAPPluginCall) {
        performClearCache { [weak self] in
            self?.performClearAppCaches()
            call.resolve([
                "success": true
            ])
        }
    }

    /**
     * 检查应用版本并执行按需缓存清理
     */
    @objc func checkVersionAndClear(_ call: CAPPluginCall) {
        let currentVersion = currentAppVersion
        let previousVersion = UserDefaults.standard.string(forKey: versionKey) ?? ""

        if currentVersion.isEmpty {
            call.resolve([
                "cleared": false,
                "previousVersion": previousVersion,
                "currentVersion": ""
            ])
            return
        }

        if previousVersion != currentVersion {
            performClearCache { [weak self] in
                guard let self = self else { return }
                self.performClearAppCaches()
                UserDefaults.standard.set(currentVersion, forKey: self.versionKey)
                call.resolve([
                    "cleared": true,
                    "previousVersion": previousVersion,
                    "currentVersion": currentVersion
                ])
            }
            return
        }

        call.resolve([
            "cleared": false,
            "previousVersion": previousVersion,
            "currentVersion": currentVersion
        ])
    }

    /**
     * 保存当前版本号至持久化配置
     */
    @objc func saveCurrentVersion(_ call: CAPPluginCall) {
        let currentVersion = currentAppVersion
        UserDefaults.standard.set(currentVersion, forKey: versionKey)
        call.resolve([
            "success": true,
            "version": currentVersion
        ])
    }
}
