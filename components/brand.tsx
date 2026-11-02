import { cn } from "@/lib/utils";

export function CycleMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 6.5a9.5 9.5 0 1 1-6.8 2.8" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      <path d="M7.6 6.8l.4 4.6 4.4-1.6" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex min-h-11 items-center gap-2.5", className)}>
      <span className="grid size-8 place-items-center rounded-[10px] bg-brand text-brand-foreground">
        <CycleMark className="size-[18px]" />
      </span>
      <span className="text-lg font-semibold tracking-[-0.03em]">Ciclo</span>
    </span>
  );
}
