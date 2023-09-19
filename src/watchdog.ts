interface WatchdogOptions {
  /**
   * Interval at which we expect the watchdog to be polled
   */
  pollInterval: number;
  /**
   * Threshold above pollInterval at which we want to call the callback
   */
  warningThreshold: number;
  /**
   * Threshold above pollInterval at which we stop waiting for a poll and assume the event loop is blocked forever
   */
  hungThreshold: number;
  /**
   * Callback is called when the event loop is blocked for at least `threshold`ms
   */
  callback: (blockedMs: number, hung: boolean) => void;
}

type PollFn = () => void;

/**
 * Creates a Watchdog
 */
export function watchdog(options: WatchdogOptions): [PollFn, NodeJS.Timeout] {
  let lastPoll = process.hrtime();

  function poll() {
    lastPoll = process.hrtime();
  }

  let lastDiff = 0;

  const timer = setInterval(() => {
    const diff = process.hrtime(lastPoll);
    const diffMs = Math.floor(diff[0] * 1e3 + diff[1] / 1e6);

    if (diffMs > options.pollInterval + options.hungThreshold) {
      options.callback(diffMs - options.pollInterval, true);
    }

    if (
      // The last diff was above the threshold
      lastDiff > options.pollInterval + options.warningThreshold &&
      // The current diff has dropped below the previous
      diffMs < lastDiff
    ) {
      // We recovered from a blocked event loop
      options.callback(lastDiff - options.pollInterval, false);
      lastDiff = 0;
    }

    lastDiff = diffMs;
  }, 10);

  return [poll, timer];
}
