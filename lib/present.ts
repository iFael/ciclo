import { ensureLogos, type LogoCache, type LogoFetch } from "@/lib/logos/resolve";
import { buildScreen } from "@/lib/screen";
import type { AppState, ScreenModel } from "@/lib/types";

/** Resolve every suggestion and confirmed plan, then build the screen. */
export async function prepareScreen(state: AppState, now: Date, cache: LogoCache, fetchImpl?: LogoFetch): Promise<ScreenModel> {
  const logos = await ensureLogos(state, now, cache, fetchImpl);
  return buildScreen(state, now, logos);
}
