export type PlansTab = "assinaturas" | "sugestoes";

export type BannerPlacement = "connection" | "plan" | "suggestions";

export function isPlansTab(value: string | null | undefined): value is PlansTab {
  return value === "assinaturas" || value === "sugestoes";
}

/** Explicit `aba` wins. Otherwise Assinaturas when there is a confirmed plan. */
export function resolvePlansTab(query: string | null | undefined, confirmedCount: number): PlansTab {
  if (isPlansTab(query)) return query;
  return confirmedCount > 0 ? "assinaturas" : "sugestoes";
}

export function tabLabelParts(tab: PlansTab, count: number): { name: string; count: string } {
  return {
    name: tab === "assinaturas" ? "Assinaturas" : "Sugestões",
    count: `(${count})`,
  };
}

export function tabLabel(tab: PlansTab, count: number): string {
  const parts = tabLabelParts(tab, count);
  return `${parts.name} ${parts.count}`;
}

/** Plan banners stay on Assinaturas. The suggestions banner is the other tab. */
export function bannerPlacement(id: string): BannerPlacement {
  if (id === "suggestions") return "suggestions";
  if (id.startsWith("cancel:") || id.startsWith("still:")) return "plan";
  return "connection";
}
