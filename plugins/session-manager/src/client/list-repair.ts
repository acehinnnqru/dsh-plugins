/**
 * Bounded full-list repairs for the one row the event stream cannot add back.
 *
 * Local and remote rows both arrive as `api-session/*` events, so the browser
 * never polls the list. The exception is a disposal frame: it removes a row the
 * Host still persists, so one listing restores it.
 * @module dsh-plugin-session-manager/client/list-repair
 */

/** Minimum spacing between two full listings. */
export const LIST_REPAIR_INTERVAL_MS = 30_000

/** Throttle for the full listings this client still needs. */
export class ListRepair {
  private last = Number.NEGATIVE_INFINITY

  /**
   * @param refresh - full listing request; the Session Controller runs it single-flight.
   * @param now - clock, injectable for tests.
   * @param minimumMs - floor between two requests.
   */
  constructor(
    private readonly refresh: () => Promise<unknown>,
    private readonly now: () => number = () => Date.now(),
    private readonly minimumMs: number = LIST_REPAIR_INTERVAL_MS,
  ) {}

  /**
   * Request one listing unless the floor has not elapsed.
   * @returns whether this call started a listing.
   */
  request(): boolean {
    const now = this.now()
    if (now - this.last < this.minimumMs) return false
    this.last = now
    void this.refresh().catch(() => {})
    return true
  }
}
