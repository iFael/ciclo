import { redirect } from "next/navigation";
import { PlansScreen } from "@/components/plans-screen";
import { e2eBypass, publicSupabase } from "@/lib/env";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function firstQuery(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string | string[] }>;
}) {
  const aba = firstQuery((await searchParams).aba);
  if (e2eBypass()) return <PlansScreen initialAba={aba} />;
  if (!publicSupabase()) {
    return (
      <main className="mx-auto min-h-dvh max-w-6xl px-4 py-8 sm:px-6 lg:px-8" data-testid="screen">
        <h1 className="text-3xl font-bold tracking-[-0.035em]">Meus planos</h1>
        <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive" data-testid="load-error">
          Configuração incompleta no servidor.
        </p>
      </main>
    );
  }
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <PlansScreen initialAba={aba} />;
}
