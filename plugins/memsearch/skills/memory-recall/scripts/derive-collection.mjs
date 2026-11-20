#!/usr/bin/env node
// Derive the project's memsearch collection name: ms_<sanitized_basename>_<8char_sha256>.
// Reproduces memsearch's derive-collection.sh (git-root scope, forward-slash path spelling)
// so the collection matches the one the hooks and the official host plugins use.
//
// Usage: node derive-collection.mjs [project_dir]   (default: cwd)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

let dir;
try {
  dir = fs.realpathSync(path.resolve(process.argv[2] || process.cwd()));
} catch {
  dir = path.resolve(process.argv[2] || process.cwd());
}
let d = dir;
for (;;) {
  if (fs.existsSync(path.join(d, ".git"))) {
    dir = d;
    break;
  }
  const up = path.dirname(d);
  if (up === d) break;
  d = up;
}
const proj = dir.replace(/\\/g, "/");
const base = path
  .basename(proj)
  .toLowerCase()
  .replace(/[^a-z0-9]/g, "_")
  .replace(/__+/g, "_")
  .replace(/^_|_$/g, "")
  .slice(0, 40);
const hash = crypto.createHash("sha256").update(proj).digest("hex").slice(0, 8);
console.log(`ms_${base}_${hash}`);