import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Shorts Otomasyon" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
