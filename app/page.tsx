import { redirect } from "next/navigation";
import { PlansScreen } from "@/components/plans-screen";
import { e2eBypass, publicSupabase } from "@/lib/env";
import { getSessionUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (e2eBypass()) return <PlansScreen />;
  if (!publicSupabase()) {
    return (
      <main className="page" data-testid="screen">
        <h1>Meus planos</h1>
        <p data-testid="load-error">Configuração incompleta no servidor.</p>
      </main>
    );
  }
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return <PlansScreen />;
}
