/**
 * The view's copy, in both dictionaries.
 *
 * The namespace is merged into the slot package's LocaleNamespaceMap so ctx.locale.register accepts
 * it and the tab label's translate call is typed. User-facing labels are the only place Chinese is
 * allowed in a committed file (AGENTS.md rule 2), and en is typed against zh's key set so the two
 * dictionaries cannot drift.
 * @module dsh-plugin-workspace-diff/client/locales
 */

/** The locale namespace this view owns. */
export const NS = 'workspaceDiff'

/** Chinese copy. */
export const zh = {
  'view.label': '工作区改动',
  'actions.refresh': '刷新',
  'list.empty': '没有未提交的改动',
  'tree.expand': '展开目录',
  'tree.collapse': '收起目录',
  'diff.empty': '没有可显示的差异文本',
  'diff.truncated': '差异过大，只显示了末尾部分',
  'diff.wrap': '自动换行',
  'diff.nowrap': '不换行',
  'diff.wrapAria': '切换自动换行',
  'diff.copy': '复制',
  'diff.copied': '已复制',
  'diff.collapse': '收起',
  'diff.collapseAria': '收起差异',
  'diff.expand': '展开',
  'diff.expandAria': '展开差异',
  'diff.filesOne': '1 个文件',
  'diff.filesOther': '个文件',
  'state.loading': '读取中…',
  'state.notARepo': '这个工作区不是 git 仓库',
  'state.noGit': '找不到 git',
  'state.noCwd': '这个会话没有工作目录',
  'state.truncated': '改动列表太长，已被截断',
  'state.notInRepo': '这个文件不在改动列表里',
  'state.tooLarge': '文件太大，拒绝读取差异',
  'state.binary': '二进制文件，没有文本差异',
  'state.unknown': '读取失败',
  'meta.unborn': '仓库还没有提交',
} as const

/** English copy, with the same keys as zh. */
export const en: Record<keyof typeof zh, string> = {
  'view.label': 'Changes',
  'actions.refresh': 'Refresh',
  'list.empty': 'No uncommitted changes',
  'tree.expand': 'Expand directory',
  'tree.collapse': 'Collapse directory',
  'diff.empty': 'No diff text to show',
  'diff.truncated': 'The diff is too large — only its tail is shown',
  'diff.wrap': 'Wrap lines',
  'diff.nowrap': 'No wrap',
  'diff.wrapAria': 'Toggle line wrapping',
  'diff.copy': 'Copy',
  'diff.copied': 'Copied',
  'diff.collapse': 'Collapse',
  'diff.collapseAria': 'Collapse the diff',
  'diff.expand': 'Expand',
  'diff.expandAria': 'Expand the diff',
  'diff.filesOne': '1 file',
  'diff.filesOther': 'files',
  'state.loading': 'Loading…',
  'state.notARepo': 'This workspace is not a git repository',
  'state.noGit': 'git was not found',
  'state.noCwd': 'This session has no working directory',
  'state.truncated': 'The change list is too large and was truncated',
  'state.notInRepo': 'That file is not in the change list',
  'state.tooLarge': 'The file is too large to diff',
  'state.binary': 'Binary file — no text diff',
  'state.unknown': 'Could not read the workspace',
  'meta.unborn': 'The repository has no commits yet',
}

/** Every key this namespace can translate. */
export type WorkspaceDiffKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workspace-diff view copy. */
    workspaceDiff: WorkspaceDiffKey
  }
}
