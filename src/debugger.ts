import { WebSocket } from "ws";
import type { Debugger } from "inspector";
import type { StackFrame } from "@sentry/types";

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

/**
 * Converts Debugger.CallFrames to Sentry StackFrames
 */
function callFramesToStackFrames(
  callFrames: Debugger.CallFrame[],
  filenameFromId: (id: string) => string | undefined
): StackFrame[] {
  return callFrames
    .map((frame) => {
      let filename = filenameFromId(frame.location.scriptId);

      if (filename && filename.startsWith("file://")) {
        filename = filename.slice(7);
      }

      // CallFrame row/col is 0 based, StackFrame is 1 based
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
}

type DebugMessage =
  | {
      method: "Debugger.scriptParsed";
      params: Debugger.ScriptParsedEventDataType;
    }
  | { method: "Debugger.paused"; params: Debugger.PausedEventDataType };

function debuggerProtocol(
  url: string,
  onMessage: (message: DebugMessage) => void
): (method: string) => void {
  let id = 0;
  const ws = new WebSocket(url);

  ws.on("message", (data) => {
    const message = JSON.parse(data.toString()) as DebugMessage;
    onMessage(message);
  });

  return (method: string, params?: any) => {
    ws.send(JSON.stringify({ id: id++, method, params }));
  };
}

export function captureStackTrace(
  url: string,
  callback: (frames: StackFrame[]) => void
): () => void {
  // Collect scriptId -> url map so we can look up the filenames later
  const scripts = new Map<string, string>();

  const sendCommand = debuggerProtocol(url, (message) => {
    if (message.method === "Debugger.scriptParsed") {
      scripts.set(message.params.scriptId, message.params.url);
    } else if (message.method === "Debugger.paused") {
      // copy the frames
      const callFrames = [...message.params.callFrames];
      // and resume immediately
      sendCommand("Debugger.resume");

      const frames = callFramesToStackFrames(callFrames, (id) =>
        scripts.get(id)
      );

      callback(frames);
    }
  });

  return () => {
    sendCommand("Debugger.enable");
    sendCommand("Debugger.pause");
  };
}
