/**
 * The Sys capability interface — one world with optional capabilities (files, command
 * execution, network endpoints), the host's default world behind `createSys()`, and the
 * features that derive from whichever world carries what they need.
 *
 * Its own subpath (`@prismshadow/penguin-core/sys`) so a provider compiles against the
 * contract the same way the plugin contract is reached through `/plugin`; the top-level
 * entry keeps its existing names.
 */
export type {
  ConnectOptions,
  Exec,
  ExecExit,
  ExecOptions,
  ExecProcess,
  Fs,
  Listen,
  ListenOptions,
  PortForward,
  Sys,
  SysCapability,
  SysCapabilityError,
  SysConnection,
  SysListener,
} from "./types.js";
export { SYS_CAPABILITY_ABSENT, sysCapabilityError } from "./types.js";
export { HostSys, createSys } from "./host.js";
export { createAgent, createReadFileTool, forwardPort } from "./derived.js";
