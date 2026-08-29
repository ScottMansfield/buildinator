import type { ActivityPhase, SessionDetail } from "./types";
import { toolsInFlight } from "./stream-merge";

export type { ActivityPhase };

export type SessionActivity = {
  phase: "idle" | ActivityPhase;
  phaseStartedAt: number;
  lastEventAt: number;
};

/** Client-only ended-phase breadcrumb. Not persisted. */
export type PhaseCrumb = {
  id: string;
  phase: ActivityPhase;
  ms: number;
};

export const IDLE_ACTIVITY: SessionActivity = {
  phase: "idle",
  phaseStartedAt: 0,
  lastEventAt: 0,
};

export { formatElapsed, formatUpdatedAgo } from "./format";

export function bumpActivity(
  prev: SessionActivity,
  phase: SessionActivity["phase"],
  now = Date.now(),
): SessionActivity {
  if (prev.phase === phase) return { ...prev, lastEventAt: now };
  return { phase, phaseStartedAt: now, lastEventAt: now };
}

/**
 * Header overlay. session.status stays idle|running|error in sqlite;
 * this never shows idle while a turn is sending, sqlite is running, or a tool is pending.
 */
export function resolveActivity(
  session: SessionDetail | null,
  sending: boolean,
  overlay: SessionActivity,
  now = Date.now(),
): SessionActivity {
  const toolsBusy = session ? toolsInFlight(session.toolCalls) : false;
  const inFlight = Boolean(
    sending || session?.status === "running" || toolsBusy,
  );
  if (!inFlight) {
    return overlay.phase === "idle"
      ? overlay
      : { phase: "idle", phaseStartedAt: overlay.lastEventAt || now, lastEventAt: overlay.lastEventAt };
  }
  if (overlay.phase !== "idle") {
    return overlay;
  }
  const phase: SessionActivity["phase"] = toolsBusy ? "working" : "thinking";
  const started = overlay.phaseStartedAt || now;
  return {
    phase,
    phaseStartedAt: started,
    lastEventAt: overlay.lastEventAt || now,
  };
}
