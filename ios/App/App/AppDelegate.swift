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
        injectSimLoginCookie()
    }

    /**
     * 模拟器测试注入：从启动环境变量 SIM_LOGIN_COOKIE 读取网易云 Cookie 串（形如 "MUSIC_U=xxx; __csrf=yyy"），
     * 以 WKUserScript 在 documentStart 写入 document.cookie 与 localStorage 影子库（cookie-<key>），
     * 使 App 自身的 syncNativeCookies 链路将其同步到原生层，达成测试态登录。
     * 仅 DEBUG 构建生效，正式产物不受影响。
     */
    private func injectSimLoginCookie() {
        #if DEBUG
        let env = ProcessInfo.processInfo.environment
        let raw = env["SIM_LOGIN_COOKIE"] ?? ""
        let route = env["SIM_ROUTE"] ?? ""
        guard !raw.isEmpty || !route.isEmpty else { return }
        let escaped = raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "'", with: "\\'")
            .replacingOccurrences(of: "\n", with: "")
        let source = """
        (function(){
          var raw = '\(escaped)';
          function apply(){
            try {
              raw.split(';').forEach(function(p){
                var i = p.indexOf('=');
                if (i < 1) return;
                var k = p.slice(0, i).trim(), v = p.slice(i + 1).trim();
                if (!k) return;
                document.cookie = k + '=' + v + '; path=/';
                localStorage.setItem('cookie-' + k, v);
              });
              return true;
            } catch (e) { return false; }
          }
          if (!apply()) {
            document.addEventListener('DOMContentLoaded', function(){ apply(); });
            window.addEventListener('load', function(){ apply(); });
          }
          var route = '__SIM_ROUTE__';
          if (route) {
            window.addEventListener('load', function(){ location.hash = route; });
          }
        })();
        """
        let finalSource = source.replacingOccurrences(of: "__SIM_ROUTE__", with: route.replacingOccurrences(of: "'", with: ""))
        let script = WKUserScript(source: finalSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(script)
        #endif
    }
}
