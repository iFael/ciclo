import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { loginErrorFromQuery } from "@/lib/login-feedback";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string | string[] }> }) {
  const params = await searchParams;
  const code = Array.isArray(params.erro) ? params.erro[0] : params.erro;
  return (
    <main className="sheet login-sheet">
      <header className="top login-top">
        <Brand />
      </header>
      <div className="sheet-body login-body">
        <LoginForm initialError={loginErrorFromQuery(code)} />
      </div>
    </main>
  );
}
