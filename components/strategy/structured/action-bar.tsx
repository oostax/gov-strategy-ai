"use client";

import { useState } from "react";
import {
  Check,
  Copy,
  FileText,
  Presentation,
  Share2,
  FileDown,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ActionBar({ sessionId }: { sessionId: string }) {
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [busy, setBusy] = useState(false);

  async function exportAs(format: "docx" | "pptx" | "pdf") {
    setBusy(true);
    try {
      const response = await fetch(`/api/export?sessionId=${sessionId}&format=${format}`);
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Экспорт не выполнен");
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `material.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Экспорт не выполнен");
    } finally {
      setBusy(false);
    }
  }

  async function toggleShare() {
    if (shareToken) {
      setShowShare((v) => !v);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enable: true }),
      });
      const data = (await response.json()) as { session?: { shareToken?: string } };
      const token = data.session?.shareToken;
      if (token) {
        setShareToken(token);
        setShowShare(true);
        toast.success("Ссылка создана");
      }
    } catch {
      toast.error("Не удалось создать ссылку");
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!shareToken) return;
    const url = `${window.location.origin}/share/${shareToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Скопировано");
    });
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="flex flex-wrap items-center gap-2 p-3">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => exportAs("docx")}>
          <FileText className="size-3.5" /> Word
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => exportAs("pptx")}>
          <Presentation className="size-3.5" /> Презентация
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => exportAs("pdf")}>
          <FileDown className="size-3.5" /> PDF
        </Button>
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleShare}
            disabled={busy}
          >
            <Share2 className="size-3.5" /> Поделиться
          </Button>
          {showShare && shareToken && (
            <div className="absolute left-0 top-9 z-30 w-72 rounded-xl border bg-popover p-3 shadow-lg">
              <p className="mb-2 text-xs text-muted-foreground">
                Любой с ссылкой увидит результат (read-only)
              </p>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${typeof window !== "undefined" ? window.location.origin : ""}/share/${shareToken}`}
                  className="text-xs"
                />
                <Button variant="outline" size="icon-sm" onClick={copyLink}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </Button>
              </div>
              <button
                type="button"
                className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowShare(false)}
              >
                Закрыть
              </button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
