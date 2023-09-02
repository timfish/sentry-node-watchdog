const { init } = require("@sentry/node");
const { Watchdog } = require("./dist/index");
const crypto = require("crypto");

init({
  dsn: "__DSN__",
  release: "test@1.0.0",
  environment: "test",
  integrations: [new Watchdog()],
});

let counter = 0;
setInterval(() => {
  console.log("Main event loop running", counter++);
}, 200);

function longWork() {
  const salt = crypto.randomBytes(128).toString("base64");
  const hash = crypto.pbkdf2Sync("myPassword", salt, 10000, 512, "sha512");
}

setTimeout(() => {
  for (let i = 0; i < 10; i++) {
    longWork();
  }
}, 3000);
