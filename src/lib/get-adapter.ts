import type { GrokBuildAdapter } from "./types";
import { getMockAdapter } from "./mock-adapter";
import { RemoteGrokAdapter } from "./remote-adapter";

export function getAdapter(): GrokBuildAdapter {
  const mode = process.env.GROK_ADAPTER ?? "mock";
  if (mode === "remote") {
    const url = process.env.GROK_ACP_URL ?? process.env.GROK_REMOTE_URL;
    return new RemoteGrokAdapter(url);
  }
  return getMockAdapter();
}
