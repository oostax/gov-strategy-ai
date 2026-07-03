"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  Home,
  Link as LinkIcon,
  List,
  Pencil,
  Presentation,
  Share2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { SessionProfile } from "@/lib/schemas/session";
import { getSessionTitle } from "@/lib/schemas/session";

export function SessionToolbar({
  session,
  onRenamed,
}: {
  session: SessionProfile;
  onRenamed: (session: SessionProfile) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(getSessionTitle(session));
  const [busy, setBusy] = useState(false);
  const [shareToken, setShareToken] = useState(session.shareToken ?? "");
  const [showShare, setShowShare] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);

  async function rename() {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focusTopic: nextTitle }),
      });
      const data = (await response.json()) as { session?: SessionProfile; error?: string };
      if (!response.ok || !data.session) throw new Error(data.error || "Не удалось переименовать сессию");
      onRenamed(data.session);
      setEditing(false);
      toast.success("Сессия переименована");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось переименовать сессию");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm("Удалить сессию и все ее ответы?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "Не удалось удалить сессию");
      toast.success("Сессия удалена");
      router.push("/sessions");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить сессию");
      setBusy(false);
    }
  }

  async function toggleShare(enable: boolean) {
    setBusy(true);
    try {
      const response = await fetch(`/api/sessions/${session.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable }),
      });
      const data = (await response.json()) as {
        session?: SessionProfile;
        error?: string;
      };
      if (!response.ok || !data.session) throw new Error(data.error || "Не удалось");
      setShareToken(data.session.shareToken ?? "");
      onRenamed(data.session);
      toast.success(enable ? "Ссылка создана" : "Доступ отключён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось изменить доступ");
    } finally {
      setBusy(false);
    }
  }

  function copyShareLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/share/${shareToken}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        toast.success("Ссылка скопирована");
      })
      .catch(() => toast.error("Не удалось скопировать"));
  }

  function exportAs(format: "docx" | "pptx") {
    const url = `/api/export?sessionId=${session.id}&format=${format}`;
    window.open(url, "_blank");
    setShowExport(false);
  }

  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {editing ? (
          <div className="flex min-w-0 flex-1 flex-wrap gap-2">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
            <Button disabled={busy} onClick={rename}>
              Сохранить
            </Button>
            <Button disabled={busy} variant="ghost" onClick={() => setEditing(false)}>
              Отмена
            </Button>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug tracking-tight sm:truncate">
              {getSessionTitle(session)}
            </h2>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarDays className="size-3" />
              {new Date(session.updatedAt).toLocaleDateString("ru-RU")}
            </p>
          </div>
        )}

        <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
          <IconLink href="/" label="На главную" icon={Home} />
          <IconLink href="/sessions" label="Список сессий" icon={List} />

          {/* Экспорт */}
          <div className="relative">
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              onClick={() => setShowExport((prev) => !prev)}
              aria-label="Экспорт"
              title="Экспорт"
              className="size-9 rounded-xl"
            >
              <Download className="size-4" />
            </Button>
            {showExport && (
              <div className="absolute right-0 top-10 z-30 w-48 rounded-xl border bg-popover p-1 shadow-lg">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted"
                  onClick={() => exportAs("docx")}
                >
                  <FileText className="size-4" /> Word (.docx)
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm hover:bg-muted"
                  onClick={() => exportAs("pptx")}
                >
                  <Presentation className="size-4" /> Презентация (.pptx)
                </button>
              </div>
            )}
          </div>

          {/* Share */}
          <div className="relative">
            <Button
              size="icon"
              variant="ghost"
              disabled={busy}
              onClick={() => setShowShare((prev) => !prev)}
              aria-label={shareToken ? "Ссылка активна" : "Поделиться"}
              title={shareToken ? "Ссылка активна" : "Поделиться"}
              className="size-9 rounded-xl"
            >
              <Share2 className="size-4" />
            </Button>
            {showShare && (
              <div className="absolute right-0 top-10 z-30 w-80 rounded-xl border bg-popover p-3 shadow-lg">
                <p className="text-sm font-semibold">Поделиться сессией</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Любой с ссылкой увидит результат в режиме только для чтения.
                </p>
                {shareToken ? (
                  <>
                    <div className="mt-3 flex gap-2">
                      <Input
                        readOnly
                        value={`${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareToken}`}
                      />
                      <Button variant="outline" size="default" onClick={copyShareLink}>
                        {copied ? (
                          <Check className="size-4 text-emerald-600" />
                        ) : (
                          <Copy className="size-4" />
                        )}
                      </Button>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <LinkIcon className="size-3" /> публичная read-only ссылка
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleShare(false)}
                        disabled={busy}
                      >
                        Отключить доступ
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button className="mt-3 w-full" onClick={() => toggleShare(true)} disabled={busy}>
                    <Share2 className="size-4" /> Создать ссылку
                  </Button>
                )}
              </div>
            )}
          </div>

          <IconButton
            label="Переименовать"
            icon={Pencil}
            disabled={busy}
            onClick={() => setEditing(true)}
          />
          <IconButton
            label="Удалить"
            icon={Trash2}
            disabled={busy}
            destructive
            onClick={remove}
          />
        </div>
      </div>
    </div>
  );
}

function IconLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-label={label}
            className="inline-flex size-9 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
          >
            <Icon className="size-4" />
          </Link>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function IconButton({
  label,
  icon: Icon,
  disabled,
  destructive = false,
  onClick,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon"
            variant={destructive ? "destructive" : "ghost"}
            disabled={disabled}
            onClick={onClick}
            aria-label={label}
            className="size-9 rounded-xl"
          >
            <Icon className="size-4" />
          </Button>
        }
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
