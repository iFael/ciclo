"use client";

import { useEffect, useRef, useState } from "react";
import { LOGIN_COPY, readMagicLinkResponse, readVerifyResponse } from "@/lib/login-feedback";

export function LoginForm({ initialError = "" }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState(initialError);
  const [tone, setTone] = useState<"error" | "ok">(initialError ? "error" : "ok");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<"link" | "code" | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sent) codeRef.current?.focus();
  }, [sent]);

  function showError(text: string) {
    setTone("error");
    setMessage(text);
  }

  if (sent) {
    return (
      <form
        className="login"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!/^\d{6}$/.test(code)) {
            showError(LOGIN_COPY.needCode);
            return;
          }
          setPending("code");
          setMessage("");
          try {
            const response = await fetch("/api/auth/verify-code", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              cache: "no-store",
              body: JSON.stringify({ email, token: code }),
            });
            const result = await readVerifyResponse(response);
            if (result.ok) {
              window.location.replace("/");
              return;
            }
            showError(result.message);
          } catch {
            showError(LOGIN_COPY.offline);
          } finally {
            setPending(null);
          }
        }}
      >
        <h1 data-testid="login-sent">{LOGIN_COPY.checkEmail}</h1>
        <p className="tagline">
          {message ? (
            LOGIN_COPY.sent
          ) : (
            <span data-testid="login-status">{LOGIN_COPY.sent}</span>
          )}{" "}
          O link abre no navegador. Se o Ciclo está na Tela de Início, digite o código de 6 dígitos do e-mail.
        </p>
        <label className="field" htmlFor="login-code">
          Código
          <input
            id="login-code"
            ref={codeRef}
            data-testid="login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            pattern="\d{6}"
            maxLength={6}
            enterKeyHint="done"
            value={code}
            aria-invalid={tone === "error" && message ? true : undefined}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              if (tone === "error") setMessage("");
            }}
          />
        </label>
        <button className="block" data-testid="login-code-submit" type="submit" disabled={pending !== null || code.length !== 6} aria-busy={pending === "code"}>
          {pending === "code" ? "Confirmando…" : "Confirmar código"}
        </button>
        {message && (
          <p className={tone === "error" ? "status status-error" : "status"} role={tone === "error" ? "alert" : "status"} data-testid="login-status">
            {message}
          </p>
        )}
        <button
          className="quiet block"
          type="button"
          onClick={() => {
            setSent(false);
            setCode("");
            setMessage("");
            setPending(null);
          }}
        >
          Usar outro e-mail
        </button>
      </form>
    );
  }

  return (
    <>
      <h1>Entrar no Ciclo</h1>
      <p className="tagline">Suas assinaturas, encontradas automaticamente no seu cartão.</p>
      <form
      className="login"
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        setPending("link");
        setMessage("");
        try {
          const response = await fetch("/api/auth/magic-link", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            cache: "no-store",
            body: JSON.stringify({ email }),
          });
          const result = await readMagicLinkResponse(response);
          if (result.ok) {
            setSent(true);
            setTone("ok");
            setMessage("");
            return;
          }
          showError(result.message);
        } catch {
          showError(LOGIN_COPY.offline);
        } finally {
          setPending(null);
        }
      }}
    >
      <label className="field" htmlFor="login-email">
        E-mail
        <input
          id="login-email"
          data-testid="login-email"
          type="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="email"
          value={email}
          aria-invalid={tone === "error" && message ? true : undefined}
          onChange={(event) => {
            setEmail(event.target.value);
            if (tone === "error") setMessage("");
          }}
          required
        />
      </label>
      <button className="block" data-testid="login-submit" type="submit" disabled={pending !== null} aria-busy={pending === "link"}>
        {pending === "link" ? "Enviando…" : "Receber link"}
      </button>
      {message && (
        <p className="status status-error" role="alert" data-testid="login-status">
          {message}
        </p>
      )}
    </form>
    </>
  );
}
