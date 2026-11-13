/**
 * The leading controls in the real Session header.
 *
 * Two controls share the product's single leading seat, before the Session title: a return-to-board
 * arrow while the page was reached from the board, and a new-conversation button for the Session the
 * app currently shows. The new-conversation button starts a blank Session in that Session's
 * Workspace under its Agent preset, through the same Workspace navigation the native New Session
 * action uses.
 * @module dsh-plugin-session-manager/client/back-to-board-control
 */

import { useEffect, useState, type ReactNode } from 'react'
import { IconChevronLeftOutlineRegular, IconNewChatOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: declares the `mainView` reference source on the Session retain counts.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { backToBoardArmed, subscribeBackToBoard } from './back-to-board.ts'
import css from './BackToBoard.module.css'

/** The leading seat's standard props: the global Session and Workspace hooks plus copy. */
type HeaderProps = PropsRuntime<'conversation.header.leading'>

/** Props supplied by the action slot: copy, the board transition, and the new-Session action. */
export interface BackToBoardProps {
  readonly t: (key: 'preview.back' | 'new.title') => string
  readonly goBack: () => void
  /**
   * Start a Session in the named Workspace under the given Agent preset, or under the app's current
   * Workspace and the Host default when either is absent.
   */
  readonly startSession: (workspaceId: WorkspaceId | undefined, agentPreset: string | undefined) => void
  readonly useSessions: HeaderProps['useSessions']
  readonly useWorkspaces: HeaderProps['useWorkspaces']
}

/**
 * Render the header's leading controls.
 *
 * The visible conversation is the Session the Client retains as `mainView`; the leading seat is
 * root-scoped, so that retain count is how it finds the Session without a Session-scoped prop.
 * @param props - copy, the board transition, the new-Session action, and the global hooks.
 * @returns the controls, or nothing when neither applies.
 */
export function BackToBoard({
  t,
  goBack,
  startSession,
  useSessions,
  useWorkspaces,
}: BackToBoardProps): ReactNode {
  const [armed, setArmed] = useState(backToBoardArmed)
  const current = useSessions((state) =>
    Object.values(state.byId).find((row) => (row.retainedBy.mainView ?? 0) > 0))
  const workspaceId = useWorkspaces((state) => {
    if (current === undefined) return undefined
    return (state.items.find((item) => item.sessionIds.includes(current.id))
      ?? state.items.find((item) => current.cwd !== undefined && item.path === current.cwd))
      ?.workspaceId
  })

  useEffect(() => subscribeBackToBoard(() => {
    setArmed(backToBoardArmed())
  }), [])

  const listed = (current?.projectionValues as Record<string, unknown> | undefined)?.['agentPreset']
  const agentPreset = typeof listed === 'string' && listed !== '' ? listed : undefined
  const canStart = current !== undefined && !current.blank
  if (!armed && !canStart) return null

  return (
    <div className={css.group}>
      {armed && (
        <button
          type="button"
          className={css.back}
          aria-label={t('preview.back')}
          title={t('preview.back')}
          onClick={goBack}
        >
          <IconChevronLeftOutlineRegular size={16} />
        </button>
      )}
      {canStart && (
        <button
          type="button"
          className={css.newSession}
          aria-label={t('new.title')}
          title={t('new.title')}
          onClick={() => startSession(workspaceId, agentPreset)}
        >
          <IconNewChatOutlineRegular size={16} />
        </button>
      )}
    </div>
  )
}
