import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Núcleo | Mini chat",
  description: "Conversa privada com histórico e atualização em tempo real.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
