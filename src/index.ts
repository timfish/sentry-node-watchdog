import { Hub, Integration, SdkMetadata } from "@sentry/types";
import { base64WorkerScript } from "./worker-script";
import { Worker } from "worker_threads";

const DEFAULT_INTERVAL = 50;
const DEFAULT_WARNING_THRESHOLD = 50;
const DEFAULT_ERROR_THRESHOLD = 5000;

interface Options {
  interval: number;
  warningThreshold: number;
  errorThreshold: number;
}

export interface WorkerData extends Options {
  sdkMetadata: SdkMetadata;
  dsn: string;
  release: string;
  environment: string;
}

export class Watchdog implements Integration {
  public name: string = "Watchdog";

  private _worker: Worker | undefined;

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
      errorThreshold: this._options.errorThreshold || DEFAULT_ERROR_THRESHOLD,
    };

    this._worker = new Worker(
      new URL(`data:application/javascript;base64,${base64WorkerScript}`),
      { workerData }
    );

    // Ensure this thread can't block app exit
    this._worker.unref();

    setInterval(() => {
      this._worker?.postMessage("poll");
    }, workerData.interval).unref();
  }
}
