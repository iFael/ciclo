import type { Metadata, Viewport } from "next";
import { BackCache } from "@/components/back-cache";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ciclo",
  description: "Suas assinaturas, encontradas automaticamente no seu cartão.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <BackCache />
        {children}
      </body>
    </html>
  );
}
