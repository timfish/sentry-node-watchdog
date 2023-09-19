import { WebSocket } from "ws";
import type { Debugger } from "inspector";
import type { StackFrame } from "@sentry/types";

type Pause = () => void;

function isInApp(filename: string | undefined): boolean {
  const isInternal =
    filename &&
    // It's not internal if it's an absolute linux path
    !filename.startsWith("/") &&
    // It's not internal if it's an absolute windows path
    !filename.includes(":\\") &&
    // It's not internal if the path is starting with a dot
    !filename.startsWith(".") &&
    // It's not internal if the frame has a protocol. In node, this is usually the case if the file got pre-processed with a bundler like webpack
    !filename.match(/^[a-zA-Z]([a-zA-Z0-9.\-+])*:\/\//); // Schema from: https://stackoverflow.com/a/3641782

  // in_app is all that's not an internal Node function or a module within node_modules
  // note that isNative appears to return true even for node core libraries
  // see https://github.com/getsentry/raven-node/issues/176

  return (
    !isInternal && filename !== undefined && !filename.includes("node_modules/")
  );
}

export function connectToDebugger(
  url: string,
  stackTrace: (frames: StackFrame[]) => void
): Pause {
  let id = 0;

  // scriptId -> url map
  const scripts = new Map<string, string>();

  const ws = new WebSocket(url);
  ws.on("message", (data) => {
    const message = JSON.parse(data.toString());

    switch (message.method) {
      // We keep track of all parsed scripts so we can map scriptIds to URLs later
      case "Debugger.scriptParsed":
        scripts.set(message.params.scriptId, message.params.url);
        return;
      case "Debugger.paused":
        // copy the frames
        const debuggerFrames: Debugger.CallFrame[] = [
          ...message.params.callFrames,
        ];

        // and resume as soon as possible
        ws.send(
          JSON.stringify({ id: id++, method: "Debugger.resume", params: {} })
        );

        // Map them to Sentry frames
        const frames: StackFrame[] = debuggerFrames
          .map((frame) => {
            let filename = scripts.get(frame.location.scriptId);

            if (filename?.startsWith("file://")) {
              filename = filename?.slice(7);
            }

            const colno = frame.location.columnNumber
              ? frame.location.columnNumber + 1
              : undefined;
            const lineno = frame.location.lineNumber
              ? frame.location.lineNumber + 1
              : undefined;

            return {
              filename,
              function: frame.functionName || "?",
              colno,
              lineno,
              in_app: isInApp(filename),
            };
          })
          .reverse();

        stackTrace(frames);
        return;
    }
  });

  ws.on("open", () => {
    ws.send(
      JSON.stringify({ id: id++, method: "Debugger.enable", params: {} })
    );
  });

  return () => {
    ws.send(JSON.stringify({ id: id++, method: "Debugger.pause", params: {} }));
  };
}
