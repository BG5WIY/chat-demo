# AGENTS.md

Static chat demo built on the DeepSeek API: the browser calls `https://api.deepseek.com` directly, with no application backend. React 18 + rspack + TypeScript + Zustand + IndexedDB, deployed to GitHub Pages.

## Commands

| Command       | Purpose                       |
| ------------- | ----------------------------- |
| `pnpm dev`    | Dev server on port 8090       |
| `pnpm build`  | Production build into `dist/` |
| `pnpm type`   | TypeScript type check         |
| `pnpm lint`   | oxlint                        |
| `pnpm format` | oxfmt formatting              |

Run `pnpm type` after any change; run `pnpm lint` and `pnpm build` before committing. There is no test framework. For pure logic (`history/merge.ts`, `chat/cost.ts`), a temporary compile with `tsc --ignoreConfig --outDir .tmp-test` plus a small `.mjs` assertion script is fine; delete it afterwards and never commit scratch files.

## Layout

```text
src/
  app/              layout, theme, viewport
  components/       UI (base / chatInput / messages / search / session / settings / sider)
  i18n/             zh + en strings
  services/
    api/            Anthropic-compatible Messages / Files / SSE and protocol types
    chat/           sessions, message branches, IndexedDB, drafts, history import/export
    markdown/       parsing, highlighting, KaTeX, Mermaid
    speech/         recording and read-aloud
  utils/            shared helpers (id, date format, clipboard)
```

## Conventions

- Strict TypeScript: `strict`, `noUnusedLocals`, `noUnusedParameters`. Do not use `any`.
- Source imports always use a `.js` suffix (resolved to the matching `.ts` / `.tsx` by rspack's `extensionAlias`).
- Add every new string to both `i18n/zh.ts` and `i18n/en.ts`; `en.ts` uses `satisfies Record<keyof typeof zh, string>` to enforce coverage.
- Use CSS Modules. Colors and fonts come from the `--dsw-*` variables in `theme.css`; never hardcode them.
- The build target says chrome 105 / safari 16 / firefox 110, but existing code already uses newer APIs such as `toSorted`. Follow the existing style; do not add polyfills.
- Never commit `dist/` or `node_modules/`. The API Key lives only in localStorage.

## Session and message model

`Session.messages` holds **all branches**, not a linear list. The visible path is determined by `rootMessageId` plus each message's `selectedChildId`; when `selectedChildId` is absent the highest ID wins. All helpers live in `services/chat/branches.ts`:

- `normalizeSession`: converts an old linear session into a single-branch tree.
- `getVisibleMessages`: the path shared by rendering and request context.
- `buildMessageVersions`: sibling messages under the same `parentId` form a version group, driving `BranchSwitcher`.
- `appendBranch` / `selectVersion`: add a branch and switch versions.

Message types live in `services/chat/types.ts`: user messages carry `files`; replies use `blocks` (`thinking` / `text` / `server_tool_use` / `web_search_tool_result` / `web_fetch_tool_result`). Streaming events are merged by `applyEvent` in `services/chat/reply.ts`.

## Storage

IndexedDB is wrapped by `idb` in `services/chat/db.ts`:

- `sessions` / `sessionSummaries` (the list reads only summaries) / `files` (attachment originals).
- `sessionsStaging` / `filesStaging`: staging for imports, cleared after commit or failure.
- `importBases`: content fingerprint of each imported session's last import.
- Any storage change requires bumping `DB_VERSION` and creating the store in `upgrade`. Old messages are not migrated.

## Token usage and cost

`services/chat/cost.ts` embeds the official DeepSeek prices (CNY per million tokens), picks peak/off-peak by the message `createdAt` in Beijing time (Mon-Fri 09:00-12:00 and 14:00-18:00 are peak, everything else is half price), and bills search/fetch at CNY 5 per 1000 calls.

- `getRoundUsage`: tokens and cost for one reply; `getSessionUsage`: totals across a session.
- Rendered by `components/messages/UsageBadge.tsx`: a persistent line in the reply toolbar and totals in the session header.
- A message's `usage` only records its **last request**; it is not accumulated across continuations. This is a known limitation.

## Import and merge

Imports no longer replace local data. `services/chat/history/merge.ts` performs a three-way comparison:

- `sessionFingerprint`: fingerprint of the visible branch, ignoring tool IDs, signatures and usage.
- `mergeImportedSession`: added / skipped / updated / merged. When both local and imported content changed since the last import, the imported visible branch is attached as sibling branches from the divergence point, keeping the local selection.
- When the root messages differ there is no shared parent (the UI cannot switch root branches), so the import is added as a separate session.

`db.commitImport` reads `sessionsStaging` in one transaction, writes back `sessions`, `sessionSummaries` and `importBases`, adds only missing `files`, and never clears local data. `commitStaging` is still used by "delete all chats". Baselines are removed when a session is deleted or history is cleared.

## Deployment

`.github/workflows/pages.yml` type-checks, lints, builds and publishes to GitHub Pages on every push to `main`. Output uses relative asset paths (`publicPath: 'auto'`), so it works under a subpath (site: `https://bg5wiy.github.io/chat-demo/`).
