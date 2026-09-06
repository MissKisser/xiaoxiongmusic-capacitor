import XCTest
import MediaPlayer
@testable import CapApp_SPM

/**
 * 媒体通知运行时单元测试
 * 覆盖 NowPlaying 信息合并语义、睡眠定时器事件与销毁幂等
 */
final class MediaNotificationRuntimeTests: XCTestCase {

    private let runtime = MediaNotificationRuntime.shared

    override func tearDown() {
        runtime.clearSleepTimer()
        runtime.destroy()
        super.tearDown()
    }

    private var nowPlayingInfo: [String: Any]? {
        MPNowPlayingInfoCenter.default().nowPlayingInfo
    }

    func testUpdateMetadataPopulatesNowPlaying() {
        runtime.updateMetadata(title: "测试歌曲", artist: "测试歌手", album: "测试专辑", coverUrl: nil, duration: 180)

        XCTAssertEqual(nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "测试歌曲")
        XCTAssertEqual(nowPlayingInfo?[MPMediaItemPropertyArtist] as? String, "测试歌手")
        XCTAssertEqual(nowPlayingInfo?[MPMediaItemPropertyAlbumTitle] as? String, "测试专辑")
        XCTAssertEqual(nowPlayingInfo?[MPMediaItemPropertyPlaybackDuration] as? Double, 180)
    }

    func testFieldUpdatesPreserveOtherFields() {
        runtime.updateMetadata(title: "测试歌曲", artist: "测试歌手", album: nil, coverUrl: nil, duration: 180)
        runtime.updatePlaybackState(isPlaying: true)

        XCTAssertEqual(nowPlayingInfo?[MPMediaItemPropertyTitle] as? String, "测试歌曲")
        XCTAssertEqual(nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.0)

        runtime.updatePosition(position: 42, duration: 180)
        XCTAssertEqual(nowPlayingInfo?[MPMediaItemPropertyArtist] as? String, "测试歌手")
        XCTAssertEqual(nowPlayingInfo?[MPNowPlayingInfoPropertyElapsedPlaybackTime] as? Double, 42)
        XCTAssertEqual(nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 1.0)
    }

    func testEmptyAlbumRemovesAlbumField() {
        runtime.updateMetadata(title: "T", artist: "A", album: "专辑", coverUrl: nil, duration: 60)
        runtime.updateMetadata(title: "T", artist: "A", album: "", coverUrl: nil, duration: 60)

        XCTAssertNil(nowPlayingInfo?[MPMediaItemPropertyAlbumTitle])
    }

    func testPauseSetsZeroRate() {
        runtime.updateMetadata(title: "T", artist: "A", album: nil, coverUrl: nil, duration: 60)
        runtime.updatePlaybackState(isPlaying: false)

        XCTAssertEqual(nowPlayingInfo?[MPNowPlayingInfoPropertyPlaybackRate] as? Double, 0.0)
    }

    func testSleepTimerWithoutWaitSongEndFiresPause() {
        let received = expectation(description: "sleepTimerFinished + pause 事件")
        var events: [String] = []
        let lock = NSLock()
        runtime.eventHandler = { name, _ in
            lock.lock()
            events.append(name)
            let done = events.contains("sleepTimerFinished") && events.contains("pause")
            lock.unlock()
            if done { received.fulfill() }
        }

        runtime.setSleepTimer(timeMs: 500, waitSongEnd: false)
        wait(for: [received], timeout: 5)

        lock.lock()
        let orderOK = events.first == "sleepTimerFinished" && events.count >= 2
        lock.unlock()
        XCTAssertTrue(orderOK)
    }

    func testSleepTimerWithWaitSongEndSkipsPause() {
        var events: [String] = []
        let lock = NSLock()
        let fired = expectation(description: "sleepTimerFinished 事件")
        runtime.eventHandler = { name, _ in
            lock.lock()
            events.append(name)
            if name == "sleepTimerFinished" { fired.fulfill() }
            lock.unlock()
        }

        runtime.setSleepTimer(timeMs: 500, waitSongEnd: true)
        wait(for: [fired], timeout: 5)

        // 到点后额外等待，确认未跟随 pause 事件
        RunLoop.current.run(until: Date().addingTimeInterval(1.5))
        lock.lock()
        let hasPause = events.contains("pause")
        lock.unlock()
        XCTAssertFalse(hasPause)
    }

    func testDestroyIsIdempotent() {
        runtime.updateMetadata(title: "T", artist: "A", album: nil, coverUrl: nil, duration: 60)
        runtime.destroy()
        runtime.destroy()

        XCTAssertNil(MPNowPlayingInfoCenter.default().nowPlayingInfo)
    }
}
