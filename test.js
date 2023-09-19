const { init } = require("@sentry/node");
const { createWatchdog } = require("./dist/index");
const crypto = require("crypto");

const { guard, integration } = createWatchdog({ inspect: true });

init({
  dsn: "https://b5c57102f0ce214664c1af9869fdb187@o51950.ingest.sentry.io/4505800098709504",
  debug: true,
  release: "test@1.0.0",
  integrations: [integration],
});

guard.then(() => {
  let counter = 0;
  setInterval(() => {
    console.log("Main event loop running", counter++);
  }, 200);

  function longWork() {
    const salt = crypto.randomBytes(128).toString("base64");
    const hash = crypto.pbkdf2Sync("myPassword", salt, 10000, 512, "sha512");
  }

  setTimeout(() => {
    for (let i = 0; i < 100; i++) {
      longWork();
    }
  }, 3000);
});
