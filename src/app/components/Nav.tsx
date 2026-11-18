"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Üst menü: bulunulan sayfa vurgulanır */
export function Nav({ links }: { links: { href: string; label: string }[] }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href.split("#")[0]));
  return (
    <nav>
      {links.map((l) => (
        <Link key={l.href} href={l.href} className={active(l.href) ? "active" : ""}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
