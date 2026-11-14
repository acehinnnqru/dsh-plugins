/**
 * The searchable Workspace selector shown in the new-conversation overlay's hero row.
 *
 * The native hero chip lists Workspaces without a filter. This entry takes its seat instead: it
 * publishes nothing outside the overlay, reads the open overlay's chooser from the module bridge,
 * and anchors a lightweight menu under the chip. The menu owns a search field so the registry can be
 * filtered by name or path; picking one asks the page to move the blank Session without leaving the
 * overlay.
 * @module dsh-plugin-session-manager/client/workspace-picker
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconSearchOutlineRegular,
  Input,
  MenuSurface,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: each carries the declaration merges for the hero options row and the global hooks.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { NS } from './locales.ts'
import { NodePicker } from './NodePicker.tsx'
import { activeChooseNode, activePrepareNode, subscribeChooseNode, subscribePrepareNode, type ChooseNode, type PrepareNode } from './node-choice.ts'
import { sessionNodeOf, type SessionNode } from './board.ts'
import {
  activeChooseWorkspace,
  subscribeChooseWorkspace,
  type ChooseWorkspace,
} from './workspace-choice.ts'
import {
  DEFAULT_WORKSPACE_TITLE,
  compactDirectory,
  matchWorkspaces,
  workspaceLabel,
} from './workspace-search.ts'
import css from './SessionBoard.module.css'

/** Session standard props for the hero's options row plus this plugin's copy. */
type WorkspacePickerProps = PropsRuntime<'conversation.hero.options'> & PropsLocale<typeof NS>

/** Props of the mounted picker, once the overlay published a chooser. */
interface WorkspacePickerBodyProps extends WorkspacePickerProps {
  readonly choose: ChooseWorkspace
  readonly chooseNode: ChooseNode
  readonly prepareNode: PrepareNode | undefined
}

/**
 * Render the picker only while the new-conversation overlay is open.
 *
 * The same hero options row exists on the main new-session page; returning nothing there keeps the
 * native Workspace chip (and that page's layout) untouched.
 * @param props - session standard props and copy.
 * @returns the picker, or null outside the overlay.
 */
export function WorkspacePicker(props: WorkspacePickerProps): ReactNode {
  const choose = useSyncExternalStore(subscribeChooseWorkspace, activeChooseWorkspace)
  const chooseNode = useSyncExternalStore(subscribeChooseNode, activeChooseNode)
  const prepareNode = useSyncExternalStore(subscribePrepareNode, activePrepareNode)
  return choose === undefined || chooseNode === undefined
    ? null
    : <WorkspacePickerBody {...props} choose={choose} chooseNode={chooseNode} prepareNode={prepareNode} />
}

/**
 * Render the chip and its anchored workspace menu.
 * @param props - session standard props, copy, and the overlay's chooser.
 * @returns the trigger and, while open, the menu.
 */
function WorkspacePickerBody({
  sessionId,
  choose,
  chooseNode,
  prepareNode,
  useSessions,
  useWorkspaces,
  t,
}: WorkspacePickerBodyProps): ReactNode {
  const workspaces = useWorkspaces((state) => state)
  const sessions = useSessions((state) => state)
  const session = sessions.byId[sessionId]
  const current = workspaces.items.find((workspace) => workspace.sessionIds.includes(sessionId))
    ?? workspaces.items.find((workspace) => session !== undefined && workspace.path === session.cwd)
  const currentOwner = sessionNodeOf(sessions, sessionId)
  const [directory, setDirectory] = useState<readonly SessionNode[]>([])
  useEffect(() => {
    let live = true
    void fetch('/api/session-manager/nodes', { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return
        const value = await response.json() as { readonly nodes?: readonly unknown[] }
        if (!Array.isArray(value.nodes)) return
        const next: SessionNode[] = []
        for (const item of value.nodes) {
          if (typeof item !== 'object' || item === null) continue
          const row = item as { readonly nodeId?: unknown; readonly name?: unknown; readonly self?: unknown; readonly instanceId?: unknown }
          if (typeof row.name !== 'string' || row.name.length === 0) continue
          const self = row.self === true
          next.push({
            id: typeof row.nodeId === 'string' && row.nodeId.length > 0 ? row.nodeId : undefined,
            name: self ? 'self' : row.name,
            self,
            ...(typeof row.instanceId === 'string' && row.instanceId.length > 0 ? { instanceId: row.instanceId } : {}),
          })
        }
        if (live) setDirectory(next)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  const nodeMap = new Map<string, SessionNode>()
  nodeMap.set('self', { id: undefined, name: 'self', self: true })
  for (const node of directory) nodeMap.set(node.self ? 'self' : node.id ?? ('name:' + node.name), node)
  for (const id of sessions.ids) {
    const owner = sessionNodeOf(sessions, id)
    nodeMap.set(owner.self ? 'self' : owner.id ?? ('name:' + owner.name), owner)
  }
  nodeMap.set(currentOwner.self ? 'self' : currentOwner.id ?? ('name:' + currentOwner.name), currentOwner)
  const nodes = [...nodeMap.values()]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const picking = useRef(false)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const items = matchWorkspaces(workspaces.items, query)
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))
  const placement = useAnchoredPosition({
    open,
    anchorRef: trigger,
    panelRef: panel,
    side: 'bottom',
    align: 'start',
    gap: 6,
    margin: 12,
  })
  const positioned = placement !== null
  useDismissOnOutsidePointer(root, open, setOpen)

  // The menu owns the keyboard while it is open; the search field takes it first. Wait for the
  // anchored position: the panel starts hidden until it is measured, and hidden elements cannot
  // take focus.
  useEffect(() => {
    if (open && positioned) search.current?.focus()
  }, [open, positioned])

  // Keep the arrow-key highlight visible in a long registry.
  useEffect(() => {
    if (!open) return
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const label = (workspace: WorkspaceView): string => {
    const raw = workspaceLabel(workspace)
    return raw === DEFAULT_WORKSPACE_TITLE ? t('workspace.default') : raw
  }
  const currentLabel = current === undefined ? t('workspace.choose') : label(current)

  /**
   * Ask the page to move the blank Session, keeping the menu open on failure.
   * @param workspaceId - chosen Workspace.
   */
  async function pick(workspaceId: WorkspaceId): Promise<void> {
    if (picking.current) return
    picking.current = true
    setBusy(true)
    setError(undefined)
    try {
      const failure = await choose(sessionId, workspaceId)
      if (failure !== undefined) {
        setError(failure)
        return
      }
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      picking.current = false
      setBusy(false)
    }
  }

  /** Toggle the menu, resetting the query and selection when it opens. */
  function toggle(): void {
    if (open) {
      setOpen(false)
      return
    }
    setQuery('')
    setActive(0)
    setError(undefined)
    setOpen(true)
  }

  /**
   * Keep the caret in the search field while the arrow keys walk the filtered rows.
   * @param event - key event on the search input.
   */
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, Math.max(items.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = items[activeIndex]
      if (target !== undefined) void pick(target.workspaceId)
    }
  }

  /**
   * Close the menu on Escape before the modal layer sees the event.
   * @param event - key event bubbling from the search field or a row.
   */
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }

  const panelStyle: CSSProperties = placement === null
    ? { position: 'fixed', visibility: 'hidden' }
    : { position: 'fixed', left: placement.left, top: placement.top }

  return (
    <>
      <NodePicker
        nodes={nodes}
        current={currentOwner}
        t={t}
        onPick={(node) => chooseNode(sessionId, node)}
        {...(prepareNode === undefined ? {} : { onPrepare: prepareNode })}
      />
      <span ref={root} className={css.workspacePicker}>
      <button
        ref={trigger}
        type="button"
        className={css.workspaceTrigger}
        data-session-manager-workspace="true"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={currentLabel}
        onClick={toggle}
      >
        {current === undefined
          ? <IconFolderCloseRegular size={16} className={css.workspaceTriggerIcon} />
          : <IconFolderOpenRegular size={16} className={css.workspaceTriggerIcon} />}
        <span className={css.workspaceTriggerLabel}>{currentLabel}</span>
        <IconChevronDownOutlineRegular size={12} className={css.workspaceTriggerChevron} />
      </button>

      {open && (
        <MenuSurface
          ref={panel}
          className={css.workspaceMenu ?? ''}
          style={panelStyle}
          role="dialog"
          aria-label={t('workspace.title')}
          onKeyDownCapture={onMenuKeyDown}
        >
          <div className={css.workspaceSearch}>
            <Input
              ref={search}
              className={css.workspaceSearchInput ?? ''}
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value)
                setActive(0)
              }}
              onKeyDown={onSearchKeyDown}
              placeholder={t('workspace.search')}
              aria-label={t('workspace.search')}
              icon={<IconSearchOutlineRegular size={16} />}
              spellCheck={false}
              autoComplete="off"
            />
          </div>

          <ul ref={list} className={css.workspaceList} role="listbox" aria-label={t('workspace.title')}>
            {items.map((workspace, index) => {
              const selected = workspace.workspaceId === current?.workspaceId
              const directory = compactDirectory(workspace.path)
              return (
                <li key={workspace.workspaceId} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-active={index === activeIndex ? 'true' : undefined}
                    className={css.workspaceRow}
                    disabled={busy}
                    onClick={() => {
                      void pick(workspace.workspaceId)
                    }}
                  >
                    <IconFolderCloseRegular size={14} className={css.workspaceRowIcon} />
                    <span className={css.workspaceRowText}>
                      <span className={css.workspaceRowTitle}>{label(workspace)}</span>
                      {directory !== '' && (
                        <span className={css.workspaceRowPath} title={workspace.path}>
                          {directory}
                        </span>
                      )}
                    </span>
                    {selected && (
                      <IconCheckOutlineRegular size={14} className={css.workspaceRowCheck} />
                    )}
                  </button>
                </li>
              )
            })}
            {items.length === 0 && (
              <li className={css.workspaceEmpty} role="presentation">{t('workspace.empty')}</li>
            )}
          </ul>

          {error !== undefined && (
            <p className={css.workspaceError} role="alert">{error}</p>
          )}
        </MenuSurface>
      )}
      </span>
    </>
  )
}
