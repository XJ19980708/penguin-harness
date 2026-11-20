// Shared helpers for the memsearch hooks. Plain Node, builtins only.
// Trace handling follows plugins/continual-learning/hooks/stop.mjs; the collection-name
// derivation reproduces memsearch's scripts/derive-collection.sh so a project's memory
// collection is shared with the official memsearch host plugins (best effort: the hash
// covers the absolute project path in forward-slash spelling).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

export function readInput() {
  const raw = fs.readFileSync(0, "utf8");
  return raw.trim() ? JSON.parse(raw) : {};
}

export function readTrace(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A torn tail or a foreign line is skipped.
    }
  }
  return records;
}

export const isMain = (r) => r && !(r.origin && r.origin.length);

export function sessionMeta(records) {
  const meta = records.find((r) => r && r.type === "session_meta");
  return (meta && meta.payload) || null;
}

/**
 * Whether a record starts a Task: a main-session user text actually typed by the user.
 * Harness-injected texts (this plugin's recall hint, hook continues, goal rounds) and
 * mid-run deliveries (steering, compaction summaries, steered completion notices) do not
 * start a Task — the journal window stays anchored to what the user asked.
 */
export function isTaskStart(r) {
  if (!isMain(r) || r.type !== "model_msg" || !r.payload) return false;
  const p = r.payload;
  if (p.type !== "text" || p.role !== "user" || typeof p.text !== "string") return false;
  if (p.sender === "harness") return false;
  const text = p.text;
  if (text.startsWith("[user_steering]")) return false;
  if (text.startsWith("[context_summary]") || text.startsWith("<context_summary>")) return false;
  const notice = /^\[background_task_done\]\n([\s\S]*?)\n\[\/background_task_done\]/.exec(text);
  if (notice && /^delivery: steering$/m.test(notice[1])) return false;
  return true;
}

const isTaskInput = (r) =>
  isTaskStart(r) ||
  (isMain(r) && r.type === "model_msg" && !!r.payload && r.payload.type === "image_url");

/** The just-ended Task's records: everything from its input batch on; the whole file when no input is in it. */
export function taskWindow(records) {
  let start = 0;
  records.forEach((r, i) => {
    if (isTaskStart(r)) start = i;
  });
  while (start > 0 && isTaskInput(records[start - 1])) start -= 1;
  return records.slice(start);
}

/** Leading `[tag]…[/tag]` blocks stripped off a user text; a `[user_steering]` block yields its body. */
export function userBody(text) {
  const steering = /^\[user_steering\]\n([\s\S]*)\n\[\/user_steering\]$/.exec(text.trim());
  if (steering) return steering[1];
  let out = text;
  for (;;) {
    const m = /^\[([a-z_]+)\]\n[\s\S]*?\n\[\/\1\]\n*/.exec(out);
    if (!m) break;
    out = out.slice(m[0].length);
  }
  return out.trim();
}

export function clip(text, max) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const CLIP = { user: 800, assistant: 1200, toolCall: 300, toolOutput: 400 };
const MAX_CHARS = 60_000;

/** Condenses main-session records into clipped transcript lines; thinking, images and events left out. */
export function condense(records) {
  const lines = [];
  const toolNames = new Map();
  for (const r of records) {
    if (!isMain(r) || r.type !== "model_msg" || !r.payload) continue;
    const p = r.payload;
    if (p.type === "text") {
      if (p.role === "user") {
        // Harness-injected texts (recall hints, hook context) are not the user's words.
        if (p.sender === "harness") continue;
        const body = userBody(p.text || "");
        if (body) lines.push(`[user] ${clip(body, CLIP.user)}`);
      } else if ((p.text || "").trim()) {
        lines.push(`[assistant] ${clip(p.text, CLIP.assistant)}`);
      }
    } else if (p.type === "tool_call") {
      toolNames.set(p.tool_call_id, p.name);
      lines.push(`[tool_call ${p.name}] ${clip(p.arguments || "", CLIP.toolCall)}`);
    } else if (p.type === "tool_call_output") {
      const name = toolNames.get(p.tool_call_id) || p.tool_call_id;
      const status = p.status && p.status !== "completed" ? ` · ${p.status}` : "";
      lines.push(`[tool_output ${name}${status}] ${clip(p.output || "", CLIP.toolOutput)}`);
    }
  }
  let dropped = 0;
  let total = lines.reduce((n, l) => n + l.length + 1, 0);
  while (total > MAX_CHARS && lines.length > 1) {
    total -= lines.shift().length + 1;
    dropped += 1;
  }
  if (dropped > 0) lines.unshift(`[… ${dropped} earlier lines omitted]`);
  return lines.join("\n");
}

export const visiblePath = (p) => (process.platform === "win32" ? p.replace(/\\/g, "/") : p);

/** The project root memsearch scopes memory to: the workspace's git root, or the workspace itself. */
export function projectDir(workspace) {
  let dir;
  try {
    dir = fs.realpathSync(path.resolve(workspace));
  } catch {
    dir = path.resolve(workspace);
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
  return visiblePath(dir);
}

/** ms_<sanitized_basename>_<8char_sha256>, matching memsearch's derive-collection.sh. */
export function collectionName(projDir) {
  const base = path
    .basename(projDir)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/__+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  const hash = crypto.createHash("sha256").update(projDir).digest("hex").slice(0, 8);
  return `ms_${base}_${hash}`;
}

/**
 * Locate the memsearch CLI: PATH first, then the usual user bin dirs (uv tool installs to
 * ~/.local/bin, which is often not on the server's PATH). Falls back to uvx. Returns a
 * shell-ready command prefix, or null when neither is available.
 */
export function memsearchCli() {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const home = os.homedir();
  const userBins = [
    path.join(home, ".local", "bin"),
    path.join(home, ".cargo", "bin"),
    path.join(home, "bin"),
    "/usr/local/bin",
  ];
  const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const scan = (dirs, name) => {
    for (const d of dirs) {
      for (const ext of exts) {
        const p = path.join(d, name + ext);
        if (fs.existsSync(p)) return p;
      }
    }
    return null;
  };
  if (scan(pathDirs, "memsearch")) return "memsearch";
  const local = scan(userBins, "memsearch");
  if (local) return `"${visiblePath(local)}"`;
  if (scan(pathDirs, "uvx")) return 'uvx --from "memsearch[onnx]" memsearch';
  const uvxLocal = scan(userBins, "uvx");
  if (uvxLocal) return `"${visiblePath(uvxLocal)}" --from "memsearch[onnx]" memsearch`;
  return null;
}