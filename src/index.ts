import { Event } from "@sentry/types";
import { fork } from "child_process";
import * as inspector from "inspector";
import { watchdogTimer } from "./watchdog";
import { captureEvent, flush } from "@sentry/node";
import { StackFrame } from "@sentry/types";
import { connectToDebugger } from "./debugger";

const DEFAULT_INTERVAL = 50;
const DEFAULT_THRESHOLD = 200;

interface Options {
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
          value: "App Not Responding",
          type: "AppNotResponding",
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

function mainProcess(options: Options) {
  let inspectURL: string | undefined;

  if (options.captureStackTrace) {
    inspector.open();
    inspectURL = inspector.url();
  }

  const child = fork(process.argv[1], {
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

function childProcess(options: Options) {
  let pause: (() => void) | undefined;

  const [poll, _timer] = watchdogTimer(
    options.pollInterval,
    options.thresholdMs,
    () => {
      if (pause) {
        pause();
      } else {
        sendEvent(options.pollInterval + options.thresholdMs);
      }
    }
  );

  process.on("message", (message: { inspectURL: string | undefined }) => {
    // If the debugger hasn't been started yet and we have been passed a URL, start the debugger
    if (pause === undefined && message.inspectURL) {
      pause = connectToDebugger(message.inspectURL, (frames) => {
        sendEvent(options.pollInterval + options.thresholdMs, frames);
      });
    }

    poll();
  });
}

export function watchdog(options: Partial<Options>): Promise<void> {
  const isChildProcess = !!process.send;

  const anrOptions: Options = {
    pollInterval: options.pollInterval || DEFAULT_INTERVAL,
    thresholdMs: options.thresholdMs || DEFAULT_THRESHOLD,
    captureStackTrace: !!options.captureStackTrace,
  };

  if (isChildProcess) {
    childProcess(anrOptions);
    // In the child process, the promise never resolves which stops the app code from running
    return new Promise<void>(() => {});
  } else {
    mainProcess(anrOptions);
    // In the main process, the promise resolves immediately
    return Promise.resolve();
  }
}
