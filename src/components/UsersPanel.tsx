"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { ManagedUser, UserRole } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
};

const ROLES: UserRole[] = ["admin", "write", "read"];

export function UsersPanel({ open, onClose }: Props) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("write");
  const [pwFor, setPwFor] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");

  async function refresh() {
    const data = await api<{ users: ManagedUser[] }>("/api/users");
    setUsers(data.users);
  }

  useEffect(() => {
    if (!open) return;
    setError("");
    void refresh().catch((err) => {
      setError(err instanceof Error ? err.message : "load failed");
    });
  }, [open]);

  if (!open) return null;

  async function create(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password, role }),
      });
      setUsername("");
      setPassword("");
      setRole("write");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setPending(false);
    }
  }

  async function patch(id: string, body: object) {
    setError("");
    try {
      await api(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    }
  }

  async function savePassword(id: string) {
    if (!newPw) return;
    await patch(id, { password: newPw });
    setPwFor(null);
    setNewPw("");
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Remove user ${name}?`)) return;
    setError("");
    try {
      await api(`/api/users/${id}`, { method: "DELETE" });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "remove failed");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal users-modal"
        role="dialog"
        aria-labelledby="users-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="users-title">Users</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            close
          </button>
        </header>
        <p className="modal-copy">
          Admin only. Roles: admin (users + write), write (own sessions),
          read (shared sessions, no prompt).
        </p>
        <ul className="users-list">
          {users.length === 0 ? (
            <li className="muted">No users.</li>
          ) : (
            users.map((u) => (
              <li key={u.id}>
                <span>
                  {u.username}
                  {u.disabled ? <span className="muted"> · off</span> : null}
                </span>
                <select
                  className="input"
                  value={u.role}
                  aria-label={`Role for ${u.username}`}
                  onChange={(e) =>
                    void patch(u.id, { role: e.target.value as UserRole })
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                {pwFor === u.id ? (
                  <form
                    className="users-pw"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void savePassword(u.id);
                    }}
                  >
                    <input
                      className="input"
                      type="password"
                      placeholder="new password"
                      value={newPw}
                      autoFocus
                      onChange={(e) => setNewPw(e.target.value)}
                    />
                    <button className="btn btn-accent" type="submit">
                      set
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={() => {
                        setPwFor(null);
                        setNewPw("");
                      }}
                    >
                      cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setPwFor(u.id);
                      setNewPw("");
                    }}
                  >
                    pw
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void patch(u.id, { disabled: !u.disabled })}
                >
                  {u.disabled ? "enable" : "off"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost danger"
                  onClick={() => void remove(u.id, u.username)}
                >
                  rm
                </button>
              </li>
            ))
          )}
        </ul>
        <form className="users-form" onSubmit={(e) => void create(e)}>
          <input
            className="input"
            placeholder="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            className="input"
            type="password"
            placeholder="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <select
            className="input"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button className="btn btn-accent" type="submit" disabled={pending}>
            add
          </button>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </div>
    </div>
  );
}
