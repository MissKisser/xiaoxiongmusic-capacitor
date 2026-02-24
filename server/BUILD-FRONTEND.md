# 构建前端文件

## Windows PowerShell

```powershell
# 方式 1: 使用环境变量（推荐）
$env:SKIP_NATIVE_BUILD="true"
pnpm build

# 方式 2: 使用专门的构建脚本
pnpm build:web
```

## Windows CMD

```cmd
set SKIP_NATIVE_BUILD=true
pnpm build
```

## Linux/macOS

```bash
SKIP_NATIVE_BUILD=true pnpm build
```

## 构建后的文件位置

构建完成后，前端文件会在 `out/renderer` 目录中。

## 验证

构建完成后，检查 `out/renderer` 目录是否存在 `index.html` 文件：

```powershell
# Windows PowerShell
Test-Path out/renderer/index.html

# 如果返回 True，说明构建成功
```
