/**
 * The Sys capability interface (src/sys): the contract's optionality and its fail-closed
 * rule, the host's default world (HostSys — the file tools' in-process port, child
 * processes, loopback endpoints), and the features that derive from whichever world
 * carries what they need — a read tool bound to a Sys's files, an agent on the host's Sys,
 * and a port forward between two Sys.
 *
 * Directly drives the derived BuiltinTool like file-tools.test.ts drives the built-ins;
 * the real I/O here is the point (temp files, child node processes, loopback sockets).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, type AddressInfo, type Socket } from "node:net";
import {
  createAgent,
  createReadFileTool,
  createSys,
  forwardPort,
  HostSys,
  SYS_CAPABILITY_ABSENT,
  sysCapabilityError,
} from "../src/sys/index.js";
import type { Fs, Sys, SysCapability } from "../src/sys/index.js";
import { localFsPort } from "../src/environment/tools/fs-port.js";
import {
  createReadFileTool as createBuiltinReadFileTool,
  READ_FILE_NAME,
} from "../src/environment/tools/read-file.js";
import type { BuiltinTool, ToolResult } from "../src/environment/tools/types.js";
import type { OmniMessage } from "../src/omnimessage/index.js";
import { Agent, DEFAULT_AGENT_ID } from "../src/index.js";
import { seedProject } from "./seeded-project.js";

let tmp: string;
let prevHome: string | undefined;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "penguin-sys-"));
  prevHome = process.env.PENGUIN_HOME;
  process.env.PENGUIN_HOME = tmp;
  await seedProject(tmp);
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await rm(tmp, { recursive: true, force: true });
});

/** A Sys with none of the capabilities — a valid world that offers nothing. */
const bareSys: Sys = {};

/** Asserts the sync call threw the named capability error (the fail-closed rule). */
function expectCapabilityError(fn: () => unknown, capability: SysCapability): void {
  try {
    fn();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(SYS_CAPABILITY_ABSENT);
    expect((err as { capability?: string }).capability).toBe(capability);
    return;
  }
  throw new Error("expected the derivation to refuse the Sys");
}

/** Asserts the async call rejected with the named capability error. */
async function expectRejectsCapability(
  promise: Promise<unknown>,
  capability: SysCapability,
): Promise<void> {
  try {
    await promise;
  } catch (err) {
    expect((err as { code?: string }).code).toBe(SYS_CAPABILITY_ABSENT);
    expect((err as { capability?: string }).capability).toBe(capability);
    return;
  }
  throw new Error("expected the derivation to refuse the Sys");
}

/** Runs one tool execution: concatenates text deltas and captures the generator's return value. */
async function run(tool: BuiltinTool, args: Record<string, unknown>, workspaceDir: string) {
  const gen = tool.execute(args, { workspaceDir, toolCallId: "c1" });
  const messages: OmniMessage[] = [];
  let result: ToolResult | void;
  for (;;) {
    const res = await gen.next();
    if (res.done) {
      result = res.value;
      break;
    }
    messages.push(res.value);
  }
  const text = messages.map((m) => (m.payload as { output?: string }).output ?? "").join("");
  return { result, text };
}

/** Collects an output stream into one buffer. */
async function drain(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** A raw echo server on this host's loopback: the forward's upstream for these tests. */
async function echoUpstream(): Promise<{ port: number; close: () => Promise<void> }> {
  const live = new Set<Socket>();
  const server = createServer((socket) => {
    live.add(socket);
    socket.once("close", () => live.delete(socket));
    socket.pipe(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        // The server ends its own connections first: close() alone would wait each
        // caller out instead.
        for (const socket of live) socket.destroy();
        live.clear();
        server.close(() => resolve());
      }),
  };
}

describe("the Sys contract", () => {
  it("createSys() returns the host default carrying all three capabilities", () => {
    const sys = createSys();
    expect(sys).toBeInstanceOf(HostSys);
    expect(sys.fs).toBeDefined();
    expect(sys.exec).toBeDefined();
    expect(sys.listen).toBeDefined();
  });

  it("a Sys may carry none of the capabilities", () => {
    const sys: Sys = {};
    expect(sys.fs).toBeUndefined();
    expect(sys.exec).toBeUndefined();
    expect(sys.listen).toBeUndefined();
  });

  it("every derivation refuses a Sys that lacks the capability it needs", async () => {
    expectCapabilityError(() => createReadFileTool(bareSys), "fs");
    await expectRejectsCapability(createAgent(bareSys), "fs");
    const withFsOnly: Sys = { fs: localFsPort };
    await expectRejectsCapability(createAgent(withFsOnly), "exec");
    await expectRejectsCapability(forwardPort(bareSys, bareSys, 80), "listen");
    await expectRejectsCapability(forwardPort(createSys(), bareSys, 80), "listen");
  });

  it("the error names the derivation and the missing capability", () => {
    const err = sysCapabilityError("forwardPort", "listen");
    expect(err.code).toBe(SYS_CAPABILITY_ABSENT);
    expect(err.capability).toBe("listen");
    expect(err.message).toContain("forwardPort");
    expect(err.message).toContain("listen");
  });
});

describe("HostSys", () => {
  it("fs is the file tools' in-process port", async () => {
    const sys = createSys();
    expect(sys.fs?.sandboxed).toBe(false);
    const file = path.join(tmp, "host-fs.txt");
    await sys.fs?.writeFileAtomic(file, Buffer.from("contents"), {});
    expect((await sys.fs?.readFile(file))?.toString("utf8")).toBe("contents");
    const range = await sys.fs?.readRange(file, 0, 4);
    expect(range?.toString("utf8")).toBe("cont");
    expect((await sys.fs?.stat(file))?.size).toBe(8);
  });

  it("exec runs the exact argv and streams its output", async () => {
    const sys = createSys();
    const proc = await sys.exec!.exec([process.execPath, "-e", "process.stdout.write('hi')"]);
    expect((await drain(proc.stdout)).toString("utf8")).toBe("hi");
    await expect(proc.exit).resolves.toEqual({ code: 0, signal: null });
  });

  it("exec keeps one argument with spaces as one argument", async () => {
    const sys = createSys();
    const proc = await sys.exec!.exec([
      process.execPath,
      "-e",
      "process.stdout.write(process.argv[1])",
      "a b",
    ]);
    expect((await drain(proc.stdout)).toString("utf8")).toBe("a b");
    await expect(proc.exit).resolves.toEqual({ code: 0, signal: null });
  });

  it("exec collects stderr and settles a failing exit code", async () => {
    const sys = createSys();
    const proc = await sys.exec!.exec([
      process.execPath,
      "-e",
      "process.stderr.write('bad'); process.exit(3)",
    ]);
    expect((await drain(proc.stderr)).toString("utf8")).toBe("bad");
    await expect(proc.exit).resolves.toEqual({ code: 3, signal: null });
  });

  it("exec kill settles the exit with the signal", async () => {
    const sys = createSys();
    const proc = await sys.exec!.exec([process.execPath, "-e", "setInterval(() => {}, 1000)"]);
    proc.kill();
    const exit = await proc.exit;
    expect(exit.code).toBeNull();
    expect(exit.signal).not.toBeNull();
  });

  it("exec rejects the exit when the program does not exist", async () => {
    const sys = createSys();
    const proc = await sys.exec!.exec(["/nonexistent/penguin-sys-test-program"]);
    await expect(proc.exit).rejects.toThrow();
  });

  it("exec refuses an empty argv", async () => {
    const sys = createSys();
    await expect(sys.exec!.exec([])).rejects.toThrow(/argv/);
  });

  it("exec honors cwd and environment entries", async () => {
    const sys = createSys();
    const workdir = await mkdtemp(path.join(tmpdir(), "penguin-sys-exec-"));
    try {
      const proc = await sys.exec!.exec(
        [
          process.execPath,
          "-e",
          "process.stdout.write(process.cwd() + '|' + (process.env.PENGUIN_SYS_TEST || ''))",
        ],
        { cwd: workdir, env: { PENGUIN_SYS_TEST: "carried" } },
      );
      const out = (await drain(proc.stdout)).toString("utf8");
      expect(out).toBe(`${workdir}|carried`);
      await expect(proc.exit).resolves.toEqual({ code: 0, signal: null });
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  });

  it("listen binds a picked port and round-trips a connection both ways", async () => {
    const sys = createSys();
    const listener = await sys.listen!.listen(0);
    expect(listener.port).toBeGreaterThan(0);
    const accepted = listener.accept();
    const client = await sys.listen!.connect("127.0.0.1", listener.port);
    const serverSide = await accepted;
    await client.write(Buffer.from("ping"));
    expect((await serverSide.read())?.toString("utf8")).toBe("ping");
    await serverSide.write(Buffer.from("pong"));
    expect((await client.read())?.toString("utf8")).toBe("pong");
    await listener.close();
    // The accepted connection ended with the endpoint: the client's next read sees the end.
    await expect(client.read()).resolves.toBeNull();
    await expect(listener.accept()).rejects.toThrow(/closed/);
  });

  it("an abort signal closes the listener and rejects its pending accepts", async () => {
    const sys = createSys();
    const controller = new AbortController();
    const listener = await sys.listen!.listen(0, { signal: controller.signal });
    const pending = listener.accept();
    const port = listener.port;
    controller.abort();
    await expect(pending).rejects.toThrow(/closed/);
    await listener.close();
    await expect(sys.listen!.connect("127.0.0.1", port)).rejects.toThrow();
  });

  it("connect to a port nothing listens on rejects", async () => {
    const sys = createSys();
    const dead = await echoUpstream();
    const port = dead.port;
    await dead.close();
    await expect(sys.listen!.connect("127.0.0.1", port)).rejects.toThrow();
  });
});

describe("createReadFileTool over a Sys", () => {
  it("reads a workspace-relative file through the host's Sys in cat -n style", async () => {
    await writeFile(path.join(tmp, "note.txt"), "alpha\nbeta\ngamma\n");
    const tool = createReadFileTool(createSys());
    expect(tool.name).toBe(READ_FILE_NAME);
    const { result, text } = await run(tool, { file_path: "note.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text.split("\n")).toEqual(["     1\talpha", "     2\tbeta", "     3\tgamma"]);
  });

  it("windows an offset/limit like the built-in tool", async () => {
    await writeFile(path.join(tmp, "three.txt"), "one\ntwo\nthree\n");
    const tool = createReadFileTool(createSys());
    const { text } = await run(tool, { file_path: "three.txt", limit: 1 }, tmp);
    expect(text).toContain("     1\tone");
    expect(text).toContain("call again with offset");
  });

  it("reads through the Sys's own port, not this process's files", async () => {
    // The stub world answers every file with the same bytes; the file does not exist on
    // this host at all, so a tool still reading this process's files would fail instead.
    const bytes = Buffer.from("stub world\n");
    const stubFs: Fs = {
      ...localFsPort,
      async stat() {
        return { isFile: true, isDirectory: false, size: bytes.length, mode: 0o644 };
      },
      async readRange(_target: string, position: number, length: number) {
        const rest = bytes.subarray(position);
        return rest.length === 0 ? Buffer.alloc(0) : Buffer.from(rest.subarray(0, length));
      },
    };
    const tool = createReadFileTool({ fs: stubFs });
    const { result, text } = await run(tool, { file_path: "anywhere.txt" }, tmp);
    expect(result?.stopReason).toBeUndefined();
    expect(text).toContain("     1\tstub world");
  });

  it("a missing file ends with the built-in tool's explanatory failure", async () => {
    const tool = createReadFileTool(createSys());
    const { result, text } = await run(tool, { file_path: "not-there.txt" }, tmp);
    expect(result?.stopReason).toBe("fatal");
    expect(text).toContain("not-there.txt");
  });

  it("the definition defaults to the built-in entry, and a caller's own overrides it", () => {
    const builtin = createBuiltinReadFileTool({ name: READ_FILE_NAME, description: "test" });
    expect(builtin.definition.description).toBe("test");
    const defaulted = createReadFileTool(createSys());
    expect(defaulted.definition.description).toContain("Read a file");
    expect(defaulted.definition.parameters).toBeDefined();
    const overridden = createReadFileTool(createSys(), {
      name: READ_FILE_NAME,
      description: "own",
    });
    expect(overridden.definition.description).toBe("own");
  });
});

describe("createAgent over a Sys", () => {
  it("an agent on the host's Sys is the SDK's own agent", async () => {
    const agent = await createAgent(createSys());
    expect(agent).toBeInstanceOf(Agent);
    expect(agent.state.agentId).toBe(DEFAULT_AGENT_ID);
  });

  it("a Sys that is not the host default refuses, naming where this is going", async () => {
    const otherWorld: Sys = { fs: localFsPort, exec: createSys().exec };
    await expect(createAgent(otherWorld)).rejects.toThrow(/arrives with that Sys's provider/);
  });
});

describe("forwardPort between two Sys", () => {
  it("forwards connections from one Sys to a port on the other's loopback", async () => {
    const sysX = createSys();
    const sysY = createSys();
    const upstream = await echoUpstream();
    try {
      const forward = await forwardPort(sysX, sysY, upstream.port, 0);
      expect(forward.port).toBeGreaterThan(0);
      const client = await sysY.listen!.connect("127.0.0.1", forward.port);
      await client.write(Buffer.from("ping"));
      expect((await client.read())?.toString("utf8")).toBe("ping");
      await client.close();
      await forward.close();
    } finally {
      await upstream.close();
    }
  });

  it("a destination that refuses closes that connection and the forward keeps serving", async () => {
    const sysX = createSys();
    const sysY = createSys();
    const dead = await echoUpstream();
    const deadPort = dead.port;
    await dead.close();
    const forward = await forwardPort(sysX, sysY, deadPort, 0);
    try {
      const first = await sysY.listen!.connect("127.0.0.1", forward.port);
      await first.write(Buffer.from("ping"));
      expect(await first.read()).toBeNull();
      await first.close();
      // The forward itself survived the refused pairing: it still accepts.
      const second = await sysY.listen!.connect("127.0.0.1", forward.port);
      expect(await second.read()).toBeNull();
      await second.close();
    } finally {
      await forward.close();
    }
  });

  it("close ends the forward: the port stops answering", async () => {
    const sysX = createSys();
    const sysY = createSys();
    const upstream = await echoUpstream();
    try {
      const forward = await forwardPort(sysX, sysY, upstream.port, 0);
      await forward.close();
      await forward.close(); // idempotent
      await expect(sysY.listen!.connect("127.0.0.1", forward.port)).rejects.toThrow();
    } finally {
      await upstream.close();
    }
  });

  it("portY defaults to portX — the same number on the other world", async () => {
    const sys = createSys();
    const upstream = await echoUpstream();
    try {
      // On one world, the default number would collide with the destination itself.
      await expect(forwardPort(sys, sys, upstream.port)).rejects.toThrow();
    } finally {
      await upstream.close();
    }
  });

  it("a bad port number is refused", async () => {
    const sys = createSys();
    await expect(forwardPort(sys, sys, 0, 0)).rejects.toThrow(/bad port/);
    await expect(forwardPort(sys, sys, 70000)).rejects.toThrow(/bad port/);
  });
});
