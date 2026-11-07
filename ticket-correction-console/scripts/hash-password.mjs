import { hashPassword } from "../lib/password.js";

async function readPipedPassword() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function readHiddenPassword() {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
      readPipedPassword().then(resolve, reject);
      return;
    }

    let value = "";
    process.stdout.write("Password: ");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    function finish(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      for (const character of chunk) {
        if (character === "\u0003") {
          finish(new Error("Cancelled"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += character;
      }
    }

    process.stdin.on("data", onData);
  });
}

const password = await readHiddenPassword();
if (!password) {
  console.error("Password must not be empty.");
  process.exit(1);
}
process.stdout.write(`${await hashPassword(password)}\n`);
