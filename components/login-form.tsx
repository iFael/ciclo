"use client";

import { useState } from "react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  return (
    <form
      className="login"
      onSubmit={async (event) => {
        event.preventDefault();
        const response = await fetch("/api/auth/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const body = (await response.json()) as { error?: string };
        setMessage(response.ok ? "Enviamos um link de acesso." : body.error ?? "Não foi possível enviar o link.");
      }}
    >
      <label>
        E-mail
        <input data-testid="login-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <button data-testid="login-submit" type="submit">
        Receber link
      </button>
      {message && <p role="status">{message}</p>}
    </form>
  );
}
