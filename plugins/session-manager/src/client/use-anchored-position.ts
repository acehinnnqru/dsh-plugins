/**
 * Anchor a fixed-position surface under (or above) a trigger.
 *
 * The rc.1 primitive that did this was removed from the client primitives package. The pickers only
 * need a clamped start-aligned placement, so keep that small contract here instead of pinning the
 * plugin to an older DSH.
 * @module dsh-plugin-session-manager/client/use-anchored-position
 */

import { useEffect, useState, type RefObject } from 'react'

/** One viewport-relative position for a fixed panel. */
export interface AnchoredPlacement {
  readonly left: number
  readonly top: number
}

/** The geometry the pickers request. */
export interface AnchoredPositionOptions {
  readonly open: boolean
  readonly anchorRef: RefObject<HTMLElement | null>
  readonly panelRef: RefObject<HTMLElement | null>
  readonly side: 'bottom' | 'top'
  readonly align: 'start' | 'end'
  readonly gap: number
  readonly margin: number
}

/**
 * Measure the trigger and panel after layout, then keep the panel inside the viewport.
 * @param options - open flag, refs, preferred side, alignment, gap, and viewport margin.
 * @returns the fixed position, or null until the open panel has been measured.
 */
export function useAnchoredPosition(options: AnchoredPositionOptions): AnchoredPlacement | null {
  const [placement, setPlacement] = useState<AnchoredPlacement | null>(null)

  useEffect(() => {
    if (!options.open) {
      setPlacement(null)
      return
    }
    const update = (): void => {
      const anchor = options.anchorRef.current
      const panel = options.panelRef.current
      if (anchor === null || panel === null) return
      const rect = anchor.getBoundingClientRect()
      const size = panel.getBoundingClientRect()
      const width = size.width
      const height = size.height
      const left = Math.max(
        options.margin,
        Math.min(
          options.align === 'end' ? rect.right - width : rect.left,
          window.innerWidth - width - options.margin,
        ),
      )
      let top = options.side === 'top' ? rect.top - height - options.gap : rect.bottom + options.gap
      if (options.side === 'bottom' && top + height > window.innerHeight - options.margin) {
        const above = rect.top - height - options.gap
        if (above >= options.margin) top = above
      } else if (options.side === 'top' && top < options.margin) {
        const below = rect.bottom + options.gap
        if (below + height <= window.innerHeight - options.margin) top = below
      }
      setPlacement({ left, top })
    }
    update()
    const frame = requestAnimationFrame(update)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : undefined
    if (observer !== undefined && options.panelRef.current !== null) observer.observe(options.panelRef.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer?.disconnect()
    }
  }, [options.open, options.anchorRef, options.panelRef, options.side, options.align, options.gap, options.margin])

  return placement
}
