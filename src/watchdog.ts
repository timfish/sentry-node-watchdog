interface WatchdogOptions {
  /**
   * Interval at which we expect the watchdog to be polled
   */
  pollInterval: number;
  /**
   * Threshold above pollInterval at which we want to call the callback
   */
  threshold: number;
  /**
   * Callback is called when the event loop is blocked for at least `threshold`ms
   */
  callback: (blockedMs: number) => void;
}

type PollFn = () => void;

/**
 * Creates a Watchdog
 */
export function watchdogTimer(
  pollInterval: number,
  threshold: number,
  callback: () => void
): [PollFn, NodeJS.Timeout] {
  let lastPoll = process.hrtime();

  function poll() {
    lastPoll = process.hrtime();
  }

  let triggered = false;

  const timer = setInterval(() => {
    const diff = process.hrtime(lastPoll);
    const diffMs = Math.floor(diff[0] * 1e3 + diff[1] / 1e6);

    if (triggered === false && diffMs > pollInterval + threshold) {
      triggered = true;
      callback();
    }

    if (diffMs < pollInterval + threshold) {
      triggered = false;
    }
  }, 10);

  return [poll, timer];
}
