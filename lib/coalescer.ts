/**
 * Trailing-call coalescer.
 *
 * Realtime delivers one event per changed row, so a roster import or a bulk grade entry used
 * to trigger a full workspace load per row. Coalescing collapses a burst into a single call
 * after `delayMs` of quiet.
 */
export interface Coalescer {
  /** Schedule (or re-schedule) the trailing call. */
  schedule(): void;
  /** Drop any scheduled call — used on sign-out/unmount. */
  cancel(): void;
  /** Whether a call is currently scheduled. */
  isScheduled(): boolean;
}

export function createCoalescer(delayMs: number, run: () => void): Coalescer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule() {
      cancel();
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel,
    isScheduled() {
      return timer !== null;
    },
  };
}
