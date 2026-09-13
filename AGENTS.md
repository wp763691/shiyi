# AGENTS.md — 拾忆（Shiyi）

给未来在这个仓库里工作的 AI 会话/开发者的速查。详细内容见
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)。

## 一句话

本地优先的 macOS 工具：统一管理 Claude Code / Codex 的**会话、技能、配置**，
自带基于 tmux 的**内置终端**。零 npm 运行时依赖（Node 内置模块 + 一个 Python 脚本）。

## 目录速查

```
app/server.mjs        本地 HTTP 服务（唯一入口）
app/lib/*.mjs         后端模块（sessions/skills/registry/tmux/termproxy/terminal/configfiles/translations/names）
app/lib/pty_bridge.py PTY 桥（系统 python3，负责 tmux attach 的 I/O 与 resize）
app/public/*          前端单页（index.html / app.js / style.css）
app/public/vendor/xterm  xterm.js 5.3 + canvas addon（Apache-2.0）
app/macos/*           Swift + WKWebView 应用壳、Info.plist、build_app.sh、图标脚本
docs/                 架构、安装、开发文档
scripts/              setup.sh（可选 venv）、migrate-codex-path.mjs
```

## 常用命令

```bash
# 开发（浏览器面板）
cd app && node server.mjs          # http://127.0.0.1:8787

# 演示模式（截图/无隐私数据）
SHIYI_DEMO=1 PORT=8899 node app/server.mjs

# 构建 macOS 应用（arm64，最低 macOS 12）
bash app/macos/build_app.sh        # 产物 app/macos/.build/拾忆.app

# 语法自检
node --check app/server.mjs
node --check app/lib/*.mjs
node --check app/public/app.js
```

发布：打包 `app/macos/.build/拾忆.app`（排除 `Contents/Resources/server/venv-iterm/`）
+ `docs/安装说明.md` → zip → `gh release create vX.Y.Z ...`。

## 关键不变量（改动时务必保持）

1. **零依赖优先**：不要引入 npm 运行时依赖；前端库以 vendor 方式内置。
2. **只监听 127.0.0.1**，所有数据仅本机读写；删除一律"移入回收目录"而非物理删除。
3. **不写死本机路径**：用 `os.homedir()` / 登录 shell 解析；发布包内不得出现 `/Users/<name>`。
4. **二进制最低系统版本必须是 macOS 12**：`swiftc -target arm64-apple-macos12.0`。
5. **tmux 相关**：会话识别用 `pane_start_command`；进程归属用 `pane_pid` 父子链；
   `mouse` 默认保持 `off`（否则滚轮进入 copy-mode 会吞掉键盘输入）。
6. **xterm 背景不要透明**：`allowTransparency` + canvas 渲染器会导致选中层变黑。
7. **可打印字符直通**：终端按键处理里，除 Ctrl/⌘ 快捷键与输入法组合外，
   单字符一律直接写入 pty（避免 WKWebView 键位映射丢失）。
8. **`hidden` 属性会被 `display` 覆盖**：凡自定义 `display` 的元素，都要补
   `[hidden] { display: none }`。

## 数据与存储（均在用户目录，不入库）

| 路径 | 内容 |
|---|---|
| `~/.claude/projects/**/*.jsonl` | Claude Code 会话记录（只读） |
| `~/.claude/sessions/<pid>.json` | Claude 官方 PID→sessionId 映射（关键） |
| `~/.codex/sessions`、`~/.codex/archived_sessions` | Codex 会话（rollout JSONL） |
| `~/.shiyi/session-names.json` | 会话显示别名 |
| `~/.shiyi/skill-translations.json` | 技能描述中文翻译缓存 |
| `/tmp/zyin-app.log`、`/tmp/zyin-app-server.log` | 应用与服务的调试日志 |

## 验证口径（提 PR 前）

- `node --check` 全部通过
- 打开应用：会话/技能/配置三个 Tab 正常渲染，`/api/state` 有数据
- 新建一个 Bash 会话 → 出现在运行区 → 内置终端可输入（含特殊字符 `!@#$%^&*()_+{}|:"<>?~`）
- 外部 Claude/Codex 会话双击能「打开」（默认内置终端，按偏好可切 iTerm）
