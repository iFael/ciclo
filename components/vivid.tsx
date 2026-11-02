"use client";

import { useEffect, useRef, type HTMLAttributes, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";

/** A short tap on phones that support it (Android). Silent elsewhere. */
export function haptic(pattern: number | number[] = 8): void {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator && !reducedMotion()) navigator.vibrate(pattern);
  } catch {
    /* some browsers throw outside a user gesture */
  }
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * Cards lean toward the pointer and catch a soft light, like a real object.
 * Mouse and pen only: on touch the press scale does the work.
 */
export function useTilt<T extends HTMLElement>(strength = 5) {
  const ref = useRef<T | null>(null);
  const frame = useRef(0);
  const onPointerMove = (event: ReactPointerEvent<T>) => {
    const node = ref.current;
    if (!node || event.pointerType === "touch" || reducedMotion()) return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      node.classList.add("tilting");
      node.style.setProperty("--ry", `${((x - 0.5) * strength).toFixed(2)}deg`);
      node.style.setProperty("--rx", `${((0.5 - y) * strength).toFixed(2)}deg`);
      node.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
      node.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
      node.style.setProperty("--go", "1");
    });
  };
  const onPointerLeave = () => {
    const node = ref.current;
    if (!node) return;
    cancelAnimationFrame(frame.current);
    node.classList.remove("tilting");
    node.style.setProperty("--rx", "0deg");
    node.style.setProperty("--ry", "0deg");
    node.style.setProperty("--go", "0");
  };
  return { ref, onPointerMove, onPointerLeave };
}

const BRL = /(-?[\d.]+,\d{2}|-?\d[\d.]*)/;

function parseBrl(text: string): number | null {
  const match = text.match(BRL);
  if (!match) return null;
  const value = Number(match[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function formatLike(sample: string, value: number): string {
  const decimals = /,\d{2}/.test(sample) ? 2 : 0;
  const number = value.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return sample.replace(BRL, number);
}

/** Money that rolls to its new value instead of jumping. */
export function RollingAmount({ text }: { text: string }) {
  const node = useRef<HTMLSpanElement | null>(null);
  const current = useRef<number | null>(null);

  useEffect(() => {
    const target = parseBrl(text);
    const span = node.current;
    if (!span || target === null || reducedMotion()) {
      current.current = target;
      return;
    }
    const from = current.current ?? target * 0.6;
    if (from === target) return;
    const start = performance.now();
    const duration = 900;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      current.current = t < 1 ? from + (target - from) * eased : target;
      span.textContent = t < 1 ? formatLike(text, current.current) : text;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      span.textContent = text;
    };
  }, [text]);

  return (
    <span ref={node} className="tabular-nums">
      {text}
    </span>
  );
}

/** A block that leans toward the pointer. */
export function Tilt({ className, strength, ...rest }: HTMLAttributes<HTMLDivElement> & { strength?: number }) {
  const { ref, onPointerMove, onPointerLeave } = useTilt<HTMLDivElement>(strength);
  return <div ref={ref} onPointerMove={onPointerMove} onPointerLeave={onPointerLeave} className={cn("tilt", className)} {...rest} />;
}
