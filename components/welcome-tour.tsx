"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, X } from "lucide-react";
import { CycleMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { haptic } from "@/components/vivid";
import { cn } from "@/lib/utils";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  /** CSS selector of the real element to light up. No target: the card sits in the middle. */
  target?: string;
  /** Something to draw inside the card, such as a sample plan when the list is empty. */
  visual?: ReactNode;
  /** Runs before the step shows, for example to open the tab that holds the target. */
  prepare?: () => void;
};

type Rect = { top: number; left: number; width: number; height: number };

const PAD = 8;
const GAP = 14;
const EDGE = 16;
const CARD_WIDTH = 360;

function measure(selector: string | undefined): Rect | null {
  if (!selector) return null;
  const node = document.querySelector(selector);
  if (!node) return null;
  const box = node.getBoundingClientRect();
  if (box.width === 0 && box.height === 0) return null;
  return { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
}

/** Puts the card under the lit element when it fits, over it otherwise, always inside the screen. */
function placeCard(hole: Rect | null, cardHeight: number): { top: number; left: number; width: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(CARD_WIDTH, vw - EDGE * 2);
  if (!hole) return { top: Math.max(EDGE, (vh - cardHeight) / 2), left: (vw - width) / 2, width };
  const left = Math.min(Math.max(EDGE, hole.left + hole.width / 2 - width / 2), vw - width - EDGE);
  const below = hole.top + hole.height + GAP;
  const above = hole.top - GAP - cardHeight;
  let top: number;
  if (below + cardHeight <= vh - EDGE) top = below;
  else if (above >= EDGE) top = above;
  else top = vh - cardHeight - EDGE;
  return { top: Math.max(EDGE, top), left, width };
}

export function WelcomeTour({ steps, onClose }: { steps: TourStep[]; onClose: (finished: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const [hole, setHole] = useState<Rect | null>(null);
  const [cardHeight, setCardHeight] = useState(240);
  const [, setViewport] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  // The screen rebuilds its steps on every render: the effects below follow the step id, not the object.
  const stepRef = useRef(step);
  useLayoutEffect(() => {
    stepRef.current = step;
  });
  const stepId = step?.id;

  const relocate = useCallback(() => {
    setHole(measure(stepRef.current?.target));
    setViewport((value) => value + 1);
  }, []);

  // A step opens its tab first, then scrolls its element into view and lights it up.
  useEffect(() => {
    const current = stepRef.current;
    if (!current) return;
    current.prepare?.();
    let frame = 0;
    const timer = window.setTimeout(() => {
      const node = current.target ? document.querySelector(current.target) : null;
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      relocate();
      // Smooth scrolling moves the element after the first measure.
      const until = Date.now() + 700;
      const follow = () => {
        relocate();
        if (Date.now() < until) frame = window.requestAnimationFrame(follow);
      };
      frame = window.requestAnimationFrame(follow);
    }, 60);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
    };
  }, [stepId, relocate]);

  useEffect(() => {
    window.addEventListener("resize", relocate);
    window.addEventListener("scroll", relocate, true);
    return () => {
      window.removeEventListener("resize", relocate);
      window.removeEventListener("scroll", relocate, true);
    };
  }, [relocate]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [index, hole]);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  const go = useCallback(
    (next: number) => {
      haptic(6);
      if (next >= steps.length) onClose(true);
      else setIndex(Math.max(0, next));
    },
    [steps.length, onClose],
  );

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(false);
      } else if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, onClose]);

  if (!step) return null;
  const place = typeof window === "undefined" ? { top: 0, left: 0, width: CARD_WIDTH } : placeCard(hole, cardHeight);

  return (
    <div data-testid="tour" className="fixed inset-0 z-[70]">
      {/* Blocks the page while the tour is open, so a tap does not land on a button behind it. */}
      <div aria-hidden="true" className={cn("absolute inset-0", !hole && "bg-black/65 animate-in fade-in-0 duration-300")} />
      {hole && (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          className="pointer-events-none absolute rounded-[16px] ring-2 ring-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.66)] motion-safe:transition-all motion-safe:duration-300"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        data-testid="tour-card"
        data-step={step.id}
        className="absolute rounded-2xl border bg-popover p-5 text-popover-foreground shadow-2xl outline-none motion-safe:transition-[top,left] motion-safe:duration-300"
        style={{ top: place.top, left: place.left, width: place.width }}
      >
        <div className="flex items-center justify-between gap-3">
          <span data-testid="tour-count" className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {index + 1} de {steps.length}
          </span>
          <button
            type="button"
            data-testid="tour-skip"
            onClick={() => onClose(false)}
            className="-mr-1.5 inline-flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-1 text-[13px] font-medium text-muted-foreground hover:text-foreground"
          >
            Pular
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
        {!step.target && index === 0 && (
          <span aria-hidden="true" className="mt-4 grid size-12 place-items-center rounded-xl bg-brand text-brand-foreground">
            <CycleMark className="size-7" animated />
          </span>
        )}
        <h2 id="tour-title" className="mt-3 text-lg font-semibold tracking-[-0.02em]">
          {step.title}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </p>
        {step.visual && <div className="mt-4">{step.visual}</div>}
        <div className="mt-5 flex items-center gap-3">
          <div aria-hidden="true" className="flex flex-1 gap-1.5">
            {steps.map((item, dot) => (
              <span
                key={item.id}
                className={cn("h-1.5 rounded-full bg-border motion-safe:transition-all", dot === index ? "w-5 bg-primary" : "w-1.5")}
              />
            ))}
          </div>
          {index > 0 && (
            <Button variant="ghost" className="h-9" data-testid="tour-back" onClick={() => go(index - 1)}>
              Voltar
            </Button>
          )}
          <Button className="h-9 px-4" data-testid="tour-next" onClick={() => go(index + 1)}>
            {last ? "Começar" : index === 0 ? "Mostrar" : "Próximo"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A sample plan for the steps about a plan, when the list is still empty. */
export function SamplePlan() {
  return (
    <div data-testid="tour-sample" className="rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-sm font-semibold ring-2 ring-primary">
          S
          <span className="absolute -right-1 -top-1 size-3 rounded-full bg-primary motion-safe:animate-ping" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Serviço de exemplo</p>
          <p className="text-xs text-muted-foreground">Toque no ícone para editar o link</p>
        </div>
        <p className="text-sm font-semibold">R$ 29,90</p>
      </div>
      <span className="mt-3 flex h-8 items-center justify-center gap-1.5 rounded-lg bg-primary text-xs font-semibold text-primary-foreground">
        Gerenciar
        <ExternalLink className="size-3" aria-hidden="true" />
      </span>
    </div>
  );
}
