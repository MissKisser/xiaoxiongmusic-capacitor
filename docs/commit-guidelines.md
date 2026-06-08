# 提交规范

本文用于约束本仓库后续提交、发布和 Release 附件处理，避免代码、文档、测试脚本和产物混在同一个提交里。

## 基本原则

- 每个提交只表达一个目的，不把无关改动顺手带入。
- 代码、文档、测试、构建产物分开提交；没有明确要求时，不提交文档和测试脚本。
- 发布产物优先同步到 GitHub Release，仓库内是否保留产物目录需要在发布任务中明确说明。
- 提交前必须先看 `git status --short` 和 `git diff --cached --name-only`。
- 不回滚、不清理用户已有未提交改动，除非用户明确要求。

## 文件分类

### 代码提交

只包含会改变应用行为或构建配置的文件，例如：

- `src/**/*.ts`
- `src/**/*.vue`
- `android/app/src/**/*.java`
- `android/app/src/main/res/**`
- `android/app/build.gradle`
- `package.json`

提交类型建议使用：

- `feat(模块): 添加 xxx`
- `fix(模块): 修复 xxx`
- `refactor(模块): 调整 xxx`
- `chore(构建): 更新 xxx`

### 文档提交

只包含说明类内容，例如：

- `docs/**`
- `README.md`
- `CHANGELOG.md`
- `AGENTS.md`

没有用户明确要求时，文档不要和代码一起提交。发布日志可以单独提交，或只写入 GitHub Release notes。

### 测试提交

只包含测试或验证脚本，例如：

- `scripts/test-*.ts`
- `scripts/test-*.mjs`
- `*.spec.ts`
- `*.test.ts`

临时验证脚本默认不提交。只有当测试会长期维护、用于 CI 或回归验证时，才单独提交。

### 产物与 Release

发布产物包括：

- APK
- SHA256 校验文件
- Gradle metadata
- 其他打包输出

处理规则：

- APK 必须上传到对应 GitHub Release。
- Release tag 必须指向本次发布代码提交。
- 上传后用 `gh release view <tag> --json assets` 复核附件。
- 如果产物需要进仓库，必须单独确认并单独提交。

## 提交流程

1. 查看工作区：

   ```bash
   git status --short
   ```

2. 按文件类别精确暂存，不使用 `git add .`：

   ```bash
   git add -- src/example.ts android/app/src/main/java/com/xiaoxiong/music/Example.java
   ```

3. 检查暂存区：

   ```bash
   git diff --cached --name-only
   git diff --cached --check
   ```

4. 运行与改动匹配的验证：

   ```bash
   pnpm build
   ```

   Android 原生改动还需要：

   ```bash
   pnpm cap:sync:android
   .\gradlew.bat :app:assembleDebug
   ```

   发布任务还需要：

   ```bash
   .\gradlew.bat :app:assembleRelease
   ```

5. 提交：

   ```bash
   git commit -m "fix(模块): 修复具体问题"
   ```

6. 推送前再次确认没有误暂存：

   ```bash
   git status --short
   git log -1 --stat
   ```

## 提交信息格式

使用中文 Conventional Commits：

```text
<type>(<scope>): <subject>

<body>

Constraint: <约束>
Rejected: <被拒方案> | <原因>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <后续维护提醒>
Tested: <验证命令>
Not-tested: <未验证项>
```

示例：

```text
fix(桌面歌词): 修复播放态横向滚动重置

播放时同一句歌词被高频同步到原生浮窗，导致 Android TextView marquee
反复重启。改为按歌词内容去重，同一句只同步一次。

Constraint: 仅影响 Android 桌面歌词
Confidence: high
Scope-risk: narrow
Directive: 修改桌面歌词同步时必须检查播放态长文本滚动
Tested: pnpm exec tsx scripts/test-android-desktop-lyric.ts; pnpm build
Not-tested: 未在真机录屏复核所有歌词长度
```

## 禁止事项

- 禁止用 `git add .` 或 `git add -A` 处理混杂工作区。
- 禁止把代码修复、文档整理、临时测试脚本和 APK 产物打进同一个提交。
- 禁止在没有验证输出的情况下写 `Tested:`。
- 禁止把用户已有未提交改动当成自己的改动提交。
- 禁止只把 APK 放进仓库目录而不上传 GitHub Release。

## 发布检查清单

- `package.json` 版本已更新。
- `android/app/build.gradle` 的 `versionCode` 和 `versionName` 已更新。
- `pnpm build` 通过。
- `pnpm cap:sync:android` 通过。
- `.\gradlew.bat :app:assembleRelease` 通过。
- APK SHA256 已生成。
- GitHub Release 已创建或更新。
- `gh release view <tag> --json assets` 能看到 APK、SHA256 和 metadata。
- `git status --short` 中没有误暂存或误提交文件。
