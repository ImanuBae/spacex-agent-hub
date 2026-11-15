// Next has no skip-env-file flag. Test/build children receive explicit env and must never open personal .env files.
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath } = require("node:url");
for (const method of ["statSync", "readFileSync"]) {
  const original = fs[method];
  fs[method] = function (file, ...args) {
    const name = typeof file === "string" ? file : file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString() : "";
    if (/^\.env(?:\.|$)/.test(path.basename(name))) throw Object.assign(new Error("Personal env loading is disabled for this test child"), { code: "ENOENT" });
    return original.call(fs, file, ...args);
  };
}
require("node:module").syncBuiltinESMExports();
