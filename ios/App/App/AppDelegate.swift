import UIKit
import WebKit
import Capacitor
import CapApp_SPM
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AudioCacheManager.shared.cleanupOldTempFiles()
        return true
    }
    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

/**
 * 应用主视图控制器，继承 CAPBridgeViewController 并接管配置与插件注册
 *
 * App target 自定义插件须经 CAPBridgeViewController 子类调用 bridge?.registerPluginInstance(...) 注册
 * 在 capacitorDidLoad() 阶段注册以确保在 loadWebView() 之前完成，消除 WKUserScript 注入竞态
 */
class MainViewController: CAPBridgeViewController {

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let config = super.webViewConfiguration(for: instanceConfiguration)
        config.setURLSchemeHandler(AudioProxySchemeHandler(), forURLScheme: "capacitor-audio")
        return config
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MediaNotificationPlugin())
        bridge?.registerPluginInstance(AudioCachePlugin())
        bridge?.registerPluginInstance(WebViewCachePlugin())
    }
}
