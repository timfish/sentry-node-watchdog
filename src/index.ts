import { Integration, Event } from "@sentry/types";
import { ChildProcess, fork } from "child_process";
import * as inspector from "inspector";
import { watchdog } from "./watchdog";
import { captureEvent, flush } from "@sentry/node";
import { StackFrame } from "@sentry/types";
import { connectToDebugger } from "./debugger";

const DEFAULT_INTERVAL = 50;
const DEFAULT_THRESHOLD = 200;

const isChildProcess = !!process.send;

interface Options {
  interval: number;
  threshold: number;
  inspect: boolean;
}

class Watchdog implements Integration {
  public name: string = "Watchdog";

  constructor(private readonly _options: Partial<Options> = {}) {}

  public setupOnce(): void {
    if (isChildProcess) {
      this._setupChildProcess();
    } else {
      this._setupMainProcess();
    }
  }

  private _setupMainProcess() {
    let inspectURL: string | undefined;

    if (this._options.inspect) {
      inspector.open();
      inspectURL = inspector.url();
    }

    let child: ChildProcess | undefined = fork(process.argv[1], {
      stdio: "inherit",
    });
    child.unref();
    child.on("disconnect", () => {
      child = undefined;
    });
    child.on("exit", () => {
      child = undefined;
    });

    setInterval(() => {
      try {
        child?.send({ inspectURL });
      } catch (_) {
        // Ignore
      }
    }, this._options.interval);
  }

  private async _sendEventLoopBlockedEvent(
    blockedMs: number,
    frames?: StackFrame[]
  ) {
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

    await flush(2000);
    process.exit();
  }

  private _setupChildProcess() {
    let pause: (() => void) | undefined;

    const [poll, _timer] = watchdog({
      pollInterval: this._options.interval || DEFAULT_INTERVAL,
      threshold: this._options.threshold || DEFAULT_THRESHOLD,
      callback: (blockedMs: number) => {
        if (this._options.inspect) {
          pause?.();
        } else {
          this._sendEventLoopBlockedEvent(blockedMs);
        }
      },
    });

    process.on("message", (message: { inspectURL: string | undefined }) => {
      // If the debugger hasn't been started yet and we have a URL, start the debugger
      if (pause === undefined && message.inspectURL) {
        pause = connectToDebugger(message.inspectURL, (frames) => {
          this._sendEventLoopBlockedEvent(
            (this._options.interval || DEFAULT_INTERVAL) +
              (this._options.threshold || DEFAULT_THRESHOLD),
            frames
          );
        });
      }
      poll();
    });
  }
}

export function createWatchdog(options: Partial<Options> = {}): {
  integration: Integration;
  guard: Promise<void>;
} {
  console.log(isChildProcess ? "is child" : "is parent");

  return {
    guard: isChildProcess
      ? // In the child process, the promise never resolves which stops the app code from running
        new Promise<void>((_) => {})
      : Promise.resolve(),
    integration: new Watchdog(options),
  };
}
