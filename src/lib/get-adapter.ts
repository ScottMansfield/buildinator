import type { GrokBuildAdapter, SessionUser } from "./types";
import { getMockAdapter } from "./mock-adapter";
import { RemoteGrokAdapter } from "./remote-adapter";
import { requireAccountWrite } from "./acl";

const WRITE_METHODS = new Set<string>([
  "createProject",
  "createSession",
  "renameSession",
  "sendPrompt",
  "forkSession",
  "resumeSession",
  "compactSession",
  "rewindSession",
  "cancelSession",
  "shareSession",
  "listShares",
  "revokeShare",
  "revokeAllShares",
  "deleteSession",
  "destroySandbox",
]);

function withAccountWriteGate(adapter: GrokBuildAdapter): GrokBuildAdapter {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (!WRITE_METHODS.has(String(prop))) {
        return fn.bind(target);
      }
      return (user: SessionUser, ...args: unknown[]) => {
        requireAccountWrite(user.role);
        return fn.call(target, user, ...args);
      };
    },
  });
}

export function getAdapter(): GrokBuildAdapter {
  const mode = process.env.GROK_ADAPTER ?? "mock";
  // acp: sqlite metadata + grok ACP stdio (grok agent --always-approve stdio).
  // cli/grok: sqlite metadata + spawn grok -p (see mock-adapter).
  // mock: canned replies.
  // remote: throwing ACP HTTP stub (GROK_ACP_URL unused until session/serve is wired).
  if (mode === "remote") {
    const url = process.env.GROK_ACP_URL ?? process.env.GROK_REMOTE_URL;
    return withAccountWriteGate(new RemoteGrokAdapter(url));
  }
  return withAccountWriteGate(getMockAdapter());
}
