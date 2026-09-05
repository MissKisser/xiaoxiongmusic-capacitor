import Foundation
import WebKit

/**
 * 自定义音频 Scheme 拦截处理器
 * 拦截 capacitor-audio:// 协议，支持 Range 请求、本地磁盘缓存、CORS 透传与边播边存
 */
public final class AudioProxySchemeHandler: NSObject, WKURLSchemeHandler {

    private let cacheManager = AudioCacheManager.shared
    private let activeTasksLock = NSLock()
    private var activeTasks = Set<ObjectIdentifier>()
    private var taskContexts: [ObjectIdentifier: SchemeTaskContext] = [:]

    private lazy var urlSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30.0
        configuration.timeoutIntervalForResource = 300.0
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private let corsHeaders: [String: String] = [
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, X-Cache"
    ]

    /**
     * 开始加载自定义 Scheme 请求
     *
     * - Parameters:
     *   - webView: 当前 WKWebView
     *   - urlSchemeTask: Scheme 任务对象
     */
    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let taskId = ObjectIdentifier(urlSchemeTask)
        activeTasksLock.lock()
        activeTasks.insert(taskId)
        activeTasksLock.unlock()

        guard let requestUrl = urlSchemeTask.request.url else {
            failTask(urlSchemeTask, statusCode: 400)
            return
        }

        guard let components = URLComponents(url: requestUrl, resolvingAgainstBaseURL: false) else {
            failTask(urlSchemeTask, statusCode: 400)
            return
        }

        let fullPath = "\(components.host ?? "")\(components.path)"
        guard fullPath == "proxy/audio" || components.path == "/proxy/audio" else {
            failTask(urlSchemeTask, statusCode: 404)
            return
        }

        if urlSchemeTask.request.httpMethod?.uppercased() == "OPTIONS" {
            handleOptions(urlSchemeTask)
            return
        }

        guard let queryItems = components.queryItems,
              let targetUrlStr = queryItems.first(where: { $0.name == "url" })?.value,
              let targetUrl = URL(string: targetUrlStr) else {
            failTask(urlSchemeTask, statusCode: 400)
            return
        }
        guard let scheme = targetUrl.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            failTask(urlSchemeTask, statusCode: 403)
            return
        }

        let keyParam = queryItems.first(where: { $0.name == "key" })?.value
        let cacheKey = (keyParam != nil && !keyParam!.isEmpty) ? keyParam! : targetUrlStr

        if let cachedFile = cacheManager.getCachedFileURL(for: cacheKey) {
            handleCacheHit(urlSchemeTask, fileUrl: cachedFile)
            return
        }

        handleCacheMiss(urlSchemeTask, targetUrl: targetUrl, cacheKey: cacheKey)
    }

    /**
     * 取消或终止自定义 Scheme 任务
     *
     * - Parameters:
     *   - webView: 当前 WKWebView
     *   - urlSchemeTask: 被终止的 Scheme 任务对象
     */
    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let taskId = ObjectIdentifier(urlSchemeTask)
        activeTasksLock.lock()
        activeTasks.remove(taskId)
        let context = taskContexts.removeValue(forKey: taskId)
        activeTasksLock.unlock()

        guard let context = context else { return }

        if cacheManager.strategy == "all" {
            // "all" 策略下客户端断开后后台继续下载至完成，不断开 dataTask
        } else {
            context.dataTask?.cancel()
            if let tempUrl = context.tempUrl {
                context.tempHandle?.closeFile()
                cacheManager.discardTempFile(tempUrl: tempUrl)
            }
        }
    }

    private func isTaskActive(_ task: WKURLSchemeTask) -> Bool {
        activeTasksLock.lock()
        defer { activeTasksLock.unlock() }
        return activeTasks.contains(ObjectIdentifier(task))
    }

    private func handleOptions(_ task: WKURLSchemeTask) {
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: corsHeaders) else {
            return
        }
        if isTaskActive(task) {
            task.didReceive(response)
            task.didFinish()
        }
        activeTasksLock.lock()
        activeTasks.remove(ObjectIdentifier(task))
        activeTasksLock.unlock()
    }

    private func failTask(_ task: WKURLSchemeTask, statusCode: Int) {
        guard let url = task.request.url,
              let response = HTTPURLResponse(url: url, statusCode: statusCode, httpVersion: "HTTP/1.1", headerFields: corsHeaders) else {
            return
        }
        if isTaskActive(task) {
            task.didReceive(response)
            task.didFinish()
        }
        activeTasksLock.lock()
        activeTasks.remove(ObjectIdentifier(task))
        activeTasksLock.unlock()
    }

    private func handleCacheHit(_ task: WKURLSchemeTask, fileUrl: URL) {
        guard let requestUrl = task.request.url,
              let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path),
              let totalSize = attrs[.size] as? Int64,
              let fileHandle = try? FileHandle(forReadingFrom: fileUrl) else {
            failTask(task, statusCode: 500)
            return
        }

        let rangeHeader = task.request.value(forHTTPHeaderField: "Range")
        var startOffset: Int64 = 0
        var endOffset: Int64 = totalSize - 1
        var isRangeRequest = false

        if let rangeHeader = rangeHeader, rangeHeader.hasPrefix("bytes=") {
            isRangeRequest = true
            let rangeSpec = String(rangeHeader.dropFirst(6)).trimmingCharacters(in: .whitespaces)
            let parts = rangeSpec.components(separatedBy: "-")
            if let first = parts.first, let start = Int64(first) {
                startOffset = max(0, start)
            }
            if parts.count > 1, let second = parts.last, !second.isEmpty, let end = Int64(second) {
                endOffset = min(totalSize - 1, end)
            }
        }
        if isRangeRequest && startOffset >= totalSize {
            var headers = corsHeaders
            headers["Content-Range"] = "bytes */\(totalSize)"
            guard let response = HTTPURLResponse(
                url: requestUrl,
                statusCode: 416,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            ) else {
                failTask(task, statusCode: 500)
                return
            }
            if isTaskActive(task) {
                task.didReceive(response)
                task.didFinish()
            }
            activeTasksLock.lock()
            activeTasks.remove(ObjectIdentifier(task))
            activeTasksLock.unlock()
            return
        }

        let contentLength = max(0, endOffset - startOffset + 1)
        var headers = corsHeaders
        headers["Content-Type"] = "audio/mpeg"
        headers["Accept-Ranges"] = "bytes"
        headers["Content-Length"] = "\(contentLength)"
        headers["X-Cache"] = "HIT"

        let statusCode = isRangeRequest ? 206 : 200
        if isRangeRequest {
            headers["Content-Range"] = "bytes \(startOffset)-\(endOffset)/\(totalSize)"
        }

        guard let response = HTTPURLResponse(
            url: requestUrl,
            statusCode: statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            failTask(task, statusCode: 500)
            return
        }

        if isTaskActive(task) {
            task.didReceive(response)
        }

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            defer { try? fileHandle.close() }
            guard let self = self else { return }

            fileHandle.seek(toFileOffset: UInt64(startOffset))
            var remaining = contentLength
            let chunkSize = 65536

            while remaining > 0 && self.isTaskActive(task) {
                let toRead = Int(min(Int64(chunkSize), remaining))
                let data = fileHandle.readData(ofLength: toRead)
                if data.isEmpty { break }
                task.didReceive(data)
                remaining -= Int64(data.count)
            }

            if self.isTaskActive(task) {
                task.didFinish()
            }

            self.activeTasksLock.lock()
            self.activeTasks.remove(ObjectIdentifier(task))
            self.activeTasksLock.unlock()
        }
    }

    private func handleCacheMiss(_ task: WKURLSchemeTask, targetUrl: URL, cacheKey: String) {
        var upstreamRequest = URLRequest(url: targetUrl)
        upstreamRequest.timeoutInterval = 30.0

        let rangeHeader = task.request.value(forHTTPHeaderField: "Range")
        let canCache = cacheManager.enabled && (rangeHeader == nil || rangeHeader == "bytes=0-")

        if !canCache, let range = rangeHeader {
            upstreamRequest.setValue(range, forHTTPHeaderField: "Range")
        }

        upstreamRequest.setValue(
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
            forHTTPHeaderField: "User-Agent"
        )
        if let scheme = targetUrl.scheme, let host = targetUrl.host {
            upstreamRequest.setValue("\(scheme)://\(host)/", forHTTPHeaderField: "Referer")
        }
        var tempUrl: URL?
        var tempHandle: FileHandle?

        if canCache, let temp = cacheManager.createTempFile(for: cacheKey) {
            tempUrl = temp.url
            tempHandle = temp.handle
        }

        let context = SchemeTaskContext(
            schemeTask: task,
            cacheKey: cacheKey,
            tempUrl: tempUrl,
            tempHandle: tempHandle
        )

        let dataTask = urlSession.dataTask(with: upstreamRequest)
        context.dataTask = dataTask

        let taskId = ObjectIdentifier(task)
        activeTasksLock.lock()
        taskContexts[taskId] = context
        activeTasksLock.unlock()

        dataTask.resume()
    }
}

private final class SchemeTaskContext {
    weak var schemeTask: WKURLSchemeTask?
    let cacheKey: String
    var tempUrl: URL?
    var tempHandle: FileHandle?
    var dataTask: URLSessionDataTask?
    var expectedContentLength: Int64 = -1
    var totalBytesWritten: Int64 = 0

    init(schemeTask: WKURLSchemeTask, cacheKey: String, tempUrl: URL?, tempHandle: FileHandle?) {
        self.schemeTask = schemeTask
        self.cacheKey = cacheKey
        self.tempUrl = tempUrl
        self.tempHandle = tempHandle
    }
}

extension AudioProxySchemeHandler: URLSessionDataDelegate {

    public func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        activeTasksLock.lock()
        let matchingContext = taskContexts.values.first { $0.dataTask == dataTask }
        activeTasksLock.unlock()

        guard let context = matchingContext,
              let schemeTask = context.schemeTask,
              let httpResponse = response as? HTTPURLResponse,
              let requestUrl = schemeTask.request.url else {
            completionHandler(.cancel)
            return
        }

        context.expectedContentLength = httpResponse.expectedContentLength

        var headers = corsHeaders
        for (k, v) in httpResponse.allHeaderFields {
            if let keyStr = k as? String, let valStr = v as? String {
                headers[keyStr] = valStr
            }
        }

        for (k, v) in corsHeaders {
            headers[k] = v
        }

        headers["X-Cache"] = "MISS"

        if headers["Content-Type"] == nil {
            headers["Content-Type"] = "audio/mpeg"
        }

        let proxyResponse = HTTPURLResponse(
            url: requestUrl,
            statusCode: httpResponse.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) ?? httpResponse

        if isTaskActive(schemeTask) {
            schemeTask.didReceive(proxyResponse)
        }

        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        activeTasksLock.lock()
        let matchingContext = taskContexts.values.first { $0.dataTask == dataTask }
        activeTasksLock.unlock()

        guard let context = matchingContext else { return }

        if let schemeTask = context.schemeTask, isTaskActive(schemeTask) {
            schemeTask.didReceive(data)
        }

        if let handle = context.tempHandle {
            handle.write(data)
            context.totalBytesWritten += Int64(data.count)
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        activeTasksLock.lock()
        let matchingContext = taskContexts.values.first { $0.dataTask == task }
        activeTasksLock.unlock()

        guard let context = matchingContext else { return }

        if let handle = context.tempHandle {
            handle.closeFile()
            context.tempHandle = nil
        }

        let isSuccess = (error == nil)
        let hasEnoughBytes = (context.expectedContentLength > 0 && context.totalBytesWritten >= context.expectedContentLength) ||
                             (context.expectedContentLength <= 0 && context.totalBytesWritten >= 1024)

        if let tempUrl = context.tempUrl {
            if isSuccess && hasEnoughBytes {
                cacheManager.commitTempFile(tempUrl: tempUrl, for: context.cacheKey)
            } else {
                cacheManager.discardTempFile(tempUrl: tempUrl)
            }
        }

        if let schemeTask = context.schemeTask, isTaskActive(schemeTask) {
            if let error = error {
                schemeTask.didFailWithError(error)
            } else {
                schemeTask.didFinish()
            }
            activeTasksLock.lock()
            activeTasks.remove(ObjectIdentifier(schemeTask))
            taskContexts.removeValue(forKey: ObjectIdentifier(schemeTask))
            activeTasksLock.unlock()
        }
    }
}
