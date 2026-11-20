# @penguinharness/memsearch

Long-term memory for a penguin agent, ported from the official [MemSearch](https://github.com/zilliztech/memsearch) host plugins. Markdown is the source of truth; a Milvus index is a rebuildable shadow.

## What it does

- **Capture** (`hooks/stop.mjs`): when a task ends, the hook condenses the task's transcript and hands it to a background subagent, which appends a third-person journal entry (2–10 bullets, in the user's language) to `<project git root>/.memsearch/memory/YYYY-MM-DD.md` and refreshes the search index. No extra API key — the subagent runs on the harness's own model.
- **Recall hint** (`hooks/user-prompt.mjs`): on every substantial user prompt, injects a short hint naming the project's collection, so the agent knows memory is searchable.
- **Recall** (`skills/memory-recall`): a pull-style skill that searches (`memsearch search`), expands (`memsearch expand`), and optionally deep-drills into the original transcript.

The collection name is `ms_<sanitized_basename>_<sha256(project path)[:8]>`, derived the same way as the official plugins, so a project's memory can be shared across harnesses (best effort — the hash covers the absolute path spelling).

## Setup

The plugin is inert until the memsearch CLI is on the server's PATH:

```bash
uv tool install "memsearch[onnx]"   # or: pip install "memsearch[onnx]"
memsearch config set embedding.provider onnx
```

The ONNX embedder (bge-m3) runs locally on CPU with no API key; the first index run downloads the model (~558 MB) from HuggingFace. Behind a firewall, set `HF_ENDPOINT=https://hf-mirror.com` or configure an OpenAI/Ollama embedder instead (`memsearch config set embedding.provider openai`). The default Milvus Lite backend stores the index in a single local file — zero configuration.

Then install the plugin into the library (`penguin plugin install plugins/memsearch`) and add it to an agent from the Plugins page. Hooks and skills take effect from the agent's next context.

## Requirements

- Node (the hooks run with the harness's own Node) and the `memsearch` CLI (or `uvx`) on the server process's PATH.
- Python 3.10+ for the CLI itself.