import { getVisibleMessages, normalizeSession } from '../branches.js'
import type { Message, ReplyBlock, Session } from '../types.js'
import { createId } from '../../../utils/id.js'

/** 导入结果分类：新增、本地未改动时更新、冲突时作为分支、内容相同跳过。 */
export type ImportAction = 'added' | 'updated' | 'merged' | 'skipped'
export type ImportStats = Record<ImportAction, number>

export type MergedSession = { session: Session; action: ImportAction }

/** 64 位 FNV-1a，仅用于比较版本是否变化，不参与安全校验。 */
const hash = (text: string): string => {
  let a = 0x811c9dc5
  let b = 0xcbf29ce4
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    a ^= code
    a = Math.imul(a, 0x01000193)
    b ^= code
    b = Math.imul(b, 0x9e3779b1)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

/** 内容块的身份：忽略工具调用 ID、签名、用量等会因导出批次变化而不稳定的字段。 */
const blockKey = (block: ReplyBlock): string => {
  switch (block.type) {
    case 'text':
      return `t:${block.text}`
    case 'thinking':
      return `k:${block.thinking}`
    case 'server_tool_use':
      return `c:${block.name}:${JSON.stringify(block.input)}`
    case 'web_search_tool_result':
      return `s:${block.content
        .map((item) =>
          item.type === 'web_search_result'
            ? `${item.url}|${item.title}|${item.snippet}`
            : item.error_code
        )
        .join(';')}`
    case 'web_fetch_tool_result':
      return `f:${
        block.content.type === 'web_fetch_result'
          ? block.content.url
          : block.content.error_code
      }`
  }
}

const messageKey = (message: Message): string =>
  message.role === 'user'
    ? `u:${message.content}:${message.files.map((file) => `${file.name}:${file.size}`).join(',')}`
    : `a:${message.blocks.map(blockKey).join('\u00a7')}`

/** 会话当前可见分支的内容指纹。 */
export const sessionFingerprint = (session: Session): string =>
  hash(getVisibleMessages(normalizeSession(session)).map(messageKey).join('\n'))

const visiblePath = (session: Session) => getVisibleMessages(normalizeSession(session))

/**
 * 把导入会话的可见分支接到本地会话的分叉点后面：
 * 共同前缀保持不变，导入版本从第一条不同消息起成为本地对应消息的兄弟分支，
 * 本地的当前选择不改变；本地在分叉点没有后续内容时才自动选中导入分支。
 */
const mergeAsBranch = (local: Session, imported: Session): MergedSession => {
  const normalized = normalizeSession(local)
  const localPath = visiblePath(normalized)
  const importedPath = visiblePath(imported)
  if (importedPath.length === 0) {
    return { session: local, action: 'skipped' }
  }
  if (localPath.length === 0) {
    return { session: { ...imported, title: local.title || imported.title }, action: 'updated' }
  }
  let common = 0
  while (
    common < localPath.length &&
    common < importedPath.length &&
    messageKey(localPath[common]) === messageKey(importedPath[common])
  ) {
    common += 1
  }
  if (common === importedPath.length) {
    return { session: local, action: 'skipped' }
  }
  // 根消息不同时没有可共用的父节点，UI 也不支持切换根分支，作为独立会话保留。
  if (common === 0) {
    return { session: { ...imported, id: createId() }, action: 'added' }
  }
  const parent = localPath[common - 1]
  const ids = importedPath.slice(common).map(() => createId())
  const messages = normalized.messages.map((message) =>
    message.id === parent.id && common === localPath.length
      ? { ...message, selectedChildId: ids[0] }
      : message
  )
  importedPath.slice(common).forEach((source, index) => {
    messages.push({
      ...source,
      id: ids[index],
      parentId: index === 0 ? parent.id : ids[index - 1],
      selectedChildId: ids[index + 1],
    } as Message)
  })
  return {
    session: {
      ...normalized,
      title: local.title || imported.title,
      updatedAt: Math.max(local.updatedAt, imported.updatedAt),
      messages,
    },
    action: 'merged',
  }
}

/**
 * 三方合并：本地没有则新增；内容相同跳过；本地未改动则更新；
 * 导入版本没变化则保留本地；双方都改动时把导入内容作为消息分支存入同一会话。
 */
export const mergeImportedSession = (
  local: Session | undefined,
  imported: Session,
  base: string | undefined
): MergedSession => {
  if (!local) {
    return { session: imported, action: 'added' }
  }
  const localHash = sessionFingerprint(local)
  const importedHash = sessionFingerprint(imported)
  if (localHash === importedHash || importedHash === base) {
    return { session: local, action: 'skipped' }
  }
  if (localHash === base) {
    return {
      session: {
        ...imported,
        title: local.title || imported.title,
        createdAt: local.createdAt,
        updatedAt: Math.max(local.updatedAt, imported.updatedAt),
      },
      action: 'updated',
    }
  }
  return mergeAsBranch(local, imported)
}
