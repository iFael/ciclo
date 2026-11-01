import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="page">
      <h1>Entrar no Ciclo</h1>
      <p>Suas assinaturas, encontradas automaticamente no seu cartão.</p>
      <LoginForm />
    </main>
  );
}
