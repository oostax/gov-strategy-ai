import Link from "next/link";
import { Settings, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export function Topbar() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur-xl lg:px-8">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span className="text-sm font-semibold">ИИ-штаб ДРГС</span>
      </div>
      <Link
        href="/settings"
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })}
        aria-label="Настройки"
      >
        <Settings className="size-4" />
      </Link>
    </header>
  );
}
