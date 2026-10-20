/**
 * The host's default Sys. `HostSys` is the world the harness process itself runs in: its
 * files are this process's filesystem (the file tools' in-process port, `localFsPort` — the
 * same implementation an unconfined Session already works through), its commands are this
 * process's children, its endpoints are this host's own loopback.
 *
 * A sandbox, a machine or a cloud computer provides its own Sys instead; `HostSys` is the
 * default, not the base class — other providers implement the same interface beside it, not
 * under it. `createSys()` with no arguments returns the host default; a provider that needs
 * constructor knowledge (an address, a layout) takes its own arguments — that is what the
 * factory's argument list is for.
 */
import { spawn } from "node:child_process";
import {
  connect as netConnect,
  createServer as netCreateServer,
  type Socket,
  type AddressInfo,
} from "node:net";
import { localFsPort } from "../environment/tools/fs-port.js";
import type {
  Exec,
  ExecExit,
  ExecOptions,
  ExecProcess,
  Fs,
  Listen,
  ListenOptions,
  ConnectOptions,
  Sys,
  SysConnection,
  SysListener,
} from "./types.js";

/** The host's default Sys: this process's own files, children and loopback. */
export class HostSys implements Sys {
  /** The file tools' in-process port — the same surface an unconfined Session already uses. */
  readonly fs: Fs = localFsPort;
  readonly exec: Exec = hostExec;
  readonly listen: Listen = hostListen;
}

/**
 * Creates a Sys. No arguments means the host default; every other provider takes its own
 * (a machine its address and layout, a cloud computer its instance) — arrived with that
 * provider, not invented here.
 */
export function createSys(): Sys {
  return new HostSys();
}

/** Whether `port` is a port a caller may ask to bind (0 = the provider picks). */
function bindablePort(port: number): boolean {
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}

/** Whether `port` is a port a caller may ask to reach (binding 0 names nothing). */
function reachablePort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** The host's exec: spawns the exact argv as this process's own child. */
const hostExec: Exec = {
  async exec(argv: readonly string[], opts: ExecOptions = {}): Promise<ExecProcess> {
    const program = argv[0];
    if (argv.length === 0 || typeof program !== "string" || program.length === 0) {
      throw new Error("exec needs a non-empty argv: [program, ...args]");
    }
    const child = spawn(program, argv.slice(1), {
      cwd: opts.cwd,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      // The capability runs one command; a child that wants input arrives with the session
      // machinery that owns interactive runs, not with this seam.
      stdio: ["ignore", "pipe", "pipe"],
    });
    opts.signal?.addEventListener("abort", () => child.kill(), { once: true });
    const exit = new Promise<ExecExit>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        resolve({ code: code ?? null, signal: signal ?? null }),
      );
    });
    return {
      // stdio "pipe" always hands a Readable; the declared `| null` is for the other modes.
      stdout: child.stdout as NonNullable<typeof child.stdout> as AsyncIterable<Buffer>,
      stderr: child.stderr as NonNullable<typeof child.stderr> as AsyncIterable<Buffer>,
      exit,
      kill: (signal?: string) => {
        // node types the name it sends as its own signal union; the contract takes any
        // name, and one the platform does not know is the child's own error to report.
        child.kill(signal as NodeJS.Signals | undefined);
      },
    };
  },
};

/** Reads one socket into the pulled-chunk shape a `SysConnection` promises. */
function socketConnection(socket: Socket): SysConnection {
  const chunks: Buffer[] = [];
  const readers: Array<(chunk: Buffer | null) => void> = [];
  let closed = false;
  const deliver = (chunk: Buffer | null): void => {
    const reader = readers.shift();
    if (reader) reader(chunk);
    else if (chunk !== null) chunks.push(chunk);
  };
  socket.on("data", (chunk: Buffer) => {
    deliver(chunk);
  });
  const gone = (): void => {
    if (closed) return;
    closed = true;
    // The peer ended this side's read; the socket is dead for writing too (and a
    // half-closed socket would hold the server that owns it open), so it goes now.
    socket.destroy();
    while (readers.length > 0) deliver(null);
  };
  socket.once("end", gone);
  socket.once("close", gone);
  socket.once("error", () => {
    // A failed connection reads as closed: a pump ends on null, which is the one answer
    // every consumer of this shape has to handle anyway.
    gone();
    socket.destroy();
  });
  return {
    async write(data: Buffer): Promise<void> {
      if (closed || socket.destroyed) return;
      await new Promise<void>((resolve) => {
        if (socket.write(data, () => resolve())) resolve();
      });
    },
    read(): Promise<Buffer | null> {
      const buffered = chunks.shift();
      if (buffered !== undefined) return Promise.resolve(buffered);
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        readers.push(resolve);
      });
    },
    async close(): Promise<void> {
      gone();
      socket.destroy();
    },
  };
}

/** The host's listen: binds this host's own interfaces, loopback by default — binding wider than asked is exposure with nothing requesting it. */
const hostListen: Listen = {
  async listen(port: number, opts: ListenOptions = {}): Promise<SysListener> {
    if (!bindablePort(port)) throw new Error(`bad port ${port}`);
    if (opts.signal?.aborted) throw new Error("the listen was aborted before it began");
    const server = netCreateServer();
    // The endpoint's own end, settled once however it is initiated: an abort and a
    // close() share the platform's one "close" instead of racing two of its own.
    const serverGone = new Promise<void>((resolve) => server.once("close", () => resolve()));
    let serverEnded = false;
    const endServer = (): void => {
      if (!serverEnded) {
        serverEnded = true;
        server.close();
      }
    };
    const queued: Socket[] = [];
    const waiting: Array<{ resolve: (conn: SysConnection) => void; reject: (err: Error) => void }> =
      [];
    // Every connection this endpoint took — handed to a caller or still queued. Ending
    // the endpoint ends them with it: node:net has no server-wide "end every connection"
    // of its own (the http server's closeAllConnections is another class), so the
    // endpoint tracks its own and drops each socket as it goes.
    const live = new Set<Socket>();
    let stopped = false;
    const halt = (): void => {
      if (stopped) return;
      stopped = true;
      for (const socket of queued) socket.destroy();
      queued.length = 0;
      for (const waiter of waiting) waiter.reject(new Error("the listener is closed"));
      waiting.length = 0;
      // An accepted connection is the endpoint's too, so close() answers instead of
      // waiting a caller out for sockets only that caller holds.
      for (const socket of live) socket.destroy();
      live.clear();
    };
    opts.signal?.addEventListener(
      "abort",
      () => {
        halt();
        endServer();
      },
      { once: true },
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, opts.host ?? "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const boundPort =
      typeof address === "object" && address !== null ? (address as AddressInfo).port : port;
    server.on("connection", (socket) => {
      live.add(socket);
      socket.once("close", () => live.delete(socket));
      const waiter = waiting.shift();
      if (waiter) waiter.resolve(socketConnection(socket));
      else queued.push(socket);
    });
    return {
      port: boundPort,
      accept(): Promise<SysConnection> {
        const socket = queued.shift();
        if (socket) return Promise.resolve(socketConnection(socket));
        if (stopped) return Promise.reject(new Error("the listener is closed"));
        return new Promise((resolve, reject) => {
          waiting.push({ resolve, reject });
        });
      },
      async close(): Promise<void> {
        halt();
        endServer();
        await serverGone;
      },
    };
  },
  async connect(host: string, port: number, opts: ConnectOptions = {}): Promise<SysConnection> {
    if (typeof host !== "string" || host.length === 0) throw new Error("connect needs a host");
    if (!reachablePort(port)) throw new Error(`bad port ${port}`);
    const socket = netConnect({ host, port });
    opts.signal?.addEventListener("abort", () => socket.destroy(), { once: true });
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("error", (err: Error) => reject(err));
      // An attempt ended before connecting (an aborted dial destroys the socket with no
      // error) still has to settle the caller's promise.
      socket.once("close", () => reject(new Error("the connection attempt ended")));
    });
    return socketConnection(socket);
  },
};
