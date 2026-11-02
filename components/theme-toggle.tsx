"use client";

import { useId, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "ciclo-theme";
const THEME_EVENT = "ciclo-theme-change";

/** Runs before paint so a saved light choice never flashes dark first. Dark is the default. */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

function readTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(THEME_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "light") root.dataset.theme = "light";
  else delete root.dataset.theme;
  try {
    if (theme === "light") localStorage.setItem(THEME_STORAGE_KEY, "light");
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/**
 * Sun and moon in one shape. Dark shows the moon: a full disc with a bite.
 * Light shows the sun: the bite slides away, the disc shrinks and the rays turn in.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as Theme);
  const light = theme === "light";
  const maskId = `theme-mask-${useId().replace(/:/g, "")}`;
  const ease = "transform 500ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 300ms ease";
  return (
    <button
      type="button"
      data-testid="theme-toggle"
      data-theme-state={theme}
      aria-label={light ? "Tema claro ativo. Mudar para o escuro" : "Tema escuro ativo. Mudar para o claro"}
      title={light ? "Tema claro" : "Tema escuro"}
      onClick={() => applyTheme(light ? "dark" : "light")}
      className={cn(
        "inline-grid size-9 shrink-0 cursor-pointer place-items-center rounded-[10px] border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-[18px] overflow-visible" aria-hidden="true">
        <mask id={maskId}>
          <rect x="-4" y="-4" width="32" height="32" fill="white" />
          <circle
            cx="17"
            cy="7"
            r="6.5"
            fill="black"
            style={{ transition: ease, transform: light ? "translate(9px, -9px)" : "translate(0, 0)" }}
          />
        </mask>
        <circle
          cx="12"
          cy="12"
          r="8"
          fill="currentColor"
          mask={`url(#${maskId})`}
          style={{ transition: ease, transformOrigin: "12px 12px", transform: light ? "scale(0.55)" : "scale(1)" }}
        />
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transition: ease,
            transformOrigin: "12px 12px",
            opacity: light ? 1 : 0,
            transform: light ? "rotate(0deg) scale(1)" : "rotate(-90deg) scale(0.4)",
          }}
        >
          <line x1="12" y1="1.5" x2="12" y2="3.5" />
          <line x1="12" y1="20.5" x2="12" y2="22.5" />
          <line x1="1.5" y1="12" x2="3.5" y2="12" />
          <line x1="20.5" y1="12" x2="22.5" y2="12" />
          <line x1="4.6" y1="4.6" x2="6" y2="6" />
          <line x1="18" y1="18" x2="19.4" y2="19.4" />
          <line x1="4.6" y1="19.4" x2="6" y2="18" />
          <line x1="18" y1="6" x2="19.4" y2="4.6" />
        </g>
      </svg>
    </button>
  );
}
