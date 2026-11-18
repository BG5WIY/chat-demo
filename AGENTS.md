# AGENTS.md

基于 DeepSeek API 的纯前端聊天示例：浏览器直接请求 `https://api.deepseek.com`，没有应用后端。React 18 + rspack + TypeScript + Zustand + IndexedDB，部署在 GitHub Pages。

## 命令

| 命令          | 作用                       |
| ------------- | -------------------------- |
| `pnpm dev`    | 开发服务器，端口 8090      |
| `pnpm build`  | 生产构建到 `dist/`         |
| `pnpm type`   | TypeScript 类型检查（唯一） |
| `pnpm lint`   | oxlint                     |
| `pnpm format` | oxfmt 格式化               |

改完代码至少跑 `pnpm type`，提交前再跑 `pnpm lint` 和 `pnpm build`。没有测试框架；纯逻辑（如 `history/merge.ts`、`chat/cost.ts`）可以临时用 `tsc --ignoreConfig --outDir .tmp-test` 编译后写 `.mjs` 断言跑一遍，跑完删除，不要提交临时文件。

## 目录

```text
src/
  app/              布局、主题、视口
  components/       界面组件（base / chatInput / messages / search / session / settings / sider）
  i18n/             中英文文案
  services/
    api/            Anthropic 兼容的 Messages / Files / SSE 与协议类型
    chat/           会话、消息分支、IndexedDB、草稿、导入导出
    markdown/       解析、高亮、KaTeX、Mermaid
    speech/         录音与朗读
  utils/            通用工具（id、日期格式、剪贴板）
```

## 约定

- 严格 TS：`strict`、`noUnusedLocals`、`noUnusedParameters`，不要用 `any`。
- 源码导入一律写 `.js` 后缀（映射到同名 `.ts` / `.tsx`），由 rspack 的 `extensionAlias` 解析。
- 新增文案必须同时加到 `i18n/zh.ts` 和 `i18n/en.ts`；`en.ts` 用 `satisfies Record<keyof typeof zh, string>` 强制补齐。
- 样式用 CSS Modules；颜色、字体用 `theme.css` 里的 `--dsw-*` 变量，不要写死。
- 构建目标写的是 chrome 105 / safari 16 / firefox 110，但现有代码已用 `toSorted` 等较新 API；新增代码跟随现有写法即可，不要为此引入 polyfill。
- 不要提交 `dist/`、`node_modules/`；API Key 只存在 localStorage。

## 会话与消息模型

`Session.messages` 保存**全部分支**，不是线性列表。可见路径由 `rootMessageId` 加每条消息的 `selectedChildId` 决定；`selectedChildId` 缺省时按 ID 最大选择。相关操作都在 `services/chat/branches.ts`：

- `normalizeSession`：把旧的线性会话转成单分支树。
- `getVisibleMessages`：当前展示与请求上下文共用的路径。
- `buildMessageVersions`：同 `parentId` 的兄弟消息构成版本组，驱动 `BranchSwitcher`。
- `appendBranch` / `selectVersion`：新增分支和切换版本。

消息类型见 `services/chat/types.ts`：用户消息带 `files`；回复用 `blocks`（`thinking` / `text` / `server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result`），流式事件通过 `services/chat/reply.ts` 的 `applyEvent` 合并。

## 存储

IndexedDB 由 `services/chat/db.ts` 的 `idb` 封装：

- `sessions` / `sessionSummaries`（列表只读摘要）/ `files`（附件原件）。
- `sessionsStaging` / `filesStaging`：导入期间的暂存，提交或失败后清空。
- `importBases`：每个导入会话上次导入时的内容指纹。
- 改存储结构必须递增 `DB_VERSION` 并在 `upgrade` 里创建；不迁移旧消息。

## Token 用量与费用

`services/chat/cost.ts` 内置 DeepSeek 官方价格（元/百万 tokens），按消息 `createdAt` 判断北京时间峰谷（周一至周五 9-12、14-18 为高峰，其余减半），搜索与抓取按每 1000 次 5 元。

- `getRoundUsage`：单条回复的 token 与费用；`getSessionUsage`：整个会话累加。
- 展示在 `components/messages/UsageBadge.tsx`：回复工具栏常驻一条，会话标题栏显示总计。
- 单条消息的 `usage` 只记录**最后一次请求**，续写后不会累加，这是已知限制。

## 导入与合并

导入不再覆盖本地记录，`services/chat/history/merge.ts` 做三方比较：

- `sessionFingerprint`：当前可见分支的内容指纹，忽略工具 ID、签名和用量。
- `mergeImportedSession`：新增 / 跳过 / 更新 / 分支；本地与导入都相对上次导入有变化时，把导入的可见分支从分叉点接到本地对应消息的兄弟分支，保持本地当前选择。
- 根消息不同时作为独立会话新增（UI 不支持切换根分支）。

`db.commitImport` 在一个事务里读 `sessionsStaging`，写回 `sessions`、`sessionSummaries`、`importBases`，只补缺失的 `files`，不清空本地数据；`commitStaging` 仍用于“清空全部对话”。基线在删除会话或清空历史时清理。

## 部署

`.github/workflows/pages.yml` 在 push `main` 时跑类型检查、lint、构建并发布到 GitHub Pages。构建产物使用相对资源路径（`publicPath: 'auto'`），可直接部署到子路径（站点地址 `https://bg5wiy.github.io/chat-demo/`）。
