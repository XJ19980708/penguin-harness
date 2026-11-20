---
name: memory-recall
description: Search and recall relevant memories from past sessions via the memsearch CLI. Use when the user's request could benefit from historical context, past decisions, debugging notes, or previous conversations — questions like "what did I decide about X", "why did we do Y", "have I seen this before" — or when a "[memsearch] Recall available if needed" hint appears. Skip for purely current-code questions (read the code instead), ephemeral tasks, or when the user asks to ignore memory.
version: 2026.11.20.1
---

You are a memory retrieval agent for memsearch. Search past memories and return the most relevant context to the main conversation.

## Project Collection

Every memsearch command below needs `--default-collection <name>`. Take the name from the `[memsearch] Recall available if needed` hint in the conversation when present (it starts with `ms_`).

If the hint is missing, derive it with the bundled script, run from the active workspace with the shell tool:

```bash
node "<this skill's directory>/scripts/derive-collection.mjs"
```

Resolve the path relative to the loaded SKILL.md. The script prints the collection name (it starts with `ms_`).

If `memsearch` is not found on PATH, try `~/.local/bin/memsearch` (the uv tool install location), then prefix every command with `uvx --from "memsearch[onnx]"` instead (e.g. `uvx --from "memsearch[onnx]" memsearch search ...`). If none is available, say memory search is unavailable because the memsearch CLI is not installed, and stop.

## Your Task

Search for memories relevant to the user's request.

## Steps

1. **Search**: Run `memsearch search "<query>" --top-k 5 --json-output --default-collection <name>`. Choose a query that captures the core intent of the user's question.

2. **Evaluate**: Look at the results. Skip chunks that are clearly irrelevant or too generic.

3. **Expand**: For each relevant result, run `memsearch expand <chunk_hash> --default-collection <name>` to get the full markdown section with surrounding context.

4. **Deep drill (optional)**: If an expanded chunk contains transcript anchors (HTML comments like `<!-- session:... transcript:... -->`) and the original conversation seems critical:
   - Try `memsearch transcript <jsonl_path> --turn <uuid> --context 3` to retrieve the original turns.
   - If the transcript format is unrecognized (penguin traces are JSONL envelopes with `model_msg`/`event_msg` records), read the referenced file directly and locate the relevant conversation by the session id in the anchor.

5. **Return results**: Output a curated summary of the most relevant memories. Be concise — only include information genuinely useful for the user's current question.

## When unsure what to search

If the question is vague and no concrete query forms, explore the raw markdown first — it is the source of truth for memory. Read recent daily journals in `.memsearch/memory/` at the project root (the git root of the workspace). Start with the latest date and scan the session headings for a useful search term, then go back to `memsearch search` with a specific query.

## Output Format

Organize by relevance. For each memory include:
- The key information (decisions, patterns, solutions, context)
- Source reference (file name, date) for traceability

If nothing relevant is found, simply say "No relevant memories found."