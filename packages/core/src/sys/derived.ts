/**
 * What derives from a Sys: the point of the capability interface is that a feature stops
 * being written against one hard-wired world. A file-reading tool, an agent, a port forward
 * — each takes its world as a parameter, and works unchanged over the host default, a
 * sandbox, a machine or a cloud computer that provides the capabilities it needs.
 *
 * Each derivation names the capabilities it requires and throws when its Sys does not carry
 * them (see sysCapabilityError): absent is refused, never quietly rerouted.
 */
import { createAgent as createHostAgent } from "../agent.js";
import type { Agent, CreateAgentOptions } from "../agent.js";
import { defaultBuiltinToolConfig } from "../state/default-config.js";
import {
  createReadFileTool as createBuiltinReadFileTool,
  READ_FILE_NAME,
} from "../environment/tools/read-file.js";
import type { BuiltinTool, ToolExecutionContext, ToolResult } from "../environment/tools/types.js";
import type { ToolDefinitionConfig } from "../interfaces/index.js";
import type { OmniMessage } from "../omnimessage/index.js";
import { HostSys } from "./host.js";
import type { Fs, Listen, PortForward, Sys, SysCapability, SysConnection } from "./types.js";
import { sysCapabilityError } from "./types.js";

/** The capability `sys` carries under `capability`, or the fail-closed error. */
function requireCapability<T>(sys: Sys, capability: SysCapability, derivation: string): T {
  const value = sys[capability];
  if (value === undefined) throw sysCapabilityError(derivation, capability);
  return value as T;
}

/**
 * The read_file tool bound to one Sys: the built-in implementation with its file system
 * pinned to `sys.fs`, so the same tool reads a file on whichever world provided the
 * capability — the host's files today, a sandbox's or a machine's files when that Sys
 * arrives. Relative paths still resolve against the caller's workspace; a definition is
 * only overridden when the caller brings its own.
 */
export function createReadFileTool(
  sys: Sys,
  definition: ToolDefinitionConfig = defaultBuiltinToolConfig(READ_FILE_NAME),
): BuiltinTool {
  const fs = requireCapability<Fs>(sys, "fs", "createReadFileTool");
  const builtin = createBuiltinReadFileTool(definition);
  return {
    name: builtin.name,
    definition,
    async *execute(
      args: Record<string, unknown>,
      ctx: ToolExecutionContext,
    ): AsyncGenerator<OmniMessage, ToolResult | void> {
      // The Sys is the tool's world: its port answers every file effect, in place of the
      // Session's own. The builtin's own result (a failed read's stop reason) passes through.
      return yield* builtin.execute(args, { ...ctx, fs });
    },
  };
}

/**
 * An agent on one Sys. The host default answers today: an agent on `HostSys` is the agent
 * the SDK already builds (`createAgent`), its tools working this process's files and
 * commands. Another Sys answers with a plain refusal naming where this is going: an agent
 * on a sandbox, a machine or a cloud computer arrives with that provider, when the
 * built-in tools take their world from the Sys — the interface and this seam stay as they
 * are while that lands.
 */
export async function createAgent(sys: Sys, opts: CreateAgentOptions = {}): Promise<Agent> {
  requireCapability<unknown>(sys, "fs", "createAgent");
  requireCapability<unknown>(sys, "exec", "createAgent");
  if (!(sys instanceof HostSys)) {
    throw new Error(
      "createAgent runs on the host's Sys today; an agent on another Sys arrives with that Sys's provider",
    );
  }
  return createHostAgent(opts);
}

/** Pumps one connection into another until either end closes. */
async function pump(from: SysConnection, to: SysConnection): Promise<void> {
  for (;;) {
    const chunk = await from.read();
    if (chunk === null) return;
    await to.write(chunk);
  }
}

/**
 * Forwards a port from one Sys to another: connections opened on `sysY`'s `portY` are
 * answered by `sysX`'s `portX` on its own loopback — the place that Sys's services live.
 * `portY` defaults to `portX` (the same number on the other world); it names another number
 * when the destination port is taken on `sysY`'s side, and 0 lets the provider pick, with
 * the bound number on the returned forward. Each connection is its own pair of streams; a
 * destination that refuses one connection closes that connection and the forward keeps
 * serving — ending the forward is the caller's `close()`.
 */
export async function forwardPort(
  sysX: Sys,
  sysY: Sys,
  portX: number,
  portY: number = portX,
): Promise<PortForward> {
  const listenX = requireCapability<Listen>(sysX, "listen", "forwardPort");
  const listenY = requireCapability<Listen>(sysY, "listen", "forwardPort");
  if (!Number.isInteger(portX) || portX < 1 || portX > 65535) throw new Error(`bad port ${portX}`);
  if (!Number.isInteger(portY) || portY < 0 || portY > 65535) throw new Error(`bad port ${portY}`);
  const listener = await listenY.listen(portY);
  const live = new Set<SysConnection>();
  let closing = false;
  const serve = (async (): Promise<void> => {
    try {
      for (;;) {
        const inbound = await listener.accept();
        if (closing) {
          void inbound.close();
          continue;
        }
        live.add(inbound);
        void (async (): Promise<void> => {
          let upstream: SysConnection | null = null;
          try {
            upstream = await listenX.connect("127.0.0.1", portX);
            live.add(upstream);
            await Promise.all([pump(inbound, upstream), pump(upstream, inbound)]);
          } catch {
            // A connection that cannot be paired ends; the forward itself is unaffected.
          } finally {
            await Promise.allSettled([inbound.close(), upstream?.close() ?? Promise.resolve()]);
            live.delete(inbound);
            if (upstream) live.delete(upstream);
          }
        })();
      }
    } catch {
      // The listener closed (or failed): the forward is done; close() joins below.
    }
  })();
  return {
    port: listener.port,
    async close(): Promise<void> {
      if (closing) return;
      closing = true;
      await listener.close();
      await Promise.allSettled([...live].map((conn) => conn.close()));
      await serve;
    },
  };
}
