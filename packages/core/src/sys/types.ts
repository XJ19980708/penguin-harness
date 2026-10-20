/**
 * Sys — the capability interface that answers "where does this actually happen".
 *
 * A Sys is one world with optional capabilities: files (`fs`), command execution (`exec`),
 * and network endpoints (`listen`). The host is the default world (see host.ts, `HostSys`);
 * a sandbox, a machine or a cloud computer provides its own. A capability is present or
 * absent, never silently substituted: a derivation that needs one a Sys does not carry
 * throws {@link sysCapabilityError} instead of quietly running somewhere else — the same
 * fail-closed rule the sandbox vocabulary applies to its dimensions.
 *
 * The interface grows by ADDING optional members (a later revision may name more
 * capabilities); existing members keep their meaning, so a provider written against an
 * earlier revision stays valid for the capabilities it already carried.
 *
 * Nothing here emits runtime code except the error factory: like the plugin contract, the
 * shapes are what a provider compiles against.
 */
import type { FsPort } from "../environment/tools/fs-port.js";

/**
 * The file capability: the exact surface the file tools already work through
 * (see environment/tools/fs-port.ts) — plain stat facts, whole or ranged reads, atomic
 * writes, each spelled so an implementation can carry it over a process or a wire. The
 * `sandboxed` marker says whether a refused effect is a confinement refusing it (so error
 * wording names the refusal) — false for a plain world, true for a confined one.
 */
export interface Fs extends FsPort {
  readonly sandboxed: boolean;
}

/** One command run's exit: `code` when the process ran to the end, `signal` when it was killed. */
export interface ExecExit {
  readonly code: number | null;
  readonly signal: string | null;
}

/** A started command: its two output streams, its awaited exit, and the means to end it. */
export interface ExecProcess {
  /**
   * Standard output as it is produced. A stream nobody consumes eventually stalls the
   * process when its pipe fills — a caller that does not want the output still drains or
   * closes the process.
   */
  readonly stdout: AsyncIterable<Buffer>;
  /** Standard error, same contract as {@link stdout}. */
  readonly stderr: AsyncIterable<Buffer>;
  /** Settles once the process is reaped; rejects when the spawn itself failed (no such program). */
  readonly exit: Promise<ExecExit>;
  /** Ends the process (SIGTERM unless a signal is named); {@link exit} still settles. */
  kill(signal?: string): void;
}

/** Options of one {@link Exec.exec} call. */
export interface ExecOptions {
  /** The run's working directory on that Sys. */
  readonly cwd?: string;
  /** Entries laid over the Sys's own environment. */
  readonly env?: Readonly<Record<string, string>>;
  /** Aborts the run: the process is killed and {@link ExecProcess.exit} settles with the signal. */
  readonly signal?: AbortSignal;
}

/** The execution capability: runs one argv on that Sys, no shell between. */
export interface Exec {
  /**
   * Starts `argv` as the exact program invocation (first element the program, the rest its
   * arguments — never a shell string, the same argv discipline the confinement seam applies).
   */
  exec(argv: readonly string[], opts?: ExecOptions): Promise<ExecProcess>;
}

/** One open byte stream to a peer on a Sys, pulled chunk by chunk. */
export interface SysConnection {
  /** Sends one chunk; resolves on a closed connection without sending — a pump learns of closure from {@link read}. */
  write(data: Buffer): Promise<void>;
  /** Resolves the next chunk, or null once the peer is gone and the buffer is drained. */
  read(): Promise<Buffer | null>;
  /** Ends the stream; idempotent. */
  close(): Promise<void>;
}

/** One listening endpoint a Sys opened. */
export interface SysListener {
  /** The port bound: the caller's number, or the provider's pick when it asked for 0. */
  readonly port: number;
  /** Resolves the next accepted connection; rejects once the listener is closed. */
  accept(): Promise<SysConnection>;
  /** Stops accepting and closes the endpoint with the connections it accepted; idempotent. */
  close(): Promise<void>;
}

/** Options of one {@link Listen.listen} call. */
export interface ListenOptions {
  /** The interface to bind; a provider defaults to its own loopback. */
  readonly host?: string;
  /** Aborts the listen: the listener closes and pending accepts reject. */
  readonly signal?: AbortSignal;
}

/** Options of one {@link Listen.connect} call. */
export interface ConnectOptions {
  /** Aborts the attempt before it completes. */
  readonly signal?: AbortSignal;
}

/** The network capability: opens and reaches endpoints on that Sys. */
export interface Listen {
  /** Listens on `port` (0 = the provider picks); resolves once the endpoint is bound. */
  listen(port: number, opts?: ListenOptions): Promise<SysListener>;
  /** Reaches `host:port` from that Sys; rejects when the endpoint does not answer. */
  connect(host: string, port: number, opts?: ConnectOptions): Promise<SysConnection>;
}

/**
 * One world with its capabilities, each optional: a Sys states what it can do by carrying
 * the member, and what it cannot by leaving it out. New capabilities are added as new
 * optional members by later revisions of this interface.
 */
export interface Sys {
  /** Files as the file tools see them (see {@link Fs}); absent = this world has no files to offer. */
  readonly fs?: Fs;
  /** Command execution (see {@link Exec}); absent = nothing runs here. */
  readonly exec?: Exec;
  /** Network endpoints (see {@link Listen}); absent = no port opens or answers here. */
  readonly listen?: Listen;
}

/** The capabilities this interface names today. */
export type SysCapability = "fs" | "exec" | "listen";

/** The error code of {@link sysCapabilityError}. */
export const SYS_CAPABILITY_ABSENT = "SYS_CAPABILITY_ABSENT";

/** What {@link sysCapabilityError} returns: the code, and the capability that was missing. */
export interface SysCapabilityError extends Error {
  readonly code: typeof SYS_CAPABILITY_ABSENT;
  readonly capability: SysCapability;
}

/**
 * The error a derivation throws when its Sys does not carry a capability it needs. Absent
 * is never skipped and never defaulted to another world — the derivation names what it
 * needed and stops.
 */
export function sysCapabilityError(
  derivation: string,
  capability: SysCapability,
): SysCapabilityError {
  const error = new Error(
    `${derivation} requires a Sys that carries ${capability}; this Sys carries none.`,
  ) as SysCapabilityError;
  Object.assign(error, { code: SYS_CAPABILITY_ABSENT, capability });
  return error;
}

/** A running port forward between two Sys (see sys/derived.ts, `forwardPort`). */
export interface PortForward {
  /** The listening port the forward answers on — `portY` as bound (the provider's pick when it was 0). */
  readonly port: number;
  /** Stops the forward: the listener closes and every live connection ends; idempotent. */
  close(): Promise<void>;
}
