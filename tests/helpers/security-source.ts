import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const externalRequire = createRequire(path.join(process.cwd(), "package.json"));

// No dotenv or live database/network entry point is allowed in these tests.
export function loadSecuritySource(relative: string, options: { env?: Record<string, string | undefined>; prisma?: unknown; modules?: Record<string, unknown> } = {}) {
  const cache = new Map<string, { exports: any }>();
  function load(file: string): any {
    const filename = path.resolve(file);
    if (cache.has(filename)) return cache.get(filename)!.exports;
    const module = { exports: {} as any };
    cache.set(filename, module);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    const safeRequire = (id: string): any => {
      if (options.modules && id in options.modules) return options.modules[id];
      if (id === "@/src/lib/prisma") return { prisma: options.prisma || new Proxy({}, { get() { throw new Error("Database access blocked"); } }) };
      if (id.startsWith("@/")) return load(id.slice(2) + ".ts");
      if (["crypto", "node:crypto", "node:fs/promises", "path", "fs/promises", "next/server", "zod"].includes(id)) return externalRequire(id);
      throw new Error(`Unexpected import: ${id}`);
    };
    vm.runInNewContext(code, { require: safeRequire, module, exports: module.exports, process: { env: { ...options.env }, cwd: () => process.cwd() }, Buffer, Request, Response, Headers, FormData, File, Date, URL, URLSearchParams, Uint8Array, console, setTimeout, clearTimeout, fetch: () => { throw new Error("Network access blocked"); } }, { filename });
    return module.exports;
  }
  return load(relative);
}
