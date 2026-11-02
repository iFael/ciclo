import { cn } from "@/lib/utils";

/**
 * The Ciclo mark: a C that turns into a renewal arrow around the money sign.
 * `animated` keeps the arrow going around and the coin settling each turn.
 */
export function CycleMark({ className = "size-5", animated = false }: { className?: string; animated?: boolean | "loading" }) {
  return (
    <svg className={cn(className, animated === "loading" ? "logo-loading" : animated && "logo-live")} viewBox="0 0 64 64" aria-hidden="true">
      <g className="logo-ring">
        <path d="M47 22A18.5 18.5 0 1 0 49.5 36" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" />
        <path d="M38.5 24.5L48.5 23L49.5 13" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <g transform="translate(32 32)">
        <g className="logo-coin" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.6 -5.2C4.6 -9 -4.6 -9 -4.6 -4.3C-4.6 0 4.6 0 4.6 4.3C4.6 9 -4.6 9 -4.6 5.2" strokeWidth="4" />
          <path d="M0 -11V11" strokeWidth="3.2" />
        </g>
      </g>
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex min-h-11 items-center gap-3", className)}>
      <span className="grid size-14 place-items-center rounded-2xl bg-brand text-brand-foreground">
        <CycleMark className="size-10" animated />
      </span>
      <span className="text-2xl font-semibold tracking-[-0.03em]">Ciclo</span>
    </span>
  );
}

const LOADING_LINES = [
  "Dica: toque na logo de uma assinatura para trocá-la.",
  "Dica: pesquise no extrato para achar cobranças escondidas.",
  "Dica: use o menu ⋯ para sincronizar quando quiser.",
  "Dica: confirme as sugestões para não perder nenhuma renovação.",
];

/** Full-screen wait while the plans load: the mark turns without stopping. */
export function LoadingScreen() {
  return (
    <div data-testid="loading" role="status" aria-live="polite" className="fixed inset-0 z-50 grid place-items-center bg-background">
      <div className="grid place-items-center gap-7">
        <span className="relative grid size-28 place-items-center">
          <span aria-hidden="true" className="loading-halo absolute inset-0 rounded-[34px] bg-brand" />
          <span className="relative grid size-24 place-items-center rounded-[28px] bg-brand text-brand-foreground shadow-2xl">
            <CycleMark className="size-14" animated="loading" />
          </span>
        </span>
        <span className="loading-lines relative grid h-12 w-80 max-w-[88vw] place-items-center text-center text-[15px] font-medium text-muted-foreground">
          {LOADING_LINES.map((line, i) => (
            <span key={line} className="loading-line absolute inset-x-0" style={{ animationDelay: `${i * 3}s` }}>
              {line}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
