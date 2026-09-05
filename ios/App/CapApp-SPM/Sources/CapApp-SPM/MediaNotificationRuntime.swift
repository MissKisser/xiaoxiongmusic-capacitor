import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/**
 * 媒体会话与通知运行时
 * 负责音频会话激活、锁屏 NowPlaying 信息维护、系统远程控制命令监听及睡眠定时器调度
 */
public final class MediaNotificationRuntime: NSObject {

    public static let shared = MediaNotificationRuntime()

    public var eventHandler: ((String, [String: Any]) -> Void)?

    private var currentNowPlayingInfo: [String: Any] = [:]
    private var coverSeq: Int = 0
    private var sleepTimer: DispatchSourceTimer?
    private var isPlaying: Bool = false
    private var lastPosition: Double = 0
    private var lastDuration: Double = 0
    private var isSessionActive: Bool = false
    private var playTarget: Any?
    private var pauseTarget: Any?
    private var togglePlayPauseTarget: Any?
    private var nextTarget: Any?
    private var prevTarget: Any?
    private var seekTarget: Any?

    private override init() {
        super.init()
        setupInterruptionListener()
    }

    /**
     * 初始化音频会话与系统远程命令
     */
    public func initialize() {
        configureAudioSession()
        setupInterruptionListener()
        setupRemoteCommands()
    }

    /**
     * 激活系统音频会话
     */
    private func configureAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            isSessionActive = true
        } catch {
            NSLog("[MediaNotificationRuntime] 激活音频会话失败: \(error)")
        }
    }

    /**
     * 监听系统音频中断事件
     */
    private func setupInterruptionListener() {
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleAudioInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance()
        )
    }

    /**
     * 处理音频中断
     *
     * - Parameter notification: 中断通知对象
     */
    @objc private func handleAudioInterruption(_ notification: Notification) {
        guard isSessionActive else { return }
        guard let userInfo = notification.userInfo,
              let typeValue = userInfo[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeValue) else {
            return
        }

        switch type {
        case .began:
            eventHandler?("pause", [:])
        case .ended:
            if let optionsValue = userInfo[AVAudioSessionInterruptionOptionKey] as? UInt {
                let options = AVAudioSession.InterruptionOptions(rawValue: optionsValue)
                if options.contains(.shouldResume) {
                    eventHandler?("play", [:])
                }
            }
        @unknown default:
            break
        }
    }

    /**
     * 注册锁屏控制中心远程命令
     */
    private func setupRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        removeRemoteCommands()

        commandCenter.playCommand.isEnabled = true
        playTarget = commandCenter.playCommand.addTarget { [weak self] _ in
            self?.eventHandler?("play", [:])
            return .success
        }

        commandCenter.pauseCommand.isEnabled = true
        pauseTarget = commandCenter.pauseCommand.addTarget { [weak self] _ in
            self?.eventHandler?("pause", [:])
            return .success
        }

        commandCenter.togglePlayPauseCommand.isEnabled = true
        togglePlayPauseTarget = commandCenter.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            let nextEvent = self.isPlaying ? "pause" : "play"
            self.eventHandler?(nextEvent, [:])
            return .success
        }

        commandCenter.nextTrackCommand.isEnabled = true
        nextTarget = commandCenter.nextTrackCommand.addTarget { [weak self] _ in
            self?.eventHandler?("next", [:])
            return .success
        }

        commandCenter.previousTrackCommand.isEnabled = true
        prevTarget = commandCenter.previousTrackCommand.addTarget { [weak self] _ in
            self?.eventHandler?("previous", [:])
            return .success
        }

        commandCenter.changePlaybackPositionCommand.isEnabled = true
        seekTarget = commandCenter.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let positionEvent = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let positionMs = positionEvent.positionTime * 1000.0
            self?.eventHandler?("seek", ["position": positionMs])
            return .success
        }
    }

    /**
     * 移除远程命令监听
     */
    private func removeRemoteCommands() {
        let commandCenter = MPRemoteCommandCenter.shared()

        if let target = playTarget {
            commandCenter.playCommand.removeTarget(target)
            playTarget = nil
        }
        if let target = pauseTarget {
            commandCenter.pauseCommand.removeTarget(target)
            pauseTarget = nil
        }
        if let target = togglePlayPauseTarget {
            commandCenter.togglePlayPauseCommand.removeTarget(target)
            togglePlayPauseTarget = nil
        }
        if let target = nextTarget {
            commandCenter.nextTrackCommand.removeTarget(target)
            nextTarget = nil
        }
        if let target = prevTarget {
            commandCenter.previousTrackCommand.removeTarget(target)
            prevTarget = nil
        }
        if let target = seekTarget {
            commandCenter.changePlaybackPositionCommand.removeTarget(target)
            seekTarget = nil
        }

        commandCenter.playCommand.isEnabled = false
        commandCenter.pauseCommand.isEnabled = false
        commandCenter.togglePlayPauseCommand.isEnabled = false
        commandCenter.nextTrackCommand.isEnabled = false
        commandCenter.previousTrackCommand.isEnabled = false
        commandCenter.changePlaybackPositionCommand.isEnabled = false
    }

    /**
     * 更新锁屏歌曲元数据
     *
     * - Parameters:
     *   - title: 歌曲标题
     *   - artist: 艺术家
     *   - album: 专辑名
     *   - coverUrl: 封面图片网络地址
     *   - duration: 音频总时长（单位：秒）
     */
    public func updateMetadata(title: String, artist: String, album: String?, coverUrl: String?, duration: Double?) {
        currentNowPlayingInfo[MPMediaItemPropertyTitle] = title
        currentNowPlayingInfo[MPMediaItemPropertyArtist] = artist

        if let album = album, !album.isEmpty {
            currentNowPlayingInfo[MPMediaItemPropertyAlbumTitle] = album
        } else {
            currentNowPlayingInfo.removeValue(forKey: MPMediaItemPropertyAlbumTitle)
        }

        if let duration = duration, duration > 0 {
            lastDuration = duration
            currentNowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = duration
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = currentNowPlayingInfo

        loadCoverArtwork(from: coverUrl)
    }

    /**
     * 异步下载并装配锁屏封面
     *
     * - Parameter coverUrl: 封面图片地址
     */
    private func loadCoverArtwork(from coverUrl: String?) {
        coverSeq += 1
        let expectedSeq = coverSeq

        guard let coverUrl = coverUrl, !coverUrl.isEmpty else {
            currentNowPlayingInfo.removeValue(forKey: MPMediaItemPropertyArtwork)
            MPNowPlayingInfoCenter.default().nowPlayingInfo = currentNowPlayingInfo
            return
        }

        if coverUrl.hasPrefix("blob:") || coverUrl.hasPrefix("file:") ||
           coverUrl.hasPrefix("content:") || coverUrl.contains("?asset") {
            return
        }

        guard let url = URL(string: coverUrl) else { return }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15.0
        request.setValue(
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            forHTTPHeaderField: "User-Agent"
        )
        if let scheme = url.scheme, let host = url.host {
            request.setValue("\(scheme)://\(host)/", forHTTPHeaderField: "Referer")
        }
        request.setValue("image/avif,image/webp,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 15.0
        configuration.timeoutIntervalForResource = 15.0
        let session = URLSession(configuration: configuration)

        session.dataTask(with: request) { [weak self] data, _, error in
            guard let self = self, error == nil, let data = data,
                  let image = UIImage(data: data) else {
                return
            }

            DispatchQueue.main.async {
                guard expectedSeq == self.coverSeq else { return }
                let artwork = MPMediaItemArtwork(boundsSize: CGSize(width: 400, height: 400)) { _ in
                    return image
                }
                self.currentNowPlayingInfo[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = self.currentNowPlayingInfo
            }
        }.resume()
    }

    /**
     * 更新播放状态
     *
     * - Parameter isPlaying: 是否正在播放
     */
    public func updatePlaybackState(isPlaying: Bool) {
        self.isPlaying = isPlaying
        currentNowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        currentNowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = lastPosition
        if lastDuration > 0 {
            currentNowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = lastDuration
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = currentNowPlayingInfo
    }

    /**
     * 更新播放进度与时长
     *
     * - Parameters:
     *   - position: 当前播放进度（单位：秒）
     *   - duration: 音频总时长（单位：秒）
     */
    public func updatePosition(position: Double, duration: Double) {
        lastPosition = position
        if duration > 0 {
            lastDuration = duration
            currentNowPlayingInfo[MPMediaItemPropertyPlaybackDuration] = duration
        }
        currentNowPlayingInfo[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        currentNowPlayingInfo[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = currentNowPlayingInfo
    }

    /**
     * 设置睡眠定时器
     *
     * - Parameters:
     *   - timeMs: 定时毫秒数
     *   - waitSongEnd: 到点后是否等待曲终再暂停
     */
    public func setSleepTimer(timeMs: Double, waitSongEnd: Bool) {
        clearSleepTimer()

        guard timeMs > 0 else { return }

        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.main)
        let deadline = DispatchTime.now() + .milliseconds(Int(timeMs))
        timer.schedule(deadline: deadline)

        timer.setEventHandler { [weak self] in
            guard let self = self else { return }
            self.clearSleepTimer()
            self.eventHandler?("sleepTimerFinished", [:])
            if !waitSongEnd {
                self.eventHandler?("pause", [:])
            }
        }

        sleepTimer = timer
        timer.resume()
    }

    /**
     * 清除睡眠定时器
     */
    public func clearSleepTimer() {
        if let timer = sleepTimer {
            timer.cancel()
            sleepTimer = nil
        }
    }

    /**
     * 销毁媒体会话及相关资源
     */
    public func destroy() {
        isSessionActive = false
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        clearSleepTimer()
        removeRemoteCommands()
        currentNowPlayingInfo.removeAll()
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
        destroy()
    }
}
