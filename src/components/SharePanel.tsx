"use client";

import { FormEvent, useState } from "react";
import type { SessionShare, ShareRole } from "@/lib/types";

type Props = {
  open: boolean;
  shares: SessionShare[];
  onClose: () => void;
  onAdd: (username: string, role: ShareRole) => Promise<void>;
  onRevoke: (shareId: string) => Promise<void>;
  onRevokeAll: () => Promise<void>;
};

export function SharePanel({
  open,
  shares,
  onClose,
  onAdd,
  onRevoke,
  onRevokeAll,
}: Props) {
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<ShareRole>("read");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!open) return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await onAdd(username.trim(), role);
      setUsername("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "share failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="share-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="share-title">Share session</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            close
          </button>
        </header>
        <p className="modal-copy">
          Owner-only. Read-only can view chat and artifacts. Read-write can
          prompt, rename, compact, rewind. Destructive actions stay with you.
        </p>
        <form className="share-form" onSubmit={(e) => void submit(e)}>
          <input
            className="input"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value === "write" ? "write" : "read")}
          >
            <option value="read">read-only</option>
            <option value="write">read-write</option>
          </select>
          <button className="btn btn-accent" type="submit" disabled={pending}>
            add
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
        <ul className="share-list">
          {shares.length === 0 ? (
            <li className="muted">No shares yet.</li>
          ) : (
            shares.map((s) => (
              <li key={s.id}>
                <span>
                  {s.username} · {s.role === "write" ? "read-write" : "read-only"}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void onRevoke(s.id)}
                >
                  revoke
                </button>
              </li>
            ))
          )}
        </ul>
        {shares.length > 0 ? (
          <button type="button" className="btn" onClick={() => void onRevokeAll()}>
            revoke all shares
          </button>
        ) : null}
      </div>
    </div>
  );
}
