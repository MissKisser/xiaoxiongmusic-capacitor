import Foundation
import Capacitor

/**
 * 音乐通知原生插件
 * 实现媒体会话、锁屏控制器与睡眠定时器的 Capacitor 桥接
 */
@objc(MusicNotification)
public class MediaNotificationPlugin: CAPPlugin, CAPBridgedPlugin {

    public let identifier = "MusicNotification"
    public let jsName = "MusicNotification"

    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateMetadata", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updatePlaybackState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updatePosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "destroy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSleepTimer", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearSleepTimer", returnType: CAPPluginReturnPromise)
    ]

    private let runtime = MediaNotificationRuntime.shared

    override public func load() {
        runtime.eventHandler = { [weak self] eventName, data in
            self?.notifyListeners(eventName, data: data)
        }
    }

    /**
     * 初始化媒体会话
     */
    @objc func initialize(_ call: CAPPluginCall) {
        runtime.initialize()
        call.resolve()
    }

    /**
     * 更新元数据（标题、艺术家、专辑、封面、时长）
     */
    @objc func updateMetadata(_ call: CAPPluginCall) {
        guard let title = call.getString("title"),
              let artist = call.getString("artist") else {
            call.reject("缺少必填参数: title 或 artist")
            return
        }

        let album = call.getString("album")
        let coverUrl = call.getString("coverUrl")
        let duration = call.getDouble("duration")

        runtime.updateMetadata(
            title: title,
            artist: artist,
            album: album,
            coverUrl: coverUrl,
            duration: duration
        )
        call.resolve()
    }

    /**
     * 更新播放状态
     */
    @objc func updatePlaybackState(_ call: CAPPluginCall) {
        guard let isPlaying = call.getBool("isPlaying") else {
            call.reject("缺少必填参数: isPlaying")
            return
        }

        runtime.updatePlaybackState(isPlaying: isPlaying)
        call.resolve()
    }

    /**
     * 更新当前播放进度
     */
    @objc func updatePosition(_ call: CAPPluginCall) {
        guard let position = call.getDouble("position") else {
            call.reject("缺少必填参数: position")
            return
        }

        let duration = call.getDouble("duration") ?? 0
        runtime.updatePosition(position: position, duration: duration)
        call.resolve()
    }

    /**
     * 销毁媒体会话
     */
    @objc func destroy(_ call: CAPPluginCall) {
        runtime.destroy()
        call.resolve()
    }

    /**
     * 设置睡眠定时器
     */
    @objc func setSleepTimer(_ call: CAPPluginCall) {
        guard let timeMs = call.getDouble("timeMs") else {
            call.reject("缺少必填参数: timeMs")
            return
        }

        let waitSongEnd = call.getBool("waitSongEnd") ?? false
        runtime.setSleepTimer(timeMs: timeMs, waitSongEnd: waitSongEnd)
        call.resolve()
    }

    /**
     * 清除睡眠定时器
     */
    @objc func clearSleepTimer(_ call: CAPPluginCall) {
        runtime.clearSleepTimer()
        call.resolve()
    }
}
