import XCTest
@testable import CapApp_SPM

/**
 * Range 请求头解析纯逻辑单元测试
 * 覆盖 200 完整响应、206 分片、开区间、越界 416 与异常输入
 */
final class AudioRangeParserTests: XCTestCase {

    func testNoHeaderReturnsFullResponse() {
        let r = AudioRangeParser.resolve(rangeHeader: nil, totalSize: 1000)
        XCTAssertFalse(r.isRangeRequest)
        XCTAssertFalse(r.isUnsatisfiable)
        XCTAssertEqual(r.startOffset, 0)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testNonBytesHeaderReturnsFullResponse() {
        let r = AudioRangeParser.resolve(rangeHeader: "items=0-99", totalSize: 1000)
        XCTAssertFalse(r.isRangeRequest)
        XCTAssertEqual(r.startOffset, 0)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testOpenStartProbeReturnsTwoByteRange() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=0-1", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertFalse(r.isUnsatisfiable)
        XCTAssertEqual(r.startOffset, 0)
        XCTAssertEqual(r.endOffset, 1)
    }

    func testOpenEndSuffixReturnsTailFromZero() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=0-", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertEqual(r.startOffset, 0)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testOpenEndFromOffset() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=500-", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertEqual(r.startOffset, 500)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testClosedRange() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=500-999", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertEqual(r.startOffset, 500)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testClosedRangeEndClampedToTotal() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=500-99999", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertEqual(r.startOffset, 500)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testStartBeyondTotalIsUnsatisfiable() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=1000-", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertTrue(r.isUnsatisfiable)
    }

    func testClosedRangeBeyondTotalIsUnsatisfiable() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=2000-3000", totalSize: 1000)
        XCTAssertTrue(r.isUnsatisfiable)
    }

    func testNegativeStartClampedToZero() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=-100", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertEqual(r.startOffset, 0)
        XCTAssertEqual(r.endOffset, 100)
    }

    func testNonNumericStartKeepsZeroStart() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=abc-", totalSize: 1000)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertFalse(r.isUnsatisfiable)
        XCTAssertEqual(r.startOffset, 0)
        XCTAssertEqual(r.endOffset, 999)
    }

    func testEmptyResourceRangeRequestIsUnsatisfiable() {
        let r = AudioRangeParser.resolve(rangeHeader: "bytes=0-", totalSize: 0)
        XCTAssertTrue(r.isRangeRequest)
        XCTAssertTrue(r.isUnsatisfiable)
    }
}
