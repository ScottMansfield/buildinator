import type { SessionStreamEvent } from "./types";

export type SessionEventHandler = (event: SessionStreamEvent) => void;

const RING = 250;

type Bus = {
  listeners: Map<string, Set<SessionEventHandler>>;
  recent: Map<string, SessionStreamEvent[]>;
};

const globalForEvents = globalThis as unknown as { __buildinatorEvents?: Bus };

function bus(): Bus {
  if (!globalForEvents.__buildinatorEvents) {
    globalForEvents.__buildinatorEvents = {
      listeners: new Map(),
      recent: new Map(),
    };
  }
  return globalForEvents.__buildinatorEvents;
}

export function subscribe(id: string, fn: SessionEventHandler): () => void {
  const b = bus();
  let set = b.listeners.get(id);
  if (!set) {
    set = new Set();
    b.listeners.set(id, set);
  }
  set.add(fn);
  const all = b.recent.get(id) ?? [];
  let start = 0;
  for (let i = 0; i < all.length; i++) {
    if (all[i].type === "done" || all[i].type === "error") start = i + 1;
  }
  const replay = all.slice(start);
  for (const event of replay) {
    try {
      fn(event);
    } catch (err) {
      console.error("session-events replay failed", err);
    }
  }
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
  const b = bus();
  const list = b.recent.get(id) ?? [];
  list.push(event);
  if (list.length > RING) list.splice(0, list.length - RING);
  b.recent.set(id, list);
  const set = b.listeners.get(id);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(event);
    } catch (err) {
      console.error("session-events listener failed", err);
    }
  }
}
