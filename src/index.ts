import { Integration } from "@sentry/types";
import { ChildProcess, fork } from "child_process";
import * as inspector from "inspector";
import { watchdog } from "./watchdog";
import { captureMessage, flush } from "@sentry/node";
import { WebSocket } from "ws";

const DEFAULT_INTERVAL = 50;
const DEFAULT_WARNING_THRESHOLD = 50;
const DEFAULT_HUNG_THRESHOLD = 2000;

interface Options {
  interval: number;
  warningThreshold: number;
  hungThreshold: number;
  inspect: boolean;
}

function connectToDebugger(url: string): () => void {
  let ws: WebSocket | undefined;
  let id = 0;
  const scripts = new Map<string, string>();

  while (!ws) {
    try {
      ws = new WebSocket(url);
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.method === "Debugger.scriptParsed") {
          scripts.set(message.params.scriptId, message.params.url);
          return;
        }
        if (message.method === "Debugger.paused") {
          console.log(
            "callFrames:",
            message.params.callFrames.map(
              (f: inspector.Debugger.CallFrame) => f.functionName
            )
          );
          ws?.send(
            JSON.stringify({ id: id++, method: "Debugger.resume", params: {} })
          );
        }
      });
      ws.on("error", (e) => {
        console.error(e);
      });
      ws.on("open", () => {
        ws?.send(
          JSON.stringify({ id: id++, method: "Debugger.enable", params: {} })
        );
        ws?.send(
          JSON.stringify({
            id: id++,
            method: "Debugger.setSkipAllPauses",
            params: { skip: false },
          })
        );
      });
    } catch (_) {
      //
    }
  }

  let hasPaused = false;

  return () => {
    if (!hasPaused) {
      hasPaused = true;

      ws?.send(
        JSON.stringify({ id: id++, method: "Debugger.pause", params: {} })
      );
    }
  };
}

class Watchdog implements Integration {
  public name: string = "Watchdog";

  constructor(private readonly _options: Partial<Options> = {}) {}

  public setupOnce(): void {
    if (process.send) {
      this._childProcess();
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

    setInterval(() => {
      child?.send({ inspectURL });
    }, this._options.interval);
  }

  private async _sendEventLoopBlockedEvent(blockedMs: number, hung: boolean) {
    captureMessage(`App Not Responding`, {
      level: hung ? "error" : "warning",
      extra: { blockedMs, hung },
    });

    await flush(2000);
    process.exit();
  }

  private _childProcess() {
    let pause: (() => void) | undefined;

    const [poll, _timer] = watchdog({
      pollInterval: this._options.interval || DEFAULT_INTERVAL,
      warningThreshold:
        this._options.warningThreshold || DEFAULT_WARNING_THRESHOLD,
      hungThreshold: this._options.hungThreshold || DEFAULT_HUNG_THRESHOLD,
      callback: (blockedMs: number, hung: boolean) => {
        if (hung) {
          pause?.();
        }
        // this._sendEventLoopBlockedEvent(blockedMs, hung);
      },
    });

    process.on("message", (message: { inspectURL: string | undefined }) => {
      if (pause === undefined && message.inspectURL) {
        pause = connectToDebugger(message.inspectURL);
      }
      poll();
    });
  }
}

export function createWatchdog(options: Partial<Options> = {}): {
  integration: Integration;
  guard: Promise<void>;
} {
  const isChild = !!process.send;
  console.log(isChild ? "is child" : "is parent");

  return {
    guard: isChild
      ? // In the child process, the promise never resolves
        new Promise<void>((_) => {})
      : Promise.resolve(),
    integration: new Watchdog(options),
  };
}
