import Link from "next/link";
import { BookOpen, Building2, History, Home, MapPin, Settings, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Штаб", icon: Home },
  { href: "/sessions", label: "Сессии", icon: History },
  { href: "/regions", label: "Регионы", icon: MapPin },
  { href: "/sber-projects", label: "Проекты Сбера", icon: Building2 },
  { href: "/playbooks", label: "Правила", icon: BookOpen },
  { href: "/settings", label: "Настройки", icon: Settings },
];

export function Sidebar({ className }: { className?: string }) {
  return (
    <aside className={cn("hidden w-72 shrink-0 border-r bg-background/80 p-5 lg:block", className)}>
      <Link href="/" className="mb-8 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Sparkles className="size-5" />
        </span>
        <span>
          <span className="block text-sm font-semibold">ИИ-штаб</span>
          <span className="text-xs text-muted-foreground">Стратегический контур</span>
        </span>
      </Link>
      <nav className="grid gap-2">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 rounded-2xl px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <item.icon className="size-4" />
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
