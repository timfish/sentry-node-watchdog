import { Hub, Integration, SdkMetadata } from "@sentry/types";
import { base64WorkerScript } from "./worker-script";
import { Worker } from "worker_threads";

const DEFAULT_INTERVAL = 50;
const DEFAULT_WARNING_THRESHOLD = 50;
const DEFAULT_HUNG_THRESHOLD = 5000;

interface Options {
  interval: number;
  warningThreshold: number;
  hungThreshold: number;
}

export interface WorkerData extends Options {
  sdkMetadata: SdkMetadata;
  dsn: string;
  release: string;
  environment: string;
}

export class Watchdog implements Integration {
  public name: string = "Watchdog";

  constructor(private readonly _options: Partial<Options> = {}) {}

  public setupOnce(_: unknown, getCurrentHub: () => Hub): void {
    const initOptions = getCurrentHub().getClient()?.getOptions();

    if (!initOptions) {
      throw new Error("No options available");
    }

    const workerData: WorkerData = {
      dsn: initOptions.dsn || "",
      environment: initOptions.environment || "",
      release: initOptions.release || "",
      sdkMetadata: initOptions._metadata || {},
      interval: this._options.interval || DEFAULT_INTERVAL,
      warningThreshold:
        this._options.warningThreshold || DEFAULT_WARNING_THRESHOLD,
      hungThreshold: this._options.hungThreshold || DEFAULT_HUNG_THRESHOLD,
    };

    const worker = new Worker(
      new URL(`data:application/javascript;base64,${base64WorkerScript}`),
      { workerData }
    );

    // Ensure this thread can't block app exit
    worker.unref();

    setInterval(() => {
      worker?.postMessage("poll");
    }, workerData.interval).unref();
  }
}
