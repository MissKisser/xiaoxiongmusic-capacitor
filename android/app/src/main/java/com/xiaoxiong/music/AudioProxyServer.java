package com.xiaoxiong.music;

import android.content.Context;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/**
 * 本地音频代理服务器（带磁盘缓存）
 *
 * 在 localhost 上运行，代理第三方音频流并添加 CORS 头。
 * 支持边播放边缓存到磁盘，LRU 淘汰策略。
 */
public class AudioProxyServer extends NanoHTTPD {
    private static final String TAG = "AudioProxyServer";
    private static final int PORT = 18520;
    private static final int CONNECT_TIMEOUT = 10000;
    private static final int READ_TIMEOUT = 30000;
    private static final long STALE_TMP_THRESHOLD_MS = 5 * 60 * 1000;
    // 最小有效缓存文件大小（小于此值视为损坏）
    private static final long MIN_VALID_CACHE_SIZE = 1024; // 1KB

    private final Context context;
    private File cacheDir;
    private boolean cacheEnabled = true;
    private long maxCacheSize = 500L * 1024 * 1024; // 默认 500MB
    // 缓存策略: "all" = 缓存所有播放的歌曲, "complete" = 只缓存播放完的歌曲
    private String cacheStrategy = "all";

    public AudioProxyServer(Context context) {
        super(PORT);
        this.context = context;
        this.cacheDir = new File(context.getCacheDir(), "audio_cache");
        if (!cacheDir.exists()) {
            cacheDir.mkdirs();
        }
        Log.d(TAG, "📁 缓存目录: " + cacheDir.getAbsolutePath());
        cleanStaleTempFiles();
    }

    // === 缓存控制方法 ===

    public void setCacheEnabled(boolean enabled) {
        this.cacheEnabled = enabled;
        Log.d(TAG, "⚙️ 缓存开关: " + (enabled ? "已开启" : "已关闭"));
    }

    public boolean isCacheEnabled() {
        return cacheEnabled;
    }

    public void setMaxCacheSize(long maxSizeBytes) {
        this.maxCacheSize = maxSizeBytes;
        Log.d(TAG, "⚙️ 缓存上限: " + (maxSizeBytes / 1024 / 1024) + "MB");
    }

    public long getMaxCacheSize() {
        return maxCacheSize;
    }

    public void setCacheStrategy(String strategy) {
        this.cacheStrategy = strategy;
        Log.d(TAG, "⚙️ 缓存策略: " + ("all".equals(strategy) ? "缓存所有播放的歌曲" : "只缓存播放完的歌曲"));
    }

    public String getCacheStrategy() {
        return cacheStrategy;
    }

    /**
     * 获取当前缓存大小（字节），不含临时文件
     */
    public long getCacheSize() {
        long totalSize = 0;
        if (cacheDir.exists()) {
            File[] files = cacheDir.listFiles();
            if (files != null) {
                for (File file : files) {
                    if (!file.getName().endsWith(".tmp")) {
                        totalSize += file.length();
                    }
                }
            }
        }
        return totalSize;
    }

    /**
     * 清空所有缓存
     */
    public void clearCache() {
        if (cacheDir.exists()) {
            File[] files = cacheDir.listFiles();
            if (files != null) {
                for (File file : files) {
                    file.delete();
                }
            }
        }
        Log.d(TAG, "🧹 缓存已全部清除");
    }

    /**
     * 清理陈旧的临时文件
     */
    private void cleanStaleTempFiles() {
        if (!cacheDir.exists())
            return;
        File[] files = cacheDir.listFiles();
        if (files == null)
            return;
        long now = System.currentTimeMillis();
        for (File file : files) {
            if (file.getName().endsWith(".tmp")) {
                if (now - file.lastModified() > STALE_TMP_THRESHOLD_MS) {
                    file.delete();
                    Log.d(TAG, "🧹 清理过期临时文件: " + file.getName());
                }
            }
        }
    }

    /**
     * 验证缓存文件完整性
     * 
     * @return true 如果文件有效
     */
    private boolean validateCacheFile(File cacheFile) {
        if (!cacheFile.exists())
            return false;
        if (cacheFile.length() < MIN_VALID_CACHE_SIZE) {
            Log.w(TAG, "🔍 缓存文件过小 (" + cacheFile.length() + "B)，已删除: " + cacheFile.getName());
            cacheFile.delete();
            return false;
        }
        // 检查文件是否可读
        try {
            FileInputStream fis = new FileInputStream(cacheFile);
            byte[] header = new byte[4];
            int read = fis.read(header);
            fis.close();
            if (read < 4) {
                Log.w(TAG, "🔍 缓存文件不可读，已删除: " + cacheFile.getName());
                cacheFile.delete();
                return false;
            }
            return true;
        } catch (Exception e) {
            Log.w(TAG, "🔍 缓存文件已损坏，已删除: " + cacheFile.getName());
            cacheFile.delete();
            return false;
        }
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        Method method = session.getMethod();

        // CORS 预检
        if (Method.OPTIONS.equals(method)) {
            Response response = newFixedLengthResponse(Response.Status.OK, "text/plain", "");
            addCorsHeaders(response);
            return response;
        }

        if (!"/proxy/audio".equals(uri)) {
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not Found");
        }

        Map<String, String> params = session.getParms();
        String targetUrl = params.get("url");
        if (targetUrl == null || targetUrl.isEmpty()) {
            Response response = newFixedLengthResponse(Response.Status.BAD_REQUEST, "text/plain",
                    "Missing 'url' parameter");
            addCorsHeaders(response);
            return response;
        }

        try {
            targetUrl = URLDecoder.decode(targetUrl, "UTF-8");
        } catch (Exception e) {
            // 忽略
        }

        try {
            String rangeHeader = session.getHeaders().get("range");
            boolean hasRange = rangeHeader != null && !rangeHeader.isEmpty();

            // 判断是否为"从头开始"的 Range 请求（bytes=0- 等价于完整请求）
            boolean isRangeFromStart = false;
            if (hasRange) {
                String rv = rangeHeader.replace("bytes=", "").trim();
                isRangeFromStart = rv.equals("0-") || rv.equals("0-");
            }
            // 真正的部分 Range（seek）：有明确的起始偏移（非 0）
            boolean isPartialRange = hasRange && !isRangeFromStart;

            Log.d(TAG, "📡 收到音频请求 | 缓存:" + (cacheEnabled ? "开" : "关") + " | Range:" + rangeHeader + " | 是否Seek:"
                    + isPartialRange);

            if (cacheEnabled) {
                // 优先使用前端传递的稳定 key（歌曲 ID），URL 中的时间戳/token 每次不同
                String keyParam = params.get("key");
                String cacheKey = (keyParam != null && !keyParam.isEmpty()) ? md5(keyParam) : md5(targetUrl);
                File cacheFile = new File(cacheDir, cacheKey);

                // 缓存命中 + 完整性校验
                if (validateCacheFile(cacheFile)) {
                    Log.d(TAG, "✅ 缓存命中，直接读取本地文件: " + cacheKey);
                    cacheFile.setLastModified(System.currentTimeMillis());

                    if (hasRange) {
                        return serveCachedFileWithRange(cacheFile, rangeHeader);
                    }
                    return serveCachedFile(cacheFile);
                }

                // 缓存未命中：如果不是部分 Range（seek），走边代理边缓存
                // bytes=0- 或无 Range 都走缓存路径
                if (!isPartialRange) {
                    Log.d(TAG, "❌ 缓存未命中，开始边播放边缓存: " + cacheKey);
                    return proxyAndCache(session, targetUrl, cacheFile);
                }
            }

            // 部分 Range 请求且缓存未命中，或缓存关闭：直接代理
            Log.d(TAG, "⏩ 跳过缓存，直接代理（Seek请求或缓存关闭）");
            return proxyAudioStream(session, targetUrl);
        } catch (Exception e) {
            Log.e(TAG, "Proxy error: " + e.getMessage(), e);
            Response response = newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain",
                    "Proxy error: " + e.getMessage());
            addCorsHeaders(response);
            return response;
        }
    }

    /**
     * 从缓存文件返回完整响应
     */
    private Response serveCachedFile(File cacheFile) {
        try {
            FileInputStream fis = new FileInputStream(cacheFile);
            Response response = newFixedLengthResponse(Response.Status.OK, "audio/mpeg", fis, cacheFile.length());
            addCorsHeaders(response);
            response.addHeader("Accept-Ranges", "bytes");
            response.addHeader("X-Cache", "HIT");
            return response;
        } catch (Exception e) {
            Log.e(TAG, "Error serving cached file", e);
            return newFixedLengthResponse(Response.Status.INTERNAL_ERROR, "text/plain", "Cache read error");
        }
    }

    /**
     * 从缓存文件返回 Range 响应
     */
    private Response serveCachedFileWithRange(File cacheFile, String rangeHeader) {
        try {
            long fileLength = cacheFile.length();
            String rangeValue = rangeHeader.replace("bytes=", "").trim();
            String[] parts = rangeValue.split("-");
            long start = Long.parseLong(parts[0]);
            long end = parts.length > 1 && !parts[1].isEmpty() ? Long.parseLong(parts[1]) : fileLength - 1;

            if (start >= fileLength) {
                Response resp = newFixedLengthResponse(Response.Status.lookup(416), "text/plain",
                        "Range Not Satisfiable");
                addCorsHeaders(resp);
                return resp;
            }
            if (end >= fileLength)
                end = fileLength - 1;

            long contentLength = end - start + 1;
            FileInputStream fis = new FileInputStream(cacheFile);
            fis.skip(start);

            Response response = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, "audio/mpeg", fis,
                    contentLength);
            addCorsHeaders(response);
            response.addHeader("Content-Range", "bytes " + start + "-" + end + "/" + fileLength);
            response.addHeader("Accept-Ranges", "bytes");
            response.addHeader("X-Cache", "HIT");
            return response;
        } catch (Exception e) {
            Log.e(TAG, "Error serving cached file with range", e);
            return serveCachedFile(cacheFile);
        }
    }

    /**
     * 边代理边缓存
     */
    private Response proxyAndCache(IHTTPSession session, String targetUrl, File cacheFile) throws IOException {
        // 缓存模式：不转发 Range 头给远端，确保获取完整文件（200 而非 206）
        HttpURLConnection connection = (HttpURLConnection) new URL(targetUrl).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT);
        connection.setReadTimeout(READ_TIMEOUT);
        connection.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");
        try {
            URL url = new URL(targetUrl);
            connection.setRequestProperty("Referer", url.getProtocol() + "://" + url.getHost() + "/");
        } catch (Exception e) {
            /* 忽略 */ }
        connection.connect();

        int responseCode = connection.getResponseCode();
        if (responseCode != 200) {
            InputStream is = connection.getInputStream();
            String ct = connection.getContentType();
            if (ct == null)
                ct = "audio/mpeg";
            Response resp = newChunkedResponse(Response.Status.lookup(responseCode), ct, is);
            addCorsHeaders(resp);
            return resp;
        }

        InputStream inputStream = connection.getInputStream();
        String contentType = connection.getContentType();
        if (contentType == null)
            contentType = "audio/mpeg";
        long contentLength = connection.getContentLengthLong();

        File tempFile = new File(cacheDir, cacheFile.getName() + ".tmp");
        FileOutputStream cacheOut;
        try {
            cacheOut = new FileOutputStream(tempFile);
        } catch (Exception e) {
            Log.e(TAG, "Cannot create cache temp file", e);
            if (contentLength > 0) {
                Response response = newFixedLengthResponse(Response.Status.OK, contentType, inputStream, contentLength);
                addCorsHeaders(response);
                return response;
            } else {
                Response response = newChunkedResponse(Response.Status.OK, contentType, inputStream);
                addCorsHeaders(response);
                return response;
            }
        }

        // 传入缓存策略：是否在客户端断开时继续后台下载
        boolean cacheAll = "all".equals(this.cacheStrategy);
        TeeInputStream teeStream = new TeeInputStream(inputStream, cacheOut, tempFile, cacheFile, contentLength,
                cacheAll, this);

        Response response;
        if (contentLength > 0) {
            response = newFixedLengthResponse(Response.Status.OK, contentType, teeStream, contentLength);
        } else {
            response = newChunkedResponse(Response.Status.OK, contentType, teeStream);
        }

        addCorsHeaders(response);
        response.addHeader("Accept-Ranges", "bytes");
        response.addHeader("X-Cache", "MISS");
        return response;
    }

    /**
     * 直接代理音频流（无缓存）
     */
    private Response proxyAudioStream(IHTTPSession session, String targetUrl) throws IOException {
        HttpURLConnection connection = createConnection(session, targetUrl);
        connection.connect();

        int responseCode = connection.getResponseCode();
        InputStream inputStream = connection.getInputStream();

        Response.IStatus status;
        if (responseCode == 206) {
            status = Response.Status.PARTIAL_CONTENT;
        } else if (responseCode == 200) {
            status = Response.Status.OK;
        } else {
            status = Response.Status.lookup(responseCode);
            if (status == null)
                status = Response.Status.INTERNAL_ERROR;
        }

        String contentType = connection.getContentType();
        if (contentType == null)
            contentType = "audio/mpeg";
        long contentLength = connection.getContentLengthLong();

        Response response;
        if (contentLength > 0) {
            response = newFixedLengthResponse(status, contentType, inputStream, contentLength);
        } else {
            response = newChunkedResponse(status, contentType, inputStream);
        }

        addCorsHeaders(response);

        String contentRange = connection.getHeaderField("Content-Range");
        if (contentRange != null)
            response.addHeader("Content-Range", contentRange);
        String acceptRanges = connection.getHeaderField("Accept-Ranges");
        if (acceptRanges != null)
            response.addHeader("Accept-Ranges", acceptRanges);

        return response;
    }

    private HttpURLConnection createConnection(IHTTPSession session, String targetUrl) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(targetUrl).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT);
        connection.setReadTimeout(READ_TIMEOUT);
        connection.setRequestProperty("User-Agent",
                "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36");

        String rangeHeader = session.getHeaders().get("range");
        if (rangeHeader != null) {
            connection.setRequestProperty("Range", rangeHeader);
        }

        try {
            URL url = new URL(targetUrl);
            connection.setRequestProperty("Referer", url.getProtocol() + "://" + url.getHost() + "/");
        } catch (Exception e) {
            // 忽略
        }

        return connection;
    }

    /**
     * LRU 淘汰：删除最久未使用的文件直到缓存大小低于上限
     */
    void evictIfNeeded() {
        if (!cacheEnabled || maxCacheSize <= 0)
            return;

        long currentSize = getCacheSize();
        if (currentSize <= maxCacheSize)
            return;

        File[] files = cacheDir.listFiles();
        if (files == null || files.length == 0)
            return;

        Arrays.sort(files, Comparator.comparingLong(File::lastModified));

        for (File file : files) {
            if (currentSize <= maxCacheSize)
                break;
            if (file.getName().endsWith(".tmp"))
                continue;
            long fileSize = file.length();
            if (file.delete()) {
                currentSize -= fileSize;
                Log.d(TAG, "🗑️ 淘汰旧缓存: " + file.getName() + " (" + (fileSize / 1024) + "KB)");
            }
        }

        cleanStaleTempFiles();
    }

    private void addCorsHeaders(Response response) {
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Range, Content-Type");
        response.addHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, X-Cache");
    }

    private static String md5(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(input.hashCode());
        }
    }

    /**
     * TeeInputStream：读取时同时写入缓存文件。
     *
     * 核心设计：
     * - 在 read() 返回 EOF 时立即 finalize 缓存（不依赖 close）
     * - cacheAll=true 时（策略一）：客户端断开后，后台线程继续下载剩余数据
     * - cacheAll=false 时（策略二）：客户端断开则丢弃不完整缓存
     */
    private static class TeeInputStream extends InputStream {
        private final InputStream source;
        private final OutputStream cacheOut;
        private final File tempFile;
        private final File targetFile;
        private final long expectedLength;
        private final boolean cacheAll;
        private final AudioProxyServer server;
        private long totalBytesRead = 0;
        private volatile boolean finalized = false;
        private volatile boolean closed = false;

        TeeInputStream(InputStream source, OutputStream cacheOut, File tempFile, File targetFile,
                long expectedLength, boolean cacheAll, AudioProxyServer server) {
            this.source = source;
            this.cacheOut = cacheOut;
            this.tempFile = tempFile;
            this.targetFile = targetFile;
            this.expectedLength = expectedLength;
            this.cacheAll = cacheAll;
            this.server = server;
        }

        @Override
        public int read() throws IOException {
            int b;
            try {
                b = source.read();
            } catch (IOException e) {
                discardCache();
                throw e;
            }
            if (b != -1) {
                totalBytesRead++;
                try {
                    cacheOut.write(b);
                } catch (Exception e) {
                    /* 忽略 */ }
                if (expectedLength > 0 && totalBytesRead >= expectedLength) {
                    finalizeCache();
                }
            } else {
                finalizeCache();
            }
            return b;
        }

        @Override
        public int read(byte[] buf, int off, int len) throws IOException {
            int bytesRead;
            try {
                bytesRead = source.read(buf, off, len);
            } catch (IOException e) {
                discardCache();
                throw e;
            }
            if (bytesRead > 0) {
                totalBytesRead += bytesRead;
                try {
                    cacheOut.write(buf, off, bytesRead);
                } catch (Exception e) {
                    /* 忽略 */ }
                if (expectedLength > 0 && totalBytesRead >= expectedLength) {
                    finalizeCache();
                }
            } else if (bytesRead == -1) {
                finalizeCache();
            }
            return bytesRead;
        }

        /**
         * 完成缓存：flush + close + rename（只执行一次）
         */
        private synchronized void finalizeCache() {
            if (finalized)
                return;
            finalized = true;

            try {
                cacheOut.flush();
            } catch (Exception e) {
                /* 忽略 */ }
            try {
                cacheOut.close();
            } catch (Exception e) {
                /* 忽略 */ }

            boolean isComplete = false;
            if (expectedLength > 0) {
                isComplete = totalBytesRead >= expectedLength;
            } else {
                isComplete = tempFile.exists() && tempFile.length() > 0;
            }

            if (isComplete && tempFile.exists() && tempFile.length() >= MIN_VALID_CACHE_SIZE) {
                if (targetFile.exists())
                    targetFile.delete();
                if (tempFile.renameTo(targetFile)) {
                    Log.d(TAG, "💾 缓存完成: " + targetFile.getName() + " (" + (targetFile.length() / 1024) + "KB)");
                    new Thread(() -> server.evictIfNeeded()).start();
                } else {
                    Log.e(TAG, "❌ 缓存保存失败：临时文件重命名失败");
                    tempFile.delete();
                }
            } else {
                Log.d(TAG, "⚠️ 下载不完整 (" + totalBytesRead + "/" + expectedLength + ")，丢弃缓存");
                tempFile.delete();
            }
        }

        /**
         * 丢弃缓存
         */
        private synchronized void discardCache() {
            if (finalized)
                return;
            finalized = true;
            try {
                cacheOut.close();
            } catch (Exception e) {
                /* 忽略 */ }
            if (tempFile.exists())
                tempFile.delete();
            Log.d(TAG, "🚫 缓存已丢弃: " + targetFile.getName());
        }

        /**
         * 后台继续下载剩余数据（策略一："缓存所有播放的歌曲"）
         */
        private void continueDownloadInBackground() {
            Log.d(TAG, "📥 后台继续下载: " + targetFile.getName()
                    + " (已下载 " + totalBytesRead + "/" + expectedLength + ")");
            new Thread(() -> {
                try {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = source.read(buf)) != -1) {
                        totalBytesRead += n;
                        cacheOut.write(buf, 0, n);
                    }
                    finalizeCache();
                } catch (Exception e) {
                    Log.e(TAG, "📥 后台下载失败: " + e.getMessage());
                    discardCache();
                } finally {
                    try {
                        source.close();
                    } catch (Exception e) {
                        /* 忽略 */ }
                }
            }, "CacheDownload-" + targetFile.getName()).start();
        }

        @Override
        public void close() throws IOException {
            if (closed)
                return;
            closed = true;

            if (!finalized) {
                if (cacheAll) {
                    // 策略一：客户端断开，后台继续下载完整文件
                    continueDownloadInBackground();
                    // 不关闭 source，后台线程负责关闭
                    return;
                } else {
                    // 策略二：客户端断开，丢弃不完整缓存
                    discardCache();
                }
            }

            try {
                source.close();
            } catch (Exception e) {
                /* 忽略 */ }
        }
    }
}
