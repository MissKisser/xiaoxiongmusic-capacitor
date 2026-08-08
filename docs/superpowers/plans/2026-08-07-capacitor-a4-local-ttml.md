# 本地 TTML 歌词库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Capacitor Android 端使用 Filesystem `Directory.Data` 保存、导入、管理并按文件名匹配本地 TTML 歌词。

**Architecture:** 新增独立 `localTtmlRepo` 服务，使用 Capacitor Filesystem 维护应用沙盒 `lyrics` 目录中的 TTML 文件；导入 UI 通过浏览器文件输入读取用户选中的 `.ttml` 文本并写入仓库。LyricManager 在现有 Electron 本地歌词覆盖之前查询该仓库，匹配歌曲标题和歌手后复用现有 `parseTTML`/最终歌词处理链。

**Tech Stack:** Vue 3 Composition API, TypeScript, Naive UI, `@capacitor/filesystem` 8.x, existing `@applemusic-like-lyrics/lyric` parser.

## Global Constraints

- 只修改 capacitor 工作区，不修改 `server/`。
- 不引入新 npm 依赖；Filesystem 已存在于 `package.json`。
- 存储目录固定为 Capacitor `Directory.Data` 下的 `lyrics`。
- UI 使用 Naive UI，不引入 UnoCSS。
- 移植代码必须包含 AGPL-3.0 版权注释。
- 不实现单元测试；验证使用 `pnpm typecheck`。
- 仅本地提交，不推送。

---

### Task 1: 添加 Capacitor 本地 TTML 仓库服务

**Files:**
- Create: `src/services/localTtmlRepo.ts`

**Interfaces:**
- Produces `LocalTtmlEntry`, `listLocalTtml()`, `saveLocalTtml()`, `readLocalTtml()`, `deleteLocalTtml()`, `renameLocalTtml()`, `matchLocalTtml()`。
- 文件名匹配使用歌曲名归一化，并以歌手作为同名候选的软匹配。

- [ ] **Step 1: Implement Filesystem-backed repository**

```ts
/**
 * Based on SPlayer-Next
 * Copyright (C) 2024 SPlayer-Dev
 * Licensed under AGPL-3.0
 */
import { Directory, Filesystem } from "@capacitor/filesystem";
import type { SongType } from "@/types/main";

const ROOT = "lyrics";
export interface LocalTtmlEntry { name: string; path: string; size: number; mtime: number; }
const normalize = (value: string) => value.toLocaleLowerCase().replace(/[\\/:*?"<>|]/g, "").replace(/\\s+/g, "").trim();
const safeName = (name: string) => name.replace(/\\.ttml$/i, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "untitled";
const filePath = (name: string) => `${ROOT}/${safeName(name)}.ttml`;

export const listLocalTtml = async (): Promise<LocalTtmlEntry[]> => {
  try {
    const result = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    return result.files.filter((file) => file.type !== "directory" && file.name.toLowerCase().endsWith(".ttml"))
      .map((file) => ({ name: file.name, path: `${ROOT}/${file.name}`, size: file.size ?? 0, mtime: file.mtime ?? 0 }));
  } catch { return []; }
};
export const readLocalTtml = async (path: string) => {
  try { return (await Filesystem.readFile({ path, directory: Directory.Data })).data; } catch { return null; }
};
export const saveLocalTtml = async (name: string, data: string) => {
  await Filesystem.mkdir({ path: ROOT, directory: Directory.Data, recursive: true }).catch(() => undefined);
  const path = filePath(name);
  await Filesystem.writeFile({ path, data, directory: Directory.Data, encoding: "utf8", recursive: true });
  return path;
};
export const deleteLocalTtml = async (path: string) => { await Filesystem.deleteFile({ path, directory: Directory.Data }); };
export const renameLocalTtml = async (path: string, name: string) => {
  const target = filePath(name);
  await Filesystem.rename({ from: path, to: target, directory: Directory.Data });
  return target;
};
export const matchLocalTtml = async (song: SongType) => {
  const wanted = normalize(song.name);
  const artist = normalize(Array.isArray(song.artists) ? song.artists[0]?.name ?? "" : String(song.artists ?? ""));
  for (const entry of await listLocalTtml()) {
    const stem = normalize(entry.name.replace(/\\.ttml$/i, ""));
    if (stem === wanted || stem === normalize(`${song.name}-${artist}`) || stem === normalize(`${song.name} - ${artist}`)) {
      const data = await readLocalTtml(entry.path);
      if (data) return data;
    }
  }
  return null;
};
```

- [ ] **Step 2: Verify the new module has no disallowed imports**

Run: `grep -n "from \"@capacitor/file-picker\"\|from \"unocss\"" src/services/localTtmlRepo.ts`
Expected: no output.

### Task 2: Integrate local matching into LyricManager

**Files:**
- Modify: `src/core/player/LyricManager.ts:1-12,657-714`

**Interfaces:**
- Consumes `matchLocalTtml(song)` from Task 1.
- Existing Electron `read-local-lyric` behavior remains unchanged.

- [ ] **Step 1: Add import and Capacitor branch**

Add `import { matchLocalTtml } from "@/services/localTtmlRepo";` and change the early return to permit non-Electron matching. In `checkLocalLyricOverride`, query `matchLocalTtml(useMusicStore().playSong)` before the Electron IPC path; parse the returned TTML with the existing `parseTTML`, set `usingTTMLLyric`, and return `{ lrcData: [], yrcData: lines }`.

- [ ] **Step 2: Keep existing Electron path gated**

Use `if (!isElectron || !localLyricPath.length) return ...` only around the existing IPC implementation after the Capacitor repository query, so desktop behavior is preserved.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: command succeeds with no TypeScript errors.

### Task 3: Add Naive UI import and management controls

**Files:**
- Modify: `src/components/Setting/LyricsSetting.vue:1-8,40-466,471-515`

**Interfaces:**
- Consumes repository functions from Task 1.
- Provides browser-based `.ttml` import without File Picker dependency.

- [ ] **Step 1: Add repository state and handlers**

Import `deleteLocalTtml`, `listLocalTtml`, `renameLocalTtml`, `saveLocalTtml`, and `LocalTtmlEntry`. Add `ref`, `onMounted`, `useMessage`, and handlers to refresh, read `File.text()`, reject non-TTML files, save with the original filename, delete with confirmation, and rename through `window.prompt`.

- [ ] **Step 2: Add management card**

Add an `n-card` near the top of the settings list with an invisible `<input type="file" accept=".ttml,text/xml,application/xml" multiple>` and Naive UI buttons. Render entries with `n-list`, `n-list-item`, `n-ellipsis`, and delete/rename buttons. Show empty state and import errors through `useMessage`.

- [ ] **Step 3: Refresh on mount and after mutations**

Call `refreshLocalTtml()` in `onMounted`; refresh after import, rename, and delete.

- [ ] **Step 4: Run typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: command succeeds with no TypeScript errors.

### Task 4: Branch, verify, and commit

**Files:**
- Modify: no files outside Tasks 1-3.

- [ ] **Step 1: Create requested branch**

Run: `git checkout -b feat/capacitor-a4-local-ttml`
Expected: branch switches successfully; if it already exists, switch to it without resetting changes.

- [ ] **Step 2: Confirm server is untouched**

Run: `git status --short -- server`
Expected: no output.

- [ ] **Step 3: Run final typecheck**

Run: `pnpm typecheck 2>&1 | tail -30`
Expected: exit code 0 and no errors.

- [ ] **Step 4: Commit locally**

```bash
git add -A
git commit -m "feat(lyric): 本地 TTML 歌词库 (借鉴 SPlayer-Next)"
```

- [ ] **Step 5: Capture report data**

Run `git rev-parse HEAD`, `git show --numstat --format='' HEAD`, and `git diff-tree --no-commit-id --name-only -r HEAD` to populate the required JSON report.
