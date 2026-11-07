// Only used by the isolated local runner, never by the production start command.
if (process.env.ITDESK_LOCAL_ISOLATED === "1") {
  const fs = require("node:fs");
  const path = require("node:path");
  const { fileURLToPath } = require("node:url");
  const { syncBuiltinESMExports } = require("node:module");
  const blocked = (file) => {
    if (typeof file === "number") return false;
    if (file instanceof URL) file = fileURLToPath(file);
    if (Buffer.isBuffer(file)) file = file.toString();
    if (typeof file !== "string") return false;
    const name = path.basename(file);
    return /^\.env(?:$|\.)/.test(name) && name !== ".env.example";
  };
  const missing = () => Object.assign(new Error("Dotenv files are unavailable in isolated local mode"), { code: "ENOENT" });
  for (const method of ["readFileSync", "openSync", "statSync", "lstatSync", "accessSync"]) {
    const original = fs[method];
    fs[method] = function (file, ...args) { if (blocked(file)) throw missing(); return original.call(this, file, ...args); };
  }
  const exists = fs.existsSync;
  fs.existsSync = function (file) { return blocked(file) ? false : exists.call(this, file); };
  for (const method of ["readFile", "open", "stat", "lstat", "access"]) {
    const original = fs[method];
    fs[method] = function (file, ...args) {
      if (blocked(file)) { const callback = args[args.length - 1]; if (typeof callback === "function") return process.nextTick(callback, missing()); throw missing(); }
      return original.call(this, file, ...args);
    };
    const promiseOriginal = fs.promises[method];
    fs.promises[method] = async function (file, ...args) { if (blocked(file)) throw missing(); return promiseOriginal.call(this, file, ...args); };
  }
  syncBuiltinESMExports();
}
