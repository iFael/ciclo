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
      <main className="sheet" data-testid="screen">
        <header className="top">
          <h1>Meus planos</h1>
        </header>
        <div className="sheet-body">
          <p className="status status-error" data-testid="load-error">Configuração incompleta no servidor.</p>
        </div>
      </main>
    );
  }
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <PlansScreen initialAba={aba} />;
}
