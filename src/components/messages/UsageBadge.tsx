import { useTranslate } from '../../i18n/index.js'
import { getRoundUsage, getSessionUsage, type UsageSummary } from '../../services/chat/cost.js'
import type { AssistantMessage, Message } from '../../services/chat/types.js'
import { Tooltip } from '../base/Tooltip.js'
import styles from './UsageBadge.module.css'

/** 上万 token 折成 k，避免工具栏被长数字撑开。 */
const formatTokens = (value: number) =>
  value >= 10_000 ? `${(value / 1000).toFixed(1)}k` : String(value)

/** 单轮费用常常不足一分钱，按量级保留小数位。 */
const formatCost = (value: number) =>
  `¥${value < 0.01 ? value.toFixed(4) : value < 1 ? value.toFixed(3) : value.toFixed(2)}`

const UsageBadge = ({ summary, label }: { summary: UsageSummary; label?: string }) => {
  const t = useTranslate()
  const toolCount = summary.search + summary.fetch
  return (
    <Tooltip
      content={
        <div className={styles.detail}>
          <div>
            {t('usageInput')} {summary.cacheMiss + summary.cacheHit} · {t('usageCacheHit')}{' '}
            {summary.cacheHit}
          </div>
          <div>
            {t('usageOutput')} {summary.output}
          </div>
          {summary.search > 0 ? (
            <div>
              {t('usageSearch')} ×{summary.search}
            </div>
          ) : null}
          {summary.fetch > 0 ? (
            <div>
              {t('usageFetch')} ×{summary.fetch}
            </div>
          ) : null}
          <div className={styles.note}>
            {t('usageEstimate')}
            {summary.peak === undefined
              ? null
              : ` · ${t(summary.peak ? 'usagePeak' : 'usageOffPeak')}`}
          </div>
        </div>
      }
    >
      <span className={styles.badge}>
        {label ? <span className={styles.label}>{label}</span> : null}
        {formatTokens(summary.tokens)} tokens · {formatCost(summary.cost)}
        {toolCount > 0 ? ` · ${t('usageSearchCost')} ${formatCost(summary.toolCost)}` : null}
      </span>
    </Tooltip>
  )
}

/** 单轮回复结束后的 token 用量与费用。 */
export const RoundUsage = ({ message }: { message: AssistantMessage }) => {
  const summary = getRoundUsage(message)
  return summary ? <UsageBadge summary={summary} /> : null
}

/** 整个会话累加的 token 用量与费用。 */
export const SessionUsage = ({ messages }: { messages: Message[] }) => {
  const t = useTranslate()
  const summary = getSessionUsage(messages)
  return summary.tokens > 0 ? <UsageBadge summary={summary} label={t('usageSession')} /> : null
}
