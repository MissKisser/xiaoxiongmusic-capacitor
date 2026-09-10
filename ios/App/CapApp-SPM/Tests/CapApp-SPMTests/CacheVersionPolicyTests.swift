import XCTest
@testable import CapApp_SPM

/**
 * 版本化缓存清理决策纯逻辑单元测试
 * 覆盖首装、版本变化、版本一致与版本号获取失败守卫
 */
final class CacheVersionPolicyTests: XCTestCase {

    func testFirstInstallTreatedAsVersionChange() {
        let d = CacheVersionPolicy.evaluate(currentVersion: "1.2.3", previousVersion: "")
        XCTAssertTrue(d.shouldClearAndPersist)
    }

    func testVersionUpgradeClearsAndPersists() {
        let d = CacheVersionPolicy.evaluate(currentVersion: "1.3.0", previousVersion: "1.2.3")
        XCTAssertTrue(d.shouldClearAndPersist)
    }

    func testVersionDowngradeAlsoClears() {
        let d = CacheVersionPolicy.evaluate(currentVersion: "1.0.0", previousVersion: "2.0.0")
        XCTAssertTrue(d.shouldClearAndPersist)
    }

    func testSameVersionSkipsClear() {
        let d = CacheVersionPolicy.evaluate(currentVersion: "1.2.3", previousVersion: "1.2.3")
        XCTAssertFalse(d.shouldClearAndPersist)
    }

    func testEmptyCurrentVersionNeverClears() {
        let d = CacheVersionPolicy.evaluate(currentVersion: "", previousVersion: "1.2.3")
        XCTAssertFalse(d.shouldClearAndPersist)
    }

    func testBothEmptySkipsClear() {
        let d = CacheVersionPolicy.evaluate(currentVersion: "", previousVersion: "")
        XCTAssertFalse(d.shouldClearAndPersist)
    }
}
