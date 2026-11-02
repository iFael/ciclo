import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { loginErrorFromQuery } from "@/lib/login-feedback";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ erro?: string | string[] }> }) {
  const params = await searchParams;
  const code = Array.isArray(params.erro) ? params.erro[0] : params.erro;
  return (
    <div className="flex min-h-dvh items-stretch justify-center bg-background sm:items-center sm:p-6">
      <main className="login-sheet flex w-full flex-col bg-background px-5 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] sm:max-w-[440px] sm:rounded-3xl sm:border sm:bg-card sm:p-8 sm:shadow-2xl">
        <header>
          <Brand />
        </header>
        <div className="mt-10 sm:mt-8">
          <LoginForm initialError={loginErrorFromQuery(code)} />
        </div>
      </main>
    </div>
  );
}
