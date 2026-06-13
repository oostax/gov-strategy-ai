"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SberGovProject } from "@/lib/storage/sber-projects";

type FormState = {
  name: string;
  summary: string;
  sberProducts: string;
  scope: string;
  status: string;
  domains: string;
  sourceUrl: string;
  sourceTitle: string;
  caveat: string;
};

const emptyForm: FormState = {
  name: "",
  summary: "",
  sberProducts: "",
  scope: "",
  status: "",
  domains: "",
  sourceUrl: "",
  sourceTitle: "",
  caveat: "",
};

function toForm(p: SberGovProject): FormState {
  return {
    name: p.name,
    summary: p.summary,
    sberProducts: p.sberProducts.join(", "),
    scope: p.scope,
    status: p.status,
    domains: p.domains.join(", "),
    sourceUrl: p.sourceUrl,
    sourceTitle: p.sourceTitle,
    caveat: p.caveat ?? "",
  };
}

function toPayload(form: FormState) {
  const list = (value: string) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  return {
    name: form.name.trim(),
    summary: form.summary.trim(),
    sberProducts: list(form.sberProducts),
    scope: form.scope.trim(),
    status: form.status.trim(),
    domains: list(form.domains),
    sourceUrl: form.sourceUrl.trim(),
    sourceTitle: form.sourceTitle.trim(),
    caveat: form.caveat.trim() || undefined,
  };
}

export function SberCatalogManager() {
  const [projects, setProjects] = useState<SberGovProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // id | "new" | null
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/sber-projects")
      .then((r) => r.json())
      .then((data: { projects?: SberGovProject[] }) => setProjects(data.projects ?? []))
      .finally(() => setLoading(false));
  }, []);

  function startAdd() {
    setForm(emptyForm);
    setEditingId("new");
  }
  function startEdit(p: SberGovProject) {
    setForm(toForm(p));
    setEditingId(p.id);
  }
  function cancel() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function save() {
    if (form.name.trim().length < 2) {
      toast.error("Укажите название проекта");
      return;
    }
    setSaving(true);
    try {
      const isNew = editingId === "new";
      const response = await fetch(
        isNew ? "/api/sber-projects" : `/api/sber-projects/${editingId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toPayload(form)),
        },
      );
      const data = (await response.json()) as { project?: SberGovProject; error?: string };
      if (!response.ok || !data.project) throw new Error(data.error || "Не удалось сохранить");
      setProjects((prev) =>
        isNew
          ? [data.project!, ...prev]
          : prev.map((p) => (p.id === data.project!.id ? data.project! : p)),
      );
      toast.success(isNew ? "Проект добавлен в каталог" : "Проект обновлён");
      cancel();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: SberGovProject) {
    if (!confirm(`Удалить «${p.name}» из каталога?`)) return;
    try {
      const response = await fetch(`/api/sber-projects/${p.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось удалить");
      setProjects((prev) => prev.filter((item) => item.id !== p.id));
      toast.success("Проект удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{projects.length} проект(ов) в каталоге</p>
        {editingId !== "new" && (
          <Button size="sm" onClick={startAdd}>
            <Plus className="size-3.5" /> Добавить проект
          </Button>
        )}
      </div>

      {editingId === "new" && (
        <ProjectForm form={form} setForm={setForm} onSave={save} onCancel={cancel} saving={saving} title="Новый проект каталога" />
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) =>
          editingId === project.id ? (
            <div key={project.id} className="md:col-span-2 xl:col-span-3">
              <ProjectForm form={form} setForm={setForm} onSave={save} onCancel={cancel} saving={saving} title={`Редактирование: ${project.name}`} />
            </div>
          ) : (
            <Card key={project.id} className="rounded-2xl">
              <CardContent className="p-4">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold leading-tight">{project.name}</h3>
                  {project.status && (
                    <Badge variant="secondary" className="shrink-0 text-[10px]">
                      {project.status}
                    </Badge>
                  )}
                </div>
                <p className="text-xs leading-snug text-muted-foreground">{project.summary}</p>
                {project.sberProducts.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1">
                    {project.sberProducts.slice(0, 4).map((prod) => (
                      <span key={prod} className="rounded-md border bg-muted/40 px-1.5 py-0.5 text-[10px] font-medium">
                        {prod}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {project.scope && <span>{project.scope}</span>}
                  {project.sourceUrl && (
                    <a href={project.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      <ExternalLink className="size-3 shrink-0" /> источник
                    </a>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-1.5 border-t pt-2">
                  <Button variant="outline" size="sm" onClick={() => startEdit(project)}>
                    <Pencil className="size-3.5" /> Изменить
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(project)}>
                    <Trash2 className="size-3.5" /> Удалить
                  </Button>
                </div>
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}

function ProjectForm({
  form,
  setForm,
  onSave,
  onCancel,
  saving,
  title,
}: {
  form: FormState;
  setForm: (form: FormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  title: string;
}) {
  const field = (key: keyof FormState, value: string) => setForm({ ...form, [key]: value });
  return (
    <Card className="rounded-2xl border-primary/30 bg-primary/[0.03]">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button type="button" onClick={onCancel} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Labeled label="Название*">
            <Input value={form.name} onChange={(e) => field("name", e.target.value)} placeholder="ГосТех — единая платформа" />
          </Labeled>
          <Labeled label="Статус">
            <Input value={form.status} onChange={(e) => field("status", e.target.value)} placeholder="пилот / в работе / масштабирование" />
          </Labeled>
        </div>
        <Labeled label="Описание (1–2 предложения)">
          <Textarea rows={2} value={form.summary} onChange={(e) => field("summary", e.target.value)} />
        </Labeled>
        <div className="grid gap-2 sm:grid-cols-2">
          <Labeled label="Продукты Сбера (через запятую)">
            <Input value={form.sberProducts} onChange={(e) => field("sberProducts", e.target.value)} placeholder="GigaChat, Platform V" />
          </Labeled>
          <Labeled label="Тематические теги (через запятую)">
            <Input value={form.domains} onChange={(e) => field("domains", e.target.value)} placeholder="данные, госуслуги, жкх" />
          </Labeled>
          <Labeled label="Охват">
            <Input value={form.scope} onChange={(e) => field("scope", e.target.value)} placeholder="федеральный / региональный" />
          </Labeled>
          <Labeled label="Заголовок источника">
            <Input value={form.sourceTitle} onChange={(e) => field("sourceTitle", e.target.value)} placeholder="ТАСS — ..." />
          </Labeled>
        </div>
        <Labeled label="Ссылка-источник">
          <Input value={form.sourceUrl} onChange={(e) => field("sourceUrl", e.target.value)} placeholder="https://..." />
        </Labeled>
        <Labeled label="Оговорка (что не подтверждено) — опционально">
          <Textarea rows={2} value={form.caveat} onChange={(e) => field("caveat", e.target.value)} />
        </Labeled>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Отмена
          </Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : null} Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
