import { redirect } from "next/navigation";
import { PlansScreen } from "@/components/plans-screen";
import { e2eBypass, publicSupabase } from "@/lib/env";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (e2eBypass()) return <PlansScreen />;
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
  return <PlansScreen />;
}
