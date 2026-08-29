import type { GrokBuildAdapter } from "./types";
import { getMockAdapter } from "./mock-adapter";
import { RemoteGrokAdapter } from "./remote-adapter";

export function getAdapter(): GrokBuildAdapter {
  const mode = process.env.GROK_ADAPTER ?? "mock";
  // acp: sqlite metadata + grok ACP stdio (grok agent --always-approve stdio).
  // cli/grok: sqlite metadata + spawn grok -p (see mock-adapter).
  // mock: canned replies.
  // remote: throwing ACP HTTP stub (GROK_ACP_URL unused until session/serve is wired).
  if (mode === "remote") {
    const url = process.env.GROK_ACP_URL ?? process.env.GROK_REMOTE_URL;
    return new RemoteGrokAdapter(url);
  }
  return getMockAdapter();
}
