import type { GrokBuildAdapter } from "./types";
import { getMockAdapter } from "./mock-adapter";
import { RemoteGrokAdapter } from "./remote-adapter";

export function getAdapter(): GrokBuildAdapter {
  const mode = process.env.GROK_ADAPTER ?? "mock";
  if (mode === "remote") {
    return new RemoteGrokAdapter(process.env.GROK_REMOTE_URL);
  }
  return getMockAdapter();
}
