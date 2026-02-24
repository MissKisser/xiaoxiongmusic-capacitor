# 灰色歌曲解锁实现说明

## 整体流程

1. **前端**：检测到灰色歌曲 → 按优先级请求 `/api/unblock/netease`、`/api/unblock/kuwo`、`/api/unblock/bodian`、`/api/unblock/gequbao`
2. **Server 解锁模块**：用「歌曲 ID」或「歌曲名-歌手」向第三方拿**音频直链**
3. **前端**：拿到直链后，通过 `/api/proxy/audio?url=直链` 让**服务器代理拉取音频流**再返回给客户端（解决 CORS + 部分 CDN 校验）

所以「无法播放」可能发生在两处：**解锁拿不到 URL**，或**代理拉取音频时被拒绝**（例如 IP/Referer 被封）。

---

## 1. 网易云解锁 `getNeteaseSongUrl`

- **接口**：`GET /api/unblock/netease?id=网易云歌曲ID`
- **实现**：Server 请求第三方 API
  - `GET https://music-api.gdstudio.xyz/api.php?types=url&id=xxx`
  - 返回 `{ code: 200, url: "音频直链" }` 或空
- **特点**：不经过酷我/歌曲宝，只依赖 GD 音乐台；若 GD 无资源则返回空。

---

## 2. 酷我解锁 `getKuwoSongUrl`

- **接口**：`GET /api/unblock/kuwo?keyword=歌曲名-歌手`
- **实现**：
  1. 搜索：`GET http://search.kuwo.cn/r.s?...&all=keyword` → 拿到歌曲 ID（MUSICRID）
  2. 转换链接：`GET http://mobi.kuwo.cn/mobi.s?f=kuwo&q=DES加密参数`（参数含 `rid=歌曲ID`）
  3. 从返回 HTML/文本里用正则取出 `http[^\s$"]+` 作为音频 URL
- **音频域名**：一般为 `*.sycdn.kuwo.cn`（酷我 CDN）
- **可能被封点**：`search.kuwo.cn`、`mobi.kuwo.cn` 对服务器 IP 限流或封禁；或后续**代理请求 CDN** 时被拒。

---

## 3. 波点解锁 `getBodianSongUrl`

- **接口**：`GET /api/unblock/bodian?keyword=歌曲名-歌手`
- **实现**：
  1. 搜索：同酷我 `http://search.kuwo.cn/r.s?...` → 拿到歌曲 ID
  2. 先请求一次广告接口：`POST http://bd-api.kuwo.cn/api/service/advert/watch?...`
  3. 请求音频地址：`GET http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?br=320kmp3&musicId=xxx&timestamp=...&sign=...`
  4. 返回 `result.data.audioUrl`，同样是酷我 CDN（如 `er.sycdn.kuwo.cn`）
- **请求头**：固定 `User-Agent: Dart/2.19 (dart:io)`、`host: bd-api.kuwo.cn`、`X-Forwarded-For: 1.0.1.114` 等
- **可能被封点**：`bd-api.kuwo.cn` 或 CDN 对服务器 IP/请求头校验，导致解锁失败或**代理拉流时 403**。

---

## 4. 歌曲宝解锁 `getGequbaoSongUrl`

- **接口**：`GET /api/unblock/gequbao?keyword=歌曲名-歌手`
- **实现**：
  1. 搜索：`GET https://www.gequbao.com/s/{keyword}` → 从 HTML 正则拿音乐 ID
  2. 详情页：`GET https://www.gequbao.com/music/{id}` → 正则拿 `play_id`
  3. 播放地址：`POST https://www.gequbao.com/api/play-url`，body `id={play_id}`
  4. 返回 `data.data.url` 作为音频直链（可能是第三方 CDN）
- **可能被封点**：gequbao 对服务器 IP 或请求频率限制；或返回的直链本身有时效/Referer 校验，代理请求时被拒。

---

## 5. 音频代理 `GET /api/proxy/audio?url=...`

- **作用**：前端不直接请求「解锁得到的直链」，而是请求本站 `https://music.viaxv.top/api/proxy/audio?url=编码后的直链`
- **Server 行为**：用 `axios.get(url, { responseType: "stream", headers: { User-Agent, Referer: targetUrl.origin } })` 去拉取音频，再流式转发给客户端
- **为何会「该资源暂时无法播放」**：
  - 若**服务器 IP** 被酷我 CDN（sycdn.kuwo.cn）或歌曲宝使用的 CDN 封禁/限流，则 `axios.get(音频URL)` 会得到 403/404/超时，代理返回失败，前端就提示「暂时无法播放」。
  - 即：解锁可能已经成功拿到 URL，但**代理阶段**在服务器侧被 CDN 拒绝。

---

## 总结表

| 源       | Server 请求的第三方                         | 返回的音频域名示例      | 可能被封环节           |
|----------|--------------------------------------------|-------------------------|------------------------|
| netease  | music-api.gdstudio.xyz                     | 由 GD 返回              | GD 无资源 / 限流      |
| kuwo     | search.kuwo.cn → mobi.kuwo.cn              | *.sycdn.kuwo.cn         | 搜索/转换 或 代理拉流 |
| bodian   | search.kuwo.cn → bd-api.kuwo.cn            | *.sycdn.kuwo.cn         | 同上                   |
| gequbao  | www.gequbao.com                            | 第三方 CDN              | 网站限流 或 代理拉流  |

**结论**：若你确认是「IP 被封」，多半是**服务器在「代理拉取音频」时**访问酷我 CDN（或其它 CDN）被拒绝。解锁接口本身可能仍能返回 URL，但 `/api/proxy/audio` 用服务器 IP 去请求该 URL 时被 403/404。

---

## 可选改进方向（缓解 IP/封禁）

1. **代理请求头**：在 `server/proxy/index.ts` 里对酷我 CDN 使用更贴近官方客户端的 `User-Agent`、`Referer`（例如仿酷我 App）。
2. **代理出口 IP**：给 server 的 axios 配置 HTTP 代理（公司/家庭宽带等），让拉取音频的请求从另一 IP 出去，避免机房 IP 被 CDN 封。
3. **前端直连**：Capacitor 环境下若客户端可直连音频 URL（不经过 CORS），可考虑在 App 内用客户端请求直链，绕过服务器代理（需你确认客户端请求是否也会被 CDN 拒绝）。

已在 `server/proxy/index.ts` 中做的改进：
- 按目标域名设置更贴近官方的 **User-Agent / Referer**（酷我 CDN 用 okhttp，网易云用 NeteaseMusic）。
- 支持环境变量 **AUDIO_PROXY_URL**：在服务器上设置 `AUDIO_PROXY_URL=http://代理IP:端口`（如 `http://127.0.0.1:7890`），代理拉取音频时会走该出口，可缓解服务器本机 IP 被 CDN 封禁的问题。
