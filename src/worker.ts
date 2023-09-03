import { makeNodeTransport } from "@sentry/node";
import { getEnvelopeEndpointWithUrlEncodedAuth } from "@sentry/core";
import {
  dsnFromString,
  getSdkMetadataForEnvelopeHeader,
  createEventEnvelopeHeaders,
  createEnvelope,
  uuid4,
} from "@sentry/utils";
import {
  SdkMetadata,
  DsnComponents,
  EventEnvelope,
  SdkInfo,
  Event,
  EventItem,
} from "@sentry/types";
import { parentPort, workerData } from "worker_threads";
import { watchdog } from "./watchdog";
import { WorkerData } from "./index";

/** This is not exported from @sentry/core and should probably be moved to @sentry/utils rather than copied here */
function enhanceEventWithSdkInfo(event: Event, sdkInfo?: SdkInfo): Event {
  if (!sdkInfo) {
    return event;
  }
  event.sdk = event.sdk || {};
  event.sdk.name = event.sdk.name || sdkInfo.name;
  event.sdk.version = event.sdk.version || sdkInfo.version;
  event.sdk.integrations = [
    ...(event.sdk.integrations || []),
    ...(sdkInfo.integrations || []),
  ];
  event.sdk.packages = [
    ...(event.sdk.packages || []),
    ...(sdkInfo.packages || []),
  ];
  return event;
}

/** This is not exported from @sentry/core and should probably be moved to @sentry/utils rather than copied here */
function createEventEnvelope(
  event: Event,
  dsn: DsnComponents,
  metadata?: SdkMetadata,
  tunnel?: string
): EventEnvelope {
  const sdkInfo = getSdkMetadataForEnvelopeHeader(metadata);

  enhanceEventWithSdkInfo(event, metadata && metadata.sdk);

  const envelopeHeaders = createEventEnvelopeHeaders(
    event,
    sdkInfo,
    tunnel,
    dsn
  );

  const eventItem: EventItem = [{ type: "event" }, event];
  return createEnvelope<EventEnvelope>(envelopeHeaders, [eventItem]);
}

if (parentPort === null) {
  process.exit();
}

const options: WorkerData = workerData;

async function sendTimeoutEvent(blockedMs: number, hung: boolean) {
  const dsn = dsnFromString(options.dsn);

  if (!dsn) {
    process.exit();
  }

  const event: Event = {
    event_id: uuid4(),
    platform: "node",
    release: options.release,
    environment: options.environment,
    message: `App Not Responding`,
    extra: { blockedMs, hung },
    level: hung ? "error" : "warning",
  };

  console.log("Sending event", event);

  const url = getEnvelopeEndpointWithUrlEncodedAuth(dsn);
  const transport = makeNodeTransport({ url, recordDroppedEvent: () => {} });
  const envelope = createEventEnvelope(event, dsn, options.sdkMetadata);
  await transport.send(envelope);
  await transport.flush(2000);
  process.exit();
}

const [poll, _timer] = watchdog({
  pollInterval: options.interval,
  threshold: options.warningThreshold,
  nonRecoveredThreshold: options.errorThreshold,
  callback: sendTimeoutEvent,
});

parentPort.on("message", () => {
  poll();
});
