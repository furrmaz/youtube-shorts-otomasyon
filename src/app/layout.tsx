import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Shorts Otomasyon" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>
        <header>
          <Link href="/" className="brand">
            Shorts<span>Otomasyon</span>
          </Link>
          <nav>
            <Link href="/">Panel</Link>
            <Link href="/calendar">İçerik takvimi</Link>
            <Link href="/settings">Ayarlar</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
