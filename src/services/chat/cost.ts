import type { ChatModel } from '../api/types.js'
import type { AssistantMessage, Message } from './types.js'

/**
 * 模型价格（元 / 百万 tokens），来自 DeepSeek 官方价格页：
 * https://api-docs.deepseek.com/zh-cn/quick_start/pricing/
 * 表中为高峰时段单价，空闲时段按官方规则减半。
 */
const MODEL_PRICES: Record<ChatModel, { cacheHit: number; cacheMiss: number; output: number }> = {
  'deepseek-flash': { cacheHit: 0.04, cacheMiss: 2, output: 8 },
  'deepseek-v4-pro': { cacheHit: 0.3, cacheMiss: 9, output: 27 },
}

/** 联网搜索与网页抓取：每 1000 次 5 元。 */
const WEB_TOOL_PRICE = 5 / 1000

/** 旧消息没有记录模型，按默认模型估算。 */
const DEFAULT_MODEL: ChatModel = 'deepseek-flash'

/**
 * 北京时间周一至周五 9:00-12:00、14:00-18:00 为高峰时段，其余为空闲时段。
 * 官方还会排除法定节假日，这里只看星期和小时，节假日会被按高峰价估算。
 */
const isPeak = (at: number): boolean => {
  const date = new Date(at + 8 * 60 * 60 * 1000)
  const day = date.getUTCDay()
  const hour = date.getUTCHours()
  return day >= 1 && day <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
}

export type UsageSummary = {
  /** 本轮的输入（含缓存读写）与输出 token 总数。 */
  tokens: number
  /** 未命中缓存的输入。 */
  cacheMiss: number
  /** 命中缓存的输入。 */
  cacheHit: number
  output: number
  /** 联网搜索调用次数。 */
  search: number
  /** 网页抓取调用次数。 */
  fetch: number
  tokenCost: number
  /** 搜索与抓取费用。 */
  toolCost: number
  cost: number
  /** 仅单轮有值：该轮请求是否处于高峰时段。 */
  peak?: boolean
}

/** 单轮回复的用量与费用；没有 usage 的旧消息返回 null。 */
export const getRoundUsage = (message: AssistantMessage): UsageSummary | null => {
  if (!message.usage) {
    return null
  }
  const { input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens } =
    message.usage
  const price = MODEL_PRICES[message.model ?? DEFAULT_MODEL]
  const peak = isPeak(message.createdAt)
  const factor = (peak ? 1 : 0.5) / 1_000_000
  let search = 0
  let fetch = 0
  for (const block of message.blocks) {
    if (block.type === 'server_tool_use') {
      if (block.name === 'deepseek_web_search') {
        search += 1
      } else {
        fetch += 1
      }
    }
  }
  // 服务端只区分缓存命中与未命中，创建缓存的部分按未命中价格计费。
  const tokenCost =
    (cache_read_input_tokens * price.cacheHit +
      (input_tokens + cache_creation_input_tokens) * price.cacheMiss +
      output_tokens * price.output) *
    factor
  const toolCost = (search + fetch) * WEB_TOOL_PRICE
  return {
    tokens: input_tokens + cache_creation_input_tokens + cache_read_input_tokens + output_tokens,
    cacheMiss: input_tokens,
    cacheHit: cache_read_input_tokens,
    output: output_tokens,
    search,
    fetch,
    tokenCost,
    toolCost,
    cost: tokenCost + toolCost,
    peak,
  }
}

/** 汇总一个会话内所有回复的用量与费用。 */
export const getSessionUsage = (messages: Message[]): UsageSummary => {
  const total: UsageSummary = {
    tokens: 0,
    cacheMiss: 0,
    cacheHit: 0,
    output: 0,
    search: 0,
    fetch: 0,
    tokenCost: 0,
    toolCost: 0,
    cost: 0,
  }
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue
    }
    const round = getRoundUsage(message)
    if (!round) {
      continue
    }
    total.tokens += round.tokens
    total.cacheMiss += round.cacheMiss
    total.cacheHit += round.cacheHit
    total.output += round.output
    total.search += round.search
    total.fetch += round.fetch
    total.tokenCost += round.tokenCost
    total.toolCost += round.toolCost
    total.cost += round.cost
  }
  return total
}
