/**
 * The return control in the real Session header.
 *
 * It renders only while the Session page was reached from the board. The control sits in the
 * product's own leading seat, before the Session title, so the rest of the header, the Conversation
 * views, and any user customization stay intact.
 * @module dsh-plugin-session-manager/client/back-to-board-control
 */

import { useEffect, useState, type ReactNode } from 'react'
import { IconChevronLeftOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { backToBoardArmed, subscribeBackToBoard } from './back-to-board.ts'
import css from './BackToBoard.module.css'

/** Props supplied by the action slot: the bound translate seat and the board transition. */
export interface BackToBoardProps {
  readonly t: (key: 'preview.back') => string
  readonly goBack: () => void
}

/**
 * Render a compact return-to-board button while the marker is armed.
 * @param props - translate seat and the callback that selects the board panel.
 * @returns the button, or nothing when the page was not reached from the board.
 */
export function BackToBoard({ t, goBack }: BackToBoardProps): ReactNode {
  const [armed, setArmed] = useState(backToBoardArmed)

  useEffect(() => subscribeBackToBoard(() => {
    setArmed(backToBoardArmed())
  }), [])

  if (!armed) return null

  return (
    <button
      type="button"
      className={css.back}
      aria-label={t('preview.back')}
      title={t('preview.back')}
      onClick={goBack}
    >
      <IconChevronLeftOutlineRegular size={16} />
    </button>
  )
}
