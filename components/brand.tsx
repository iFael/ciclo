"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/** Recontei: a recurring charge is revealed as a receipt inside the letter R. */
export function CycleMark({ className = "size-5", animated = false }: { className?: string; animated?: boolean | "loading" }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg className={cn(className, animated === "loading" && "recontei-logo-loading")}
      viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={id + "-gold"} x1="10" y1="6" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#fff1d3" /><stop offset=".56" stopColor="#ebbb79" /><stop offset="1" stopColor="#a96c36" />
        </linearGradient>
      </defs>
      <path d="M12 34C12 19.2 23.8 9 37.8 9C44.2 9 49.5 10.6 53.1 15.2"
        stroke={"url(#" + id + "-gold)"} strokeWidth="7" strokeLinecap="round" />
      <path d="M48 5.5L58.5 17.5L45 20Z" fill={"url(#" + id + "-gold)"} />
      <path d="M19 20H37.5C46.8 20 52 25.1 52 32.5C52 39 48.6 42.3 43.3 44.6L55 58H43.7L32.4 45H29V58H19V20Z"
        fill={"url(#" + id + "-gold)"} />
      <path d="M23 25H38.5C42 25 44 27.3 44 31V42H39.5L36.5 45L33.5 42L30.5 45L27.5 42L24 45V25Z"
        fill="#fff4df" />
      <g stroke="#37281d" strokeWidth="2.4" strokeLinecap="round">
        <path d="M28 30H38" /><path d="M28 35H38" /><path d="M28 40H34" />
      </g>
    </svg>
  );
}

export function Brand({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex min-h-11 items-center gap-2.5", className)}>
      <span className="brand-tile grid size-11 shrink-0 place-items-center rounded-[14px]" aria-hidden="true">
        <CycleMark className="size-9" />
      </span>
      {compact ? <span className="sr-only">Recontei</span> : (
        <span className="brand-wordmark text-[27px] font-extrabold leading-none tracking-[-0.05em]">Recontei</span>
      )}
    </span>
  );
}

const LOADING_LINES = [
  "Acompanhando suas assinaturas…",
  "Organizando as cobranças recorrentes…",
  "Preparando seu resumo de gastos…",
];

export function LoadingScreen() {
  return (
    <div data-testid="loading" role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-background">
      <div className="grid place-items-center gap-6">
        <span className="brand-tile grid size-24 place-items-center rounded-[27px]">
          <CycleMark className="size-16" animated="loading" />
        </span>
        <span className="text-sm font-medium text-muted-foreground">{LOADING_LINES[0]}</span>
      </div>
    </div>
  );
}
