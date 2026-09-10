import XCTest
@testable import CapApp_SPM

/**
 * 代理请求合法性校验纯逻辑单元测试
 * 覆盖代理端点路径白名单（404 判定）与上游协议白名单（403 判定）
 */
final class ProxyRequestValidatorTests: XCTestCase {

    // MARK: - 代理端点路径

    func testHostPlusPathFormPasses() {
        XCTAssertTrue(ProxyRequestValidator.isProxyAudioPath(host: "proxy", path: "/audio"))
    }

    func testPathOnlyFormPasses() {
        XCTAssertTrue(ProxyRequestValidator.isProxyAudioPath(host: nil, path: "/proxy/audio"))
        XCTAssertTrue(ProxyRequestValidator.isProxyAudioPath(host: "", path: "/proxy/audio"))
    }

    func testWrongPathRejected() {
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: "proxy", path: "/video"))
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: "other", path: "/audio"))
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: nil, path: "/"))
    }

    func testTrailingSlashRejected() {
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: "proxy", path: "/audio/"))
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: nil, path: "/proxy/audio/"))
    }

    func testPrefixedPathRejected() {
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: nil, path: "/x/proxy/audio"))
        XCTAssertFalse(ProxyRequestValidator.isProxyAudioPath(host: "proxy", path: "/audiox"))
    }

    // MARK: - 上游协议白名单

    func testHttpAndHttpsAllowedCaseInsensitive() {
        XCTAssertTrue(ProxyRequestValidator.isAllowedUpstreamScheme("http"))
        XCTAssertTrue(ProxyRequestValidator.isAllowedUpstreamScheme("https"))
        XCTAssertTrue(ProxyRequestValidator.isAllowedUpstreamScheme("HTTPS"))
        XCTAssertTrue(ProxyRequestValidator.isAllowedUpstreamScheme("Http"))
    }

    func testLocalProtocolsRejected() {
        XCTAssertFalse(ProxyRequestValidator.isAllowedUpstreamScheme("file"))
        XCTAssertFalse(ProxyRequestValidator.isAllowedUpstreamScheme("ftp"))
        XCTAssertFalse(ProxyRequestValidator.isAllowedUpstreamScheme("capacitor"))
        XCTAssertFalse(ProxyRequestValidator.isAllowedUpstreamScheme("javascript"))
    }

    func testNilSchemeRejected() {
        XCTAssertFalse(ProxyRequestValidator.isAllowedUpstreamScheme(nil))
        XCTAssertFalse(ProxyRequestValidator.isAllowedUpstreamScheme(""))
    }
}
