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
  'page.title': 'Board',
  'page.count': '{count} 个会话',
  'new.title': '新对话',
  'new.failed': '无法新建对话',
  'workspace.choose': '选择工作区',
  'workspace.default': '默认工作区',
  'workspace.title': '选择工作区',
  'workspace.search': '搜索工作区',
  'workspace.empty': '没有匹配的工作区',
  'workspace.attachments': '先移除附件再切换工作区',
  'settings.open': '看板设置',
  'settings.recent': '最近范围',
  'settings.day': '最近 {n} 天',
  'settings.days': '最近 {n} 天',
  'search.open': '搜索会话',
  'search.title': '搜索会话',
  'search.placeholder': '按标题搜索会话',
  'search.empty': '没有匹配的会话',
  'preview.back': '返回看板',
  'preview.close': '关闭',
  'preview.openPage': '完整会话',
  'preview.openSession': '打开会话',
  'preview.failed': '无法打开会话',
  'preview.unavailable': '无法加载会话视图',
  'state.loading': '正在读取会话…',
  'pinned.title': '置顶',
  'pin.add': '置顶会话',
  'pin.remove': '取消置顶',
  'pin.failed': '无法更新置顶',
  'column.running': '运行中',
  'column.unread': '未读',
  'column.recent': '最近',
  'column.running.empty': '没有正在运行的会话',
  'column.unread.empty': '没有未读会话',
  'column.recent.empty': '没有最近会话',
  'card.running': '正在运行',
  'card.completed': '完成但未读',
  'card.idle': '空闲',
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
  'page.title': 'Board',
  'page.count': '{count} sessions',
  'new.title': 'New conversation',
  'new.failed': 'Could not start a new conversation',
  'workspace.choose': 'Choose workspace',
  'workspace.default': 'Default workspace',
  'workspace.title': 'Choose workspace',
  'workspace.search': 'Search workspaces',
  'workspace.empty': 'No matching workspaces',
  'workspace.attachments': 'Remove attachments before switching workspaces',
  'settings.open': 'Board settings',
  'settings.recent': 'Recent window',
  'settings.day': 'Last {n} day',
  'settings.days': 'Last {n} days',
  'search.open': 'Search sessions',
  'search.title': 'Search sessions',
  'search.placeholder': 'Search sessions by title',
  'search.empty': 'No matching sessions',
  'preview.back': 'Back to board',
  'preview.close': 'Close',
  'preview.openPage': 'Full conversation',
  'preview.openSession': 'Open session',
  'preview.failed': 'Could not open the session',
  'preview.unavailable': 'Conversation view unavailable',
  'state.loading': 'Loading sessions…',
  'pinned.title': 'Pinned',
  'pin.add': 'Pin session',
  'pin.remove': 'Unpin session',
  'pin.failed': 'Could not update the pin',
  'column.running': 'Running',
  'column.unread': 'Unread',
  'column.recent': 'Recent',
  'column.running.empty': 'No running sessions',
  'column.unread.empty': 'Nothing unread',
  'column.recent.empty': 'No recent sessions',
  'card.running': 'Running',
  'card.completed': 'Finished, unread',
  'card.idle': 'Idle',
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
