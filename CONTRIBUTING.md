# Contributing

感谢你愿意参与拾忆。

## 提问题 / Bug

- 先搜索 Issues 是否已存在
- Bug 请提供：macOS 版本、Node/Claude/Codex 版本、复现步骤、期望与实际表现

## 提功能

- 用 feature 模板描述使用场景，优先解决"会话与工具链管理"的真实痛点

## 提交代码

1. Fork 本仓库并创建分支：`feat/xxx` 或 `fix/xxx`
2. 保持改动聚焦；新功能补充必要的说明
3. 本地自检：

```bash
node --check app/server.mjs
node --check app/lib/*.mjs
node --check app/public/app.js
```

4. 提交信息使用 Conventional Commits（`feat:` / `fix:` / `docs:` …）

## 隐私红线

不要提交任何本地密钥、配置文件（`path-aliases.json`、`~/.claude/*`、`~/.codex/*`）或含个人会话内容的截图。
