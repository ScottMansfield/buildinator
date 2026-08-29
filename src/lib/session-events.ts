import type { SessionStreamEvent } from "./types";

export type SessionEventHandler = (event: SessionStreamEvent) => void;

type Bus = {
  listeners: Map<string, Set<SessionEventHandler>>;
};

const globalForEvents = globalThis as unknown as { __buildinatorEvents?: Bus };

function bus(): Bus {
  if (!globalForEvents.__buildinatorEvents) {
    globalForEvents.__buildinatorEvents = { listeners: new Map() };
  }
  return globalForEvents.__buildinatorEvents;
}

export function subscribe(id: string, fn: SessionEventHandler): () => void {
  const listeners = bus().listeners;
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(fn);
  return () => unsubscribe(id, fn);
}

export function unsubscribe(id: string, fn: SessionEventHandler): void {
  const listeners = bus().listeners;
  const set = listeners.get(id);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(id);
}

export function emit(id: string, event: SessionStreamEvent): void {
  const set = bus().listeners.get(id);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch (err) {
      console.error("session-events listener failed", err);
    }
  }
}
