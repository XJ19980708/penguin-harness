#!/usr/bin/env node
// The memsearch recall hint: on every substantial user prompt, advertise that this project
// has a searchable memory of past sessions, with the exact collection to query. Pull-style
// recall — the hint only informs; the memory-recall skill (or a direct CLI search) does the
// retrieval. Silent when the prompt is tiny or the memsearch CLI is not installed.
//
// stdin:  { "hook": "user_prompt", "session_id", "trace_path", "prompt", ... }
// stdout: { "context": "<hint>" } or nothing.
import path from "node:path";
import {
  readInput,
  readTrace,
  sessionMeta,
  projectDir,
  collectionName,
  memsearchCli,
  visiblePath,
} from "./lib.mjs";

const input = readInput();
const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
if (prompt.length < 10) process.exit(0);

const cli = memsearchCli();
if (!cli) process.exit(0);

const tracePath = typeof input.trace_path === "string" ? input.trace_path : "";
if (!tracePath) process.exit(0);
const meta = sessionMeta(readTrace(tracePath));
const workspace = meta && typeof meta.workspace === "string" ? meta.workspace : "";
if (!workspace) process.exit(0);

const proj = projectDir(workspace);
const collection = collectionName(proj);
const memoryDir = visiblePath(path.join(proj, ".memsearch", "memory"));

const context = [
  "[memsearch] Recall available if needed: this project keeps a searchable memory of past sessions.",
  `If the user's request could benefit from historical context — past decisions, debugging notes, earlier conversations — use the memory-recall skill, or search directly: ${cli} search "<query>" --top-k 5 --json-output --default-collection ${collection}`,
  `Memory markdown lives in ${memoryDir}. Skip recall for purely current-code questions or ephemeral tasks.`,
].join("\n");

process.stdout.write(`${JSON.stringify({ context })}\n`);