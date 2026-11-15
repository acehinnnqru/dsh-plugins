/**
 * Bounded full-list repairs for rows the event stream cannot add.
 *
 * Local rows arrive as `api-session/*` events, so the browser never polls the
 * list. Two cases still need one listing: a disposal frame removes a row the
 * Host keeps persisted, and rows owned by another node only enter through a
 * listing. Both are rare, so every repair shares one floor.
 * @module dsh-plugin-session-manager/client/list-repair
 */

/** Minimum spacing between two full listings. */
export const LIST_REPAIR_INTERVAL_MS = 30_000

/** Peer rows are re-read at this cadence while the board is open. */
export const PEER_LIST_INTERVAL_MS = 60_000

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
