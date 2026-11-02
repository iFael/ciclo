"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMAIL_CODE_PATTERN, LOGIN_COPY, readMagicLinkResponse, readVerifyResponse } from "@/lib/login-feedback";

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
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!EMAIL_CODE_PATTERN.test(code)) {
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
        <h1 data-testid="login-sent" className="text-2xl font-bold tracking-[-0.03em]">{LOGIN_COPY.checkEmail}</h1>
        <p className="-mt-1 text-[15px] text-muted-foreground">
          {message ? (
            LOGIN_COPY.sent
          ) : (
            <span data-testid="login-status">{LOGIN_COPY.sent}</span>
          )}{" "}
          O link abre no navegador. Se o Ciclo está na Tela de Início, digite o código do e-mail.
        </p>
        <label className="grid gap-2 text-sm font-medium" htmlFor="login-code">
          Código
          <Input
            id="login-code"
            className="h-14 text-center text-2xl font-semibold tracking-[0.3em]"
            ref={codeRef}
            data-testid="login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            pattern="\d{6,10}"
            maxLength={10}
            enterKeyHint="done"
            value={code}
            aria-invalid={tone === "error" && message ? true : undefined}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 10));
              if (tone === "error") setMessage("");
            }}
          />
        </label>
        <Button size="lg" className="w-full" data-testid="login-code-submit" type="submit" disabled={pending !== null || !EMAIL_CODE_PATTERN.test(code)} aria-busy={pending === "code"}>
          {pending === "code" ? "Confirmando…" : "Confirmar código"}
        </Button>
        {message && (
          <p className={tone === "error" ? "rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive" : "text-sm text-muted-foreground"} role={tone === "error" ? "alert" : "status"} data-testid="login-status">
            {message}
          </p>
        )}
        <Button
          variant="ghost"
          className="w-full"
          type="button"
          onClick={() => {
            setSent(false);
            setCode("");
            setMessage("");
            setPending(null);
          }}
        >
          Usar outro e-mail
        </Button>
      </form>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-bold tracking-[-0.03em]">Entrar no Ciclo</h1>
      <p className="mb-6 mt-2 text-[15px] text-muted-foreground">Suas assinaturas, encontradas automaticamente no seu cartão.</p>
      <form
      className="grid gap-4"
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
      <label className="grid gap-2 text-sm font-medium" htmlFor="login-email">
        E-mail
        <Input
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
      <Button size="lg" className="w-full" data-testid="login-submit" type="submit" disabled={pending !== null} aria-busy={pending === "link"}>
        {pending === "link" ? "Enviando…" : "Receber link"}
      </Button>
      {message && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-sm font-medium text-destructive" role="alert" data-testid="login-status">
          {message}
        </p>
      )}
    </form>
    </>
  );
}
