import { cn } from "@/lib/utils";

/**
 * The Ciclo mark: a C that turns into a renewal arrow around the money sign.
 * `animated` keeps the arrow going around and the coin settling each turn.
 */
export function CycleMark({ className = "size-5", animated = false }: { className?: string; animated?: boolean }) {
  return (
    <svg className={cn(className, animated && "logo-live")} viewBox="0 0 64 64" aria-hidden="true">
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
