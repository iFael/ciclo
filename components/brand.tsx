export function CycleMark({ className = "mark" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M16 6.5a9.5 9.5 0 1 1-6.8 2.8" fill="none" stroke="#e7dcc8" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M7.6 6.8l.4 4.6 4.4-1.6" fill="none" stroke="#e7dcc8" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Brand() {
  return (
    <span className="brand">
      <CycleMark />
      <span className="wordmark">Ciclo</span>
    </span>
  );
}
