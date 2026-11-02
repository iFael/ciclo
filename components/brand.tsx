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
      <text
        className="logo-coin"
        x="32"
        y="39.5"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight="800"
        fontSize="19"
        fill="currentColor"
      >
        $
      </text>
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex min-h-11 items-center gap-2.5", className)}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-brand text-brand-foreground">
        <CycleMark className="size-[22px]" animated />
      </span>
      <span className="text-lg font-semibold tracking-[-0.03em]">Ciclo</span>
    </span>
  );
}

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
        <span className="text-sm font-medium tracking-wide text-muted-foreground">Carregando suas assinaturas…</span>
      </div>
    </div>
  );
}
