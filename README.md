# sentry-node-watchdog 🐶

Proof of Concept integration for Sentry Node to detect App Not Responding or
excessive event loop blocking.

This uses a Worker Thread and loads the worker code via a bas64 data URL. This requires
Node v14.7 but means there will be less issues with bundlers.

To keep the worker code to a minimum, it does not use a full Sentry client.
Instead it uses the bare transport and constructs a basic event envelope. The
worker code is bundled and minified with rollup and then written to a file as a
base64 code string.

In the main event loop, the only overhead is a periodic `postMessage` to the
worker thread. The watchdog thread observes these messages form
the main thread and determines two levels of detection to send events: 

- A warning event is sent when the main thread poll was late and includes the
  length of the delay in the event
- An error event is sent when the main thread poll is very late (ie. hung) and we don't
  want to continue waiting just to measure the delay. 

Once an event has been sent, the worker thread terminates to ensure that we
don't continue to consume resources while the app is struggling and also to
ensure that we don't send more/duplicate events.

You can test this integration in action by setting a DSN in `test.js` and then
running the following commands:

```shell
yarn && yarn build && yarn test
```