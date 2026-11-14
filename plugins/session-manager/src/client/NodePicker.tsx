/**
 * The node chip shown before the Workspace chip in the new-conversation hero.
 *
 * It changes which node owns the blank Session without leaving the overlay. The
 * page creates the replacement blank through the bridge; this control only
 * collects the choice and reports a failure. The menu is a normal anchored
 * surface, so it is positioned with the same primitive the Workspace picker uses.
 * @module dsh-plugin-session-manager/client/node-picker
 */

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import {
  IconApiOutlineRegular,
  IconCheckOutlineRegular,
  IconChevronDownOutlineRegular,
  MenuSurface,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionNode } from './board.ts'
import { NS } from './locales.ts'
import css from './SessionBoard.module.css'

/** One stable key for a node option. */
function keyOf(node: SessionNode): string {
  return node.self ? 'self' : node.id ?? ('name:' + node.name)
}

/** One node label: `self` for this host, otherwise the node name. */
function labelOf(node: SessionNode): string {
  return node.self ? 'self' : node.name
}

/** Props of the node chip. */
export interface NodePickerProps {
  readonly nodes: readonly SessionNode[]
  readonly current: SessionNode
  readonly t: PropsLocale<typeof NS>['t']
  readonly onPick: (node: SessionNode) => Promise<string | undefined>
  /** Warm the target node while the pointer or focus previews it. */
  readonly onPrepare?: (node: SessionNode) => void
}

/**
 * Render the chip and its anchored node menu.
 * @param props - available nodes, the current owner, copy, and the picker callback.
 * @returns the chip and, while open, the menu.
 */
export function NodePicker({ nodes, current, t, onPick, onPrepare }: NodePickerProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const root = useRef<HTMLSpanElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const picking = useRef(false)
  const warm = useRef({ nodes, onPrepare })
  warm.current = { nodes, onPrepare }
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

  useEffect(() => {
    if (!open || !positioned) return
    panel.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
  }, [open, positioned])

  useEffect(() => {
    if (!open) return
    const firstRemote = warm.current.nodes.find((node) => !node.self)
    if (firstRemote !== undefined) warm.current.onPrepare?.(firstRemote)
  }, [open])

  /**
   * Ask the page to move the blank, keeping the menu open on failure.
   * @param node - the chosen node.
   */
  async function pick(node: SessionNode): Promise<void> {
    if (picking.current || (node.self ? current.self : node.id === current.id)) {
      setOpen(false)
      return
    }
    picking.current = true
    setBusy(true)
    setError(undefined)
    try {
      const failure = await onPick(node)
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

  /** Close the menu before the modal layer consumes Escape. */
  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'Escape' || event.shiftKey) return
    event.preventDefault()
    event.stopPropagation()
    setOpen(false)
    trigger.current?.focus()
  }

  const panelStyle: CSSProperties = placement === null
    ? { position: 'fixed', visibility: 'hidden', zIndex: 1100 }
    : { position: 'fixed', left: placement.left, top: placement.top, zIndex: 1100 }

  return (
    <span ref={root} className={css.nodePicker}>
      <button
        ref={trigger}
        type="button"
        className={css.nodeTrigger}
        data-session-manager-node="true"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={labelOf(current)}
        disabled={busy}
        onPointerDown={(event) => {
          event.stopPropagation()
        }}
        onClick={() => {
          setError(undefined)
          setOpen((value) => !value)
        }}
      >
        <IconApiOutlineRegular size={16} className={css.nodeTriggerIcon} />
        <span className={css.nodeTriggerLabel}>{busy ? '…' : labelOf(current)}</span>
        <IconChevronDownOutlineRegular size={12} className={css.nodeTriggerChevron} />
      </button>
      {open && (
        <MenuSurface
          ref={panel}
          className={css.nodeMenu ?? ''}
          style={panelStyle}
          role="dialog"
          aria-label={t('node.title')}
          onKeyDownCapture={onMenuKeyDown}
        >
          <div className={css.nodeMenuHead}>{t('node.title')}</div>
          <ul className={css.nodeList} role="listbox" aria-label={t('node.title')}>
            {nodes.map((node) => {
              const selected = node.self ? current.self : node.id === current.id
              return (
                <li key={keyOf(node)} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={css.nodeRow}
                    disabled={busy}
                    onPointerEnter={() => {
                      onPrepare?.(node)
                    }}
                    onFocus={() => {
                      onPrepare?.(node)
                    }}
                    onClick={() => {
                      void pick(node)
                    }}
                  >
                    <span className={css.nodeRowName}>{labelOf(node)}</span>
                    {selected && <IconCheckOutlineRegular size={14} />}
                  </button>
                </li>
              )
            })}
          </ul>
          {error !== undefined && <p className={css.nodeError} role="alert">{error}</p>}
        </MenuSurface>
      )}
    </span>
  )
}
