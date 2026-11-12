/**
 * This plugin's copy, in both dictionaries.
 *
 * The namespace is merged into the slot package's LocaleNamespaceMap so `ctx.locale.register`
 * accepts it and the framework-injected translate seat is typed. User-facing strings are the only
 * place Chinese is allowed in a committed file (AGENTS.md rule 2), and `en` is typed against
 * `zh`'s key set so the two dictionaries cannot drift.
 * @module dsh-plugin-session-manager/client/locales
 */

/** The locale namespace this plugin owns. */
export const NS = 'sessionManager'

/** Chinese copy. */
export const zh = {
  'panel.title': '会话管理',
  'page.title': '会话看板',
  'page.description': '按运行时状态看会话：正在运行、等待你输入、以及完成后还没看过的。打开一个会话就算已读，它会从看板消失。',
  'page.count': '{count} 个会话',
  'state.loading': '正在读取会话…',
  'state.empty': '暂时没有需要处理的会话',
  'state.emptyHint': '运行中、等待你输入或未读完成的会话会出现在这里。',
  'column.running': '运行中',
  'column.waiting': '等待输入',
  'column.completed': '已完成',
  'column.running.empty': '没有正在运行的会话',
  'column.waiting.empty': '没有等待输入的会话',
  'column.completed.empty': '没有未读的完成',
  'card.running': '正在运行',
  'card.completed': '完成但未读',
  'waiting.approval': '等待批准',
  'waiting.planReview': '计划待确认',
  'waiting.question': '等待回答',
  'waiting.input': '等待输入',
  'time.now': '刚刚',
  'time.minutes': '{n} 分钟前',
  'time.hours': '{n} 小时前',
  'time.days': '{n} 天前',
  'time.months': '{n} 个月前',
  'time.years': '{n} 年前',
} as const

/** English copy, with the same keys as zh. */
export const en: Record<keyof typeof zh, string> = {
  'panel.title': 'Session manager',
  'page.title': 'Session board',
  'page.description': 'Sessions by runtime state: running, waiting for you, and finished but unread. Opening one marks it read, so it leaves the board.',
  'page.count': '{count} sessions',
  'state.loading': 'Loading sessions…',
  'state.empty': 'Nothing needs attention',
  'state.emptyHint': 'Sessions that are running, waiting for you, or finished but unread appear here.',
  'column.running': 'Running',
  'column.waiting': 'Waiting for input',
  'column.completed': 'Completed',
  'column.running.empty': 'No running sessions',
  'column.waiting.empty': 'No sessions waiting for input',
  'column.completed.empty': 'No unread completions',
  'card.running': 'Running',
  'card.completed': 'Finished, unread',
  'waiting.approval': 'Waiting for approval',
  'waiting.planReview': 'Plan awaiting review',
  'waiting.question': 'Waiting for answer',
  'waiting.input': 'Waiting for input',
  'time.now': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} h ago',
  'time.days': '{n} d ago',
  'time.months': '{n} mo ago',
  'time.years': '{n} y ago',
}

/** Every key this namespace can translate. */
export type SessionManagerKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Session board copy. */
    sessionManager: SessionManagerKey
  }
}
