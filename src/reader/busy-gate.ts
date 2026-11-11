// Holds back work (relayouts when page sizes arrive, refills when images load) while a page turn
// is running, so a preload never cuts a slide or flip short. Work is keyed: the latest job per key
// wins, and everything waiting runs once the turn has ended.

export class BusyGate {
  private waiting = new Map<unknown, () => void>();

  constructor(private busy: () => boolean) {}

  /** Runs `job` now, or after the running turn ends (replacing an older job with the same key). */
  run(key: unknown, job: () => void): void {
    if (this.busy()) this.waiting.set(key, job);
    else job();
  }

  /** Call when a turn has ended: runs the waiting jobs (if nothing new started meanwhile). */
  release(): void {
    if (this.busy() || !this.waiting.size) return;
    const jobs = [...this.waiting.values()];
    this.waiting.clear();
    for (const job of jobs) job();
  }

  get pending(): number {
    return this.waiting.size;
  }

  clear(): void {
    this.waiting.clear();
  }
}
