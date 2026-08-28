"use client";

import { FormEvent, useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

export function LoginForm() {
  const [username, setUsername] = useState("scott");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setPending(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(data?.error ?? "login failed");
        setPending(false);
        return;
      }
      window.location.assign("/app");
    } catch {
      setError("network error");
      setPending(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <ThemeToggle />
        </div>
        <h1>buildinator</h1>
        <p>Manage Grok Build sessions from the browser.</p>
        <label className="field">
          <span>Username</span>
          <input
            className="input"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <p className="error" role="alert">
          {error}
        </p>
        <button className="btn btn-accent" type="submit" disabled={pending}>
          {pending ? "signing in" : "sign in"}
        </button>
        <p className="login-hint">
          demo: scott / buildinator · guest / guest
        </p>
      </form>
    </div>
  );
}
