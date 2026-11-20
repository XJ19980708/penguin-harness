#!/usr/bin/env node
// The memsearch capture hook: when a Task ends, condense it into a transcript excerpt and ask
// the harness to hand it to a background subagent. The subagent writes a third-person journal
// entry into the project's daily memsearch markdown and refreshes the search index. The
// markdown is the source of truth; the Milvus index is a shadow that can always be rebuilt.
//
// stdin:  { "hook": "stop", "session_id", "trace_path" }
// stdout: nothing when the Task was empty or the memsearch CLI is not installed;
//         otherwise { "reason", "output": { "turns" }, "subagent": { "prompt" } }
import path from "node:path";
import {
  readInput,
  readTrace,
  sessionMeta,
  isMain,
  taskWindow,
  condense,
  projectDir,
  collectionName,
  memsearchCli,
  visiblePath,
} from "./lib.mjs";

/** Completed LLM turns a Task must reach before a journal entry fires. */
const MIN_TURNS = 1;

const input = readInput();
const sessionId = String(input.session_id || "");
const tracePath = typeof input.trace_path === "string" ? input.trace_path : "";
if (!sessionId || !tracePath) process.exit(0);

const cli = memsearchCli();
if (!cli) process.exit(0);

const records = readTrace(tracePath);
const meta = sessionMeta(records);
const workspace = meta && typeof meta.workspace === "string" ? meta.workspace : "";
if (!workspace) process.exit(0);

const window = taskWindow(records);
// A turn is a Request that completed: an attempt cut off at its output cap is retried, so it
// is no turn; nor is an interrupted or failed one.
const turns = window.filter(
  (r) =>
    isMain(r) &&
    r.type === "event_msg" &&
    r.payload &&
    r.payload.type === "request_end" &&
    r.payload.status === "completed",
).length;
if (turns < MIN_TURNS) process.exit(0);

const excerpt = condense(window);
if (!excerpt.trim()) process.exit(0);

const proj = projectDir(workspace);
const collection = collectionName(proj);
const memoryDir = visiblePath(path.join(proj, ".memsearch", "memory"));
const anchor = `<!-- session:${sessionId} transcript:${visiblePath(tracePath)} -->`;

const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
const journal = `${memoryDir}/${date}.md`;

const prompt = [
  `Automated session journal (memsearch hook). The transcript excerpt below covers the task that just ended (${turns} turns) in session ${sessionId}. Write a factual third-person journal entry into the project's memory, then refresh the search index.`,
  "",
  "You are an EXTERNAL OBSERVER recording what happened — not the assistant in the transcript. Do NOT answer the user's question, do NOT give suggestions, do NOT offer help.",
  "",
  'Step 1 — Summarize. Produce 2-10 bullet points, each starting with "- ":',
  '- Write in third person and call the user "User".',
  "- First bullet: what User asked or wanted (one sentence).",
  "- Remaining bullets: what was done, found, changed, configured, tested, explained, decided, or could not be completed.",
  "- Be specific when useful: important files read or edited, searches performed, commands or tests run, key findings, concrete outcomes.",
  "- Prefer the final user-visible outcome over low-level transcript mechanics.",
  "- Write every bullet in the same primary language as the [user] lines (the dominant language if mixed).",
  "- Never record secrets, credentials, or private identifiers.",
  "",
  `Step 2 — Append to the daily journal at ${journal} (create the directory and file if missing):`,
  `- If the file does not already contain a "## Session" heading for this session (search for "session:${sessionId}"), append a line "## Session ${hm}" first.`,
  `- Then append, in order: a line "### ${hm}", the anchor line \`${anchor}\`, and the bullet points.`,
  "- Append only; never rewrite or delete existing content.",
  "",
  `Step 3 — Refresh the index (best effort). Run, in ${proj}:`,
  `${cli} index "${memoryDir}" --default-collection ${collection}`,
  "If the command fails or the CLI is unavailable, leave the markdown as written — it is the source of truth and will be indexed later.",
  "",
  "Reply with one short line confirming what you wrote.",
  "",
  "Transcript excerpt:",
  "",
  excerpt,
].join("\n");

process.stdout.write(
  `${JSON.stringify({
    reason: `session journal delegated to a subagent (${turns} turns)`,
    output: { turns },
    subagent: { prompt },
  })}\n`,
);