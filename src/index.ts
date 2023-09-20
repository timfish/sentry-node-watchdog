import { Event } from "@sentry/types";
import { fork } from "child_process";
import * as inspector from "inspector";
import { watchdogTimer } from "./watchdog";
import { captureEvent, flush } from "@sentry/node";
import type { StackFrame } from "@sentry/types";
import { captureStackTrace } from "./debugger";

const DEFAULT_INTERVAL = 50;
const DEFAULT_THRESHOLD = 200;

interface Options {
  entryScript: string;
  pollInterval: number;
  thresholdMs: number;
  captureStackTrace: boolean;
}

async function sendEvent(blockedMs: number, frames?: StackFrame[]) {
  const event: Event = {
    level: "error",
    exception: {
      values: [
        {
          value: "ANR",
          type: "ApplicationNotResponding",
          stacktrace: { frames },
        },
      ],
    },
    extra: { blockedMs },
  };

  captureEvent(event);

  await flush(3000);
  process.exit();
}

function setupMainProcess(options: Options) {
  let inspectURL: string | undefined;

  if (options.captureStackTrace) {
    inspector.open();
    inspectURL = inspector.url();
  }

  const child = fork(options.entryScript, {
    stdio: "inherit",
  });
  child.unref();

  const timer = setInterval(() => {
    try {
      child.send({ inspectURL });
    } catch (_) {
      // Ignore
    }
  }, options.pollInterval);

  child.on("error", () => {
    clearTimeout(timer);
  });
  child.on("disconnect", () => {
    clearTimeout(timer);
  });
  child.on("exit", () => {
    clearTimeout(timer);
  });
}

function setupChildProcess(options: Options) {
  let pauseAndCapture: (() => void) | undefined;

  const [pollWatchdog, _timer] = watchdogTimer(
    options.pollInterval,
    options.thresholdMs,
    () => {
      if (pauseAndCapture) {
        pauseAndCapture();
      } else {
        sendEvent(options.pollInterval + options.thresholdMs);
      }
    }
  );

  process.on("message", (message: { inspectURL: string | undefined }) => {
    pollWatchdog();

    // If the debugger hasn't been started yet and we have been passed a URL, start the debugger
    if (pauseAndCapture === undefined && message.inspectURL) {
      captureStackTrace(message.inspectURL, (frames) => {
        sendEvent(options.pollInterval + options.thresholdMs, frames);
      }).then((pause) => {
        pauseAndCapture = pause;
      });
    }
  });
}

export function watchdog(options: Partial<Options>): Promise<void> {
  const isChildProcess = !!process.send;

  const anrOptions: Options = {
    entryScript: options.entryScript || process.argv[1],
    pollInterval: options.pollInterval || DEFAULT_INTERVAL,
    thresholdMs: options.thresholdMs || DEFAULT_THRESHOLD,
    captureStackTrace: !!options.captureStackTrace,
  };

  if (isChildProcess) {
    setupChildProcess(anrOptions);
    // In the child process, the promise never resolves which stops the app code from running
    return new Promise<void>(() => {});
  } else {
    setupMainProcess(anrOptions);
    // In the main process, the promise resolves immediately
    return Promise.resolve();
  }
}
