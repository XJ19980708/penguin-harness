# One Sys interface behind the sandbox, the machines and the cloud computers

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`

[中文版](2026-10-20-unified-sys-interface.zh.md)

The places work happens — this host, a sandbox, a machine, a cloud computer — each had their own bespoke abstraction: the file tools worked through their port, the sandbox rewrote an exec argv, the machines carried a transport and a command set. A new capability interface puts one vocabulary behind all of them: `Sys`, a world whose capabilities are each optional — files (`fs`), command execution (`exec`), network endpoints (`listen`) — reached through the `@prismshadow/penguin-core/sys` subpath, so a provider compiles against the contract the same way it does against the plugin contract.

## Details

- The `fs` capability is the surface the file tools already work through, unchanged — `HostSys` hands out the tools' in-process port, so a file read over the host's Sys is byte-for-byte what an unconfined Session does today. The `sandboxed` marker that tells error wording whether a refusal is a confinement rides along.
- `HostSys` is the host's default world (`createSys()`), the default rather than a base class: a sandbox, a machine or a cloud computer provides its own Sys beside it, not under it. The host's `exec` runs the exact argv as a child process; the host's `listen` binds loopback by default and opens and reaches endpoints.
- Every derivation names the capabilities it requires and refuses a Sys that does not carry them (`SYS_CAPABILITY_ABSENT`, with the capability named) — absent is never skipped and never quietly rerouted to another world. The interface grows by adding optional members, so a provider written against an earlier revision stays valid.
- `createReadFileTool(sys)` binds the built-in `read_file` to a Sys's `fs`; `createAgent(sys, opts?)` returns the SDK's own agent on the host default and, on any other Sys, a plain refusal naming where that arrives; `forwardPort(sysX, sysY, portX, portY?)` answers connections on one Sys from a port on the other's loopback, each connection its own pair of streams, a refused destination closing that connection while the forward keeps serving. A server-start derivation (`runServer(sys, port)`) is named by the interface's docs as the seam the machine-side step lands in.
- New tests pin the optionality and the fail-closed rule, the host's three capabilities, each derivation over both the host default and a stub world, and an end-to-end forward between two Sys.
