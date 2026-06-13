"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Check,
  CircleCheck,
  Loader2,
  MapPin,
  Plus,
  Save,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  outcomeLabels,
  pastEngagementOutcomeOptions,
  projectStageOptions,
  relationshipLabels,
  stageColors,
  stageLabels,
  type PastEngagement,
  type RegionProfile,
  type SberProject,
  type Stakeholder,
  type StrategicPriority,
} from "@/lib/schemas/region";
import type { SberGovProject } from "@/lib/storage/sber-projects";
import { cn } from "@/lib/utils";

type Draft = RegionProfile;

const newId = () => `tmp_${Math.random().toString(36).slice(2, 10)}`;

type ContextKey =
  | "federalDistrict"
  | "population"
  | "digitalMaturity"
  | "digitalMaturityNote"
  | "budgetProfile"
  | "budgetCycle";

const CONTEXT_FIELDS: { key: ContextKey; label: string }[] = [
  { key: "federalDistrict", label: "Федеральный округ" },
  { key: "population", label: "Население" },
  { key: "digitalMaturity", label: "Цифровая зрелость" },
  { key: "digitalMaturityNote", label: "Комментарий к зрелости" },
  { key: "budgetProfile", label: "Бюджетный профиль" },
  { key: "budgetCycle", label: "Бюджетный цикл" },
];

export function RegionEditor({ initial }: { initial: RegionProfile }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const router = useRouter();

  const [autofilling, setAutofilling] = useState(false);
  const [catalog, setCatalog] = useState<SberGovProject[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  // Какие карточки активных проектов раскрыты до второстепенных полей.
  const [openProjectIds, setOpenProjectIds] = useState<Set<string>>(new Set());

  function toggleProjectDetails(id: string) {
    setOpenProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  useEffect(() => {
    fetch("/api/sber-projects")
      .then((r) => r.json())
      .then((data: { projects?: SberGovProject[] }) => setCatalog(data.projects ?? []))
      .catch(() => undefined);
  }, []);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  // Добавить проект Сбера в портфель региона из глобального каталога (с подстановкой полей).
  function addProjectFromCatalog(cp: SberGovProject) {
    patch("activeProjects", [
      ...draft.activeProjects,
      {
        id: newId(),
        product: cp.sberProducts[0] ?? cp.name,
        title: cp.name,
        stage: "discovery",
        amount: "",
        sberOwner: "",
        customerOwner: "",
        startedAt: "",
        notes: cp.summary,
      } satisfies SberProject,
    ]);
    setCatalogOpen(false);
  }

  // ── Черновик из открытых источников ──────────────────────────────────────
  async function runAutofill() {
    setAutofilling(true);
    try {
      const response = await fetch(`/api/regions/${draft.id}/autofill`, { method: "POST" });
      const data = (await response.json()) as { region?: RegionProfile; error?: string };
      if (!response.ok || !data.region) throw new Error(data.error || "Не удалось собрать черновик");
      setDraft(data.region);
      const d = data.region.draft;
      const total =
        (d?.topPriorities.length ?? 0) +
        (d?.painPoints.length ?? 0) +
        (d?.news.length ?? 0) +
        (d?.stakeholders.length ?? 0);
      toast.success(total ? `Подготовлен черновик: ${total} пунктов на проверку` : "Открытые источники не предоставили данных по региону");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка автозаполнения");
    } finally {
      setAutofilling(false);
    }
  }

  function acceptPriority(item: StrategicPriority) {
    setDraft((prev) =>
      prev.draft
        ? {
            ...prev,
            topPriorities: [...prev.topPriorities, item],
            draft: { ...prev.draft, topPriorities: prev.draft.topPriorities.filter((p) => p.id !== item.id) },
          }
        : prev,
    );
    setDirty(true);
  }
  function dismissPriority(id: string) {
    setDraft((prev) =>
      prev.draft
        ? { ...prev, draft: { ...prev.draft, topPriorities: prev.draft.topPriorities.filter((p) => p.id !== id) } }
        : prev,
    );
    setDirty(true);
  }

  function acceptPain(text: string) {
    setDraft((prev) =>
      prev.draft
        ? {
            ...prev,
            painPoints: prev.painPoints.includes(text) ? prev.painPoints : [...prev.painPoints, text],
            draft: { ...prev.draft, painPoints: prev.draft.painPoints.filter((p) => p !== text) },
          }
        : prev,
    );
    setDirty(true);
  }
  function dismissPain(text: string) {
    setDraft((prev) =>
      prev.draft
        ? { ...prev, draft: { ...prev.draft, painPoints: prev.draft.painPoints.filter((p) => p !== text) } }
        : prev,
    );
    setDirty(true);
  }

  function acceptStakeholder(item: Stakeholder) {
    setDraft((prev) =>
      prev.draft
        ? {
            ...prev,
            stakeholders: [...prev.stakeholders, item],
            draft: { ...prev.draft, stakeholders: prev.draft.stakeholders.filter((s) => s.id !== item.id) },
          }
        : prev,
    );
    setDirty(true);
  }
  function dismissStakeholder(id: string) {
    setDraft((prev) =>
      prev.draft
        ? { ...prev, draft: { ...prev.draft, stakeholders: prev.draft.stakeholders.filter((s) => s.id !== id) } }
        : prev,
    );
    setDirty(true);
  }

  function acceptNews(item: RegionProfile["news"][number]) {
    setDraft((prev) =>
      prev.draft
        ? {
            ...prev,
            news: [...prev.news, item],
            draft: { ...prev.draft, news: prev.draft.news.filter((n) => n.id !== item.id) },
          }
        : prev,
    );
    setDirty(true);
  }
  function dismissNews(id: string) {
    setDraft((prev) =>
      prev.draft
        ? { ...prev, draft: { ...prev.draft, news: prev.draft.news.filter((n) => n.id !== id) } }
        : prev,
    );
    setDirty(true);
  }

  // Контекстные скаляры черновика: принять = записать в основное поле + убрать из черновика.
  function acceptContext(key: ContextKey) {
    setDraft((prev) => {
      if (!prev.draft) return prev;
      return {
        ...prev,
        [key]: prev.draft[key],
        draft: { ...prev.draft, [key]: undefined },
      } as Draft;
    });
    setDirty(true);
  }
  function dismissContext(key: ContextKey) {
    setDraft((prev) =>
      prev.draft ? ({ ...prev, draft: { ...prev.draft, [key]: undefined } } as Draft) : prev,
    );
    setDirty(true);
  }

  async function handleDelete() {
    if (!confirm(`Удалить регион «${draft.name}»? Это действие нельзя отменить.`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/regions/${draft.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось удалить");
      toast.success("Регион удалён");
      router.push("/regions");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка удаления");
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/regions/${draft.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          federalDistrict: draft.federalDistrict,
          population: draft.population,
          digitalMaturity: draft.digitalMaturity,
          digitalMaturityNote: draft.digitalMaturityNote,
          budgetProfile: draft.budgetProfile,
          budgetCycle: draft.budgetCycle,
          topPriorities: draft.topPriorities,
          federalProjects: draft.federalProjects,
          painPoints: draft.painPoints,
          news: draft.news,
          stakeholders: draft.stakeholders,
          keyAccountManager: draft.keyAccountManager,
          relationshipManager: draft.relationshipManager,
          activeProjects: draft.activeProjects,
          pastEngagements: draft.pastEngagements,
          relevantProducts: draft.relevantProducts,
          quarterlyPriorities: draft.quarterlyPriorities,
          sberNote: draft.sberNote,
          draft: draft.draft,
        }),
      });
      const data = (await response.json()) as { region?: RegionProfile; error?: string };
      if (!response.ok || !data.region) throw new Error(data.error || "Save failed");
      setDraft(data.region);
      setDirty(false);
      toast.success("Сохранено");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  const d = draft.draft;
  const draftContext = d
    ? CONTEXT_FIELDS.filter((f) => {
        const value = d[f.key];
        return value !== undefined && value !== null && value !== "";
      })
    : [];
  const draftCount = d
    ? d.topPriorities.length +
      d.painPoints.length +
      d.news.length +
      d.stakeholders.length +
      draftContext.length
    : 0;
  const autofillBusy = autofilling || d?.status === "generating";

  return (
    <div className="space-y-4">
      {/* Шапка */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Link href="/regions" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" />
          </Link>
          <h1 className="text-base font-semibold">{draft.name}</h1>
          {draft.digitalMaturity && (
            <Badge variant="secondary" className="text-[10px]">{draft.digitalMaturity}/5</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>
            <Trash2 className="size-3.5" /> Удалить
          </Button>
          <Button size="sm" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            Сохранить
          </Button>
        </div>
      </div>

      <Tabs defaultValue="strategy">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="strategy">
            <MapPin className="size-4" /> Стратегия региона
          </TabsTrigger>
          <TabsTrigger value="sber">
            <Building2 className="size-4" /> Портфель Сбера
          </TabsTrigger>
        </TabsList>

        {/* ── Стратегия региона ── */}
        <TabsContent value="strategy" className="space-y-4">
          {/* Черновик из открытых источников */}
          <Card className="rounded-2xl border-primary/30 bg-primary/[0.03]">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="size-4 text-primary" /> Черновик из открытых источников
                  </h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Данные не подтверждены. Подтвердите нужные, остальные отклоните — до подтверждения они используются в генерации как гипотезы.
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={runAutofill} disabled={autofillBusy}>
                  {autofillBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {d ? "Обновить" : "Заполнить из источников"}
                </Button>
              </div>

              {autofillBusy && (
                <div className="flex items-center gap-2 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Сбор данных из открытых источников…
                </div>
              )}

              {d && d.status !== "generating" && draftCount === 0 && !autofilling && (
                <Empty label="Открытые источники не предоставили проверяемых данных по региону. Заполните карточку вручную." />
              )}

              {d && draftCount > 0 && (
                <div className="space-y-3">
                  {draftContext.length > 0 && (
                    <DraftSection title="Контекст региона">
                      {draftContext.map((f) => (
                        <DraftRow
                          key={f.key}
                          text={`${f.label}: ${String(d[f.key])}`}
                          onAccept={() => acceptContext(f.key)}
                          onDismiss={() => dismissContext(f.key)}
                        />
                      ))}
                    </DraftSection>
                  )}
                  {d.topPriorities.length > 0 && (
                    <DraftSection title="Приоритеты">
                      {d.topPriorities.map((item) => (
                        <DraftRow
                          key={item.id}
                          text={item.title}
                          note={item.source}
                          onAccept={() => acceptPriority(item)}
                          onDismiss={() => dismissPriority(item.id)}
                        />
                      ))}
                    </DraftSection>
                  )}
                  {d.painPoints.length > 0 && (
                    <DraftSection title="Проблемы и узкие места">
                      {d.painPoints.map((text, i) => (
                        <DraftRow
                          key={i}
                          text={text}
                          onAccept={() => acceptPain(text)}
                          onDismiss={() => dismissPain(text)}
                        />
                      ))}
                    </DraftSection>
                  )}
                  {d.stakeholders.length > 0 && (
                    <DraftSection title="ЛПР — проверьте ФИО и роль">
                      {d.stakeholders.map((item) => (
                        <DraftRow
                          key={item.id}
                          text={`${item.fullName} — ${item.role}`}
                          note={item.department || item.motivation}
                          onAccept={() => acceptStakeholder(item)}
                          onDismiss={() => dismissStakeholder(item.id)}
                        />
                      ))}
                    </DraftSection>
                  )}
                  {d.news.length > 0 && (
                    <DraftSection title="Актуальная повестка">
                      {d.news.map((item) => (
                        <DraftRow
                          key={item.id}
                          text={item.title}
                          note={item.source}
                          onAccept={() => acceptNews(item)}
                          onDismiss={() => dismissNews(item.id)}
                        />
                      ))}
                    </DraftSection>
                  )}
                  {d.sources.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">Источники: {d.sources.join(", ")}</p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Название">
                <Input value={draft.name} onChange={(e) => patch("name", e.target.value)} />
              </Field>
              <Field label="Федеральный округ">
                <Input
                  value={draft.federalDistrict ?? ""}
                  onChange={(e) => patch("federalDistrict", e.target.value)}
                />
              </Field>
              <Field label="Население">
                <Input
                  value={draft.population ?? ""}
                  onChange={(e) => patch("population", e.target.value)}
                />
              </Field>
              <Field label="Цифровая зрелость (1–5)">
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={draft.digitalMaturity ?? ""}
                  onChange={(e) =>
                    patch(
                      "digitalMaturity",
                      e.target.value ? Math.min(5, Math.max(1, Number(e.target.value))) : undefined,
                    )
                  }
                />
              </Field>
              <Field label="Комментарий к зрелости" full>
                <Textarea
                  rows={2}
                  value={draft.digitalMaturityNote ?? ""}
                  onChange={(e) => patch("digitalMaturityNote", e.target.value)}
                />
              </Field>
              <Field label="Бюджетный профиль" full>
                <Textarea
                  rows={2}
                  value={draft.budgetProfile ?? ""}
                  onChange={(e) => patch("budgetProfile", e.target.value)}
                />
              </Field>
              <Field label="Бюджетный цикл" full>
                <Input
                  value={draft.budgetCycle ?? ""}
                  onChange={(e) => patch("budgetCycle", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          {/* Приоритеты */}
          <Card className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <SectionHeader
                title="Стратегические приоритеты региона"
                onAdd={() =>
                  patch("topPriorities", [
                    ...draft.topPriorities,
                    { id: newId(), title: "", source: "" } satisfies StrategicPriority,
                  ])
                }
              />
              {draft.topPriorities.length === 0 && <Empty label="Приоритеты не добавлены" />}
              <div className="space-y-2">
                {draft.topPriorities.map((priority, idx) => (
                  <div key={priority.id} className="grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-[1fr_1fr_auto]">
                    <Input
                      placeholder="Название приоритета"
                      value={priority.title}
                      onChange={(e) => {
                        const next = [...draft.topPriorities];
                        next[idx] = { ...priority, title: e.target.value };
                        patch("topPriorities", next);
                      }}
                    />
                    <Input
                      placeholder="Источник (стратегия, указ, нацпроект)"
                      value={priority.source ?? ""}
                      onChange={(e) => {
                        const next = [...draft.topPriorities];
                        next[idx] = { ...priority, source: e.target.value };
                        patch("topPriorities", next);
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        patch(
                          "topPriorities",
                          draft.topPriorities.filter((p) => p.id !== priority.id),
                        )
                      }
                    >
                      <Trash2 className="size-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Федеральные проекты и боли — простые массивы строк */}
          <Card className="rounded-2xl">
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <StringListField
                label="Федеральные проекты"
                values={draft.federalProjects}
                onChange={(values) => patch("federalProjects", values)}
                placeholder="Цифровая экономика"
              />
              <StringListField
                label="Проблемы и узкие места"
                values={draft.painPoints}
                onChange={(values) => patch("painPoints", values)}
                placeholder="Нагрузка на контакт-центры"
              />
            </CardContent>
          </Card>

          {/* ЛПР */}
          <Card className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <SectionHeader
                title="Карта ЛПР"
                onAdd={() =>
                  patch("stakeholders", [
                    ...draft.stakeholders,
                    {
                      id: newId(),
                      fullName: "",
                      role: "",
                      department: "",
                      motivation: "",
                      redFlags: "",
                      relationship: "cold",
                    } satisfies Stakeholder,
                  ])
                }
              />
              {draft.stakeholders.length === 0 && <Empty label="ЛПР не добавлены" />}
              <div className="space-y-3">
                {draft.stakeholders.map((person, idx) => (
                  <div key={person.id} className="rounded-xl border bg-background p-3">
                    <div className="mb-2 grid gap-2 sm:grid-cols-3">
                      <Input
                        placeholder="ФИО"
                        value={person.fullName}
                        onChange={(e) => {
                          const next = [...draft.stakeholders];
                          next[idx] = { ...person, fullName: e.target.value };
                          patch("stakeholders", next);
                        }}
                      />
                      <Input
                        placeholder="Должность"
                        value={person.role}
                        onChange={(e) => {
                          const next = [...draft.stakeholders];
                          next[idx] = { ...person, role: e.target.value };
                          patch("stakeholders", next);
                        }}
                      />
                      <Input
                        placeholder="Ведомство"
                        value={person.department ?? ""}
                        onChange={(e) => {
                          const next = [...draft.stakeholders];
                          next[idx] = { ...person, department: e.target.value };
                          patch("stakeholders", next);
                        }}
                      />
                    </div>
                    <div className="mb-2 grid gap-2 sm:grid-cols-2">
                      <Textarea
                        rows={2}
                        placeholder="Мотивация / KPI"
                        value={person.motivation ?? ""}
                        onChange={(e) => {
                          const next = [...draft.stakeholders];
                          next[idx] = { ...person, motivation: e.target.value };
                          patch("stakeholders", next);
                        }}
                      />
                      <Textarea
                        rows={2}
                        placeholder="Стоп-факторы и триггеры отказа"
                        value={person.redFlags ?? ""}
                        onChange={(e) => {
                          const next = [...draft.stakeholders];
                          next[idx] = { ...person, redFlags: e.target.value };
                          patch("stakeholders", next);
                        }}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1.5">
                        {(["cold", "warm", "hot"] as const).map((value) => (
                          <button
                            type="button"
                            key={value}
                            onClick={() => {
                              const next = [...draft.stakeholders];
                              next[idx] = { ...person, relationship: value };
                              patch("stakeholders", next);
                            }}
                            className={cn(
                              "rounded-lg border px-2 py-0.5 text-xs transition",
                              person.relationship === value
                                ? "border-primary bg-primary text-primary-foreground"
                                : "bg-background hover:bg-muted/50",
                            )}
                          >
                            {relationshipLabels[value]}
                          </button>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() =>
                          patch(
                            "stakeholders",
                            draft.stakeholders.filter((p) => p.id !== person.id),
                          )
                        }
                      >
                        <Trash2 className="size-4" /> Удалить
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Портфель Сбера ── */}
        <TabsContent value="sber" className="space-y-4">
          <p className="px-1 text-xs text-muted-foreground">
            Все поля необязательны: чем полнее карточка, тем точнее материалы агента. Незаполненные поля в генерацию не передаются.
          </p>
          <Card className="rounded-2xl">
            <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Ответственный менеджер">
                <Input
                  placeholder="Key account Сбера по региону — ФИО"
                  value={draft.keyAccountManager ?? ""}
                  onChange={(e) => patch("keyAccountManager", e.target.value)}
                />
              </Field>
              <Field label="Руководитель направления">
                <Input
                  placeholder="RM блока Госсектор — ФИО"
                  value={draft.relationshipManager ?? ""}
                  onChange={(e) => patch("relationshipManager", e.target.value)}
                />
              </Field>
              <Field label="Заметка для заходов в регион" full>
                <Textarea
                  rows={3}
                  value={draft.sberNote ?? ""}
                  onChange={(e) => patch("sberNote", e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="grid gap-4 p-4 md:grid-cols-2">
              <StringListField
                label="Релевантные продукты Сбера"
                hint="Продукты, которые планируется развивать в регионе (намерение). Текущие продажи указывайте в разделе «Активные проекты» ниже."
                values={draft.relevantProducts}
                onChange={(values) => patch("relevantProducts", values)}
                placeholder="GigaChat"
              />
              <StringListField
                label="Приоритеты блока на квартал"
                values={draft.quarterlyPriorities}
                onChange={(values) => patch("quarterlyPriorities", values)}
                placeholder="Договориться о пилоте"
              />
            </CardContent>
          </Card>

          {/* Активные проекты Сбера */}
          <Card className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-muted-foreground" />
                  Активные проекты Сбера в регионе
                </h3>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCatalogOpen((v) => !v)}
                    disabled={catalog.length === 0}
                  >
                    <Building2 className="size-3.5" /> Из каталога
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      patch("activeProjects", [
                        ...draft.activeProjects,
                        {
                          id: newId(),
                          product: "",
                          title: "",
                          stage: "discovery",
                          amount: "",
                          sberOwner: "",
                          customerOwner: "",
                          startedAt: "",
                          notes: "",
                        } satisfies SberProject,
                      ])
                    }
                  >
                    <Plus className="size-3.5" /> Вручную
                  </Button>
                </div>
              </div>
              {catalogOpen && (
                <div className="rounded-xl border bg-muted/20 p-2">
                  <p className="mb-1.5 px-1 text-[11px] text-muted-foreground">
                    Выберите проект — основные поля заполнятся автоматически; останется указать сумму и владельца:
                  </p>
                  <div className="max-h-56 space-y-1 overflow-auto">
                    {catalog.map((cp) => (
                      <button
                        key={cp.id}
                        type="button"
                        onClick={() => addProjectFromCatalog(cp)}
                        className="flex w-full items-start gap-2 rounded-lg border bg-background p-2 text-left transition hover:border-primary/40 hover:bg-primary/[0.03]"
                      >
                        <Plus className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium leading-snug">{cp.name}</span>
                          {cp.sberProducts.length > 0 && (
                            <span className="block text-[10px] text-muted-foreground">
                              {cp.sberProducts.slice(0, 3).join(", ")}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {draft.activeProjects.length === 0 && (
                <Empty label="Проекты Сбера в регионе не добавлены" />
              )}
              <div className="space-y-3">
                {draft.activeProjects.map((project, idx) => {
                  const detailsOpen = openProjectIds.has(project.id);
                  const hasDetails = Boolean(
                    project.amount || project.sberOwner || project.customerOwner || project.startedAt || project.notes,
                  );
                  return (
                  <div key={project.id} className="rounded-xl border bg-background p-3">
                    {/* Главное: продукт + название */}
                    <div className="mb-2 grid gap-2 sm:grid-cols-2">
                      <Input
                        placeholder="Продукт (GigaChat, SberCloud...)"
                        value={project.product}
                        onChange={(e) => {
                          const next = [...draft.activeProjects];
                          next[idx] = { ...project, product: e.target.value };
                          patch("activeProjects", next);
                        }}
                      />
                      <Input
                        placeholder="Название инициативы"
                        value={project.title}
                        onChange={(e) => {
                          const next = [...draft.activeProjects];
                          next[idx] = { ...project, title: e.target.value };
                          patch("activeProjects", next);
                        }}
                      />
                    </div>

                    {/* Управление: стадия · детали · удалить */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex flex-wrap gap-1">
                        {projectStageOptions.map((value) => (
                          <button
                            type="button"
                            key={value}
                            onClick={() => {
                              const next = [...draft.activeProjects];
                              next[idx] = { ...project, stage: value };
                              patch("activeProjects", next);
                            }}
                            className={cn(
                              "rounded-lg px-2 py-0.5 text-xs transition",
                              project.stage === value
                                ? cn("ring-1 ring-primary", stageColors[value])
                                : "bg-muted text-muted-foreground hover:bg-muted/70",
                            )}
                          >
                            {stageLabels[value]}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => toggleProjectDetails(project.id)}
                        className="rounded-lg px-2 py-0.5 text-xs text-muted-foreground transition hover:bg-muted"
                      >
                        {detailsOpen ? "Скрыть детали" : hasDetails ? "Детали •" : "Детали"}
                      </button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        onClick={() =>
                          patch(
                            "activeProjects",
                            draft.activeProjects.filter((p) => p.id !== project.id),
                          )
                        }
                      >
                        <Trash2 className="size-4" /> Удалить
                      </Button>
                    </div>

                    {/* Детали: сумма, владельцы, дата, заметки — по запросу */}
                    {detailsOpen && (
                      <div className="mt-3 space-y-2 border-t pt-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <Input
                            placeholder="Сумма"
                            value={project.amount ?? ""}
                            onChange={(e) => {
                              const next = [...draft.activeProjects];
                              next[idx] = { ...project, amount: e.target.value };
                              patch("activeProjects", next);
                            }}
                          />
                          <Input
                            placeholder="Владелец Сбера"
                            value={project.sberOwner ?? ""}
                            onChange={(e) => {
                              const next = [...draft.activeProjects];
                              next[idx] = { ...project, sberOwner: e.target.value };
                              patch("activeProjects", next);
                            }}
                          />
                          <Input
                            placeholder="Контакт заказчика"
                            value={project.customerOwner ?? ""}
                            onChange={(e) => {
                              const next = [...draft.activeProjects];
                              next[idx] = { ...project, customerOwner: e.target.value };
                              patch("activeProjects", next);
                            }}
                          />
                        </div>
                        <Input
                          placeholder="Дата начала"
                          value={project.startedAt ?? ""}
                          onChange={(e) => {
                            const next = [...draft.activeProjects];
                            next[idx] = { ...project, startedAt: e.target.value };
                            patch("activeProjects", next);
                          }}
                        />
                        <Textarea
                          rows={2}
                          placeholder="Заметки: базовые показатели, риски, интеграции..."
                          value={project.notes ?? ""}
                          onChange={(e) => {
                            const next = [...draft.activeProjects];
                            next[idx] = { ...project, notes: e.target.value };
                            patch("activeProjects", next);
                          }}
                        />
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* История */}
          <Card className="rounded-2xl">
            <CardContent className="space-y-3 p-4">
              <SectionHeader
                title="История прошлых заходов"
                onAdd={() =>
                  patch("pastEngagements", [
                    ...draft.pastEngagements,
                    {
                      id: newId(),
                      topic: "",
                      outcome: "postponed",
                      reason: "",
                      date: "",
                    } satisfies PastEngagement,
                  ])
                }
              />
              {draft.pastEngagements.length === 0 && (
                <Empty label="История заходов пуста" />
              )}
              <div className="space-y-2">
                {draft.pastEngagements.map((engagement, idx) => (
                  <div
                    key={engagement.id}
                    className="grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Input
                      placeholder="Тема обсуждения"
                      value={engagement.topic}
                      onChange={(e) => {
                        const next = [...draft.pastEngagements];
                        next[idx] = { ...engagement, topic: e.target.value };
                        patch("pastEngagements", next);
                      }}
                    />
                    <Input
                      placeholder="Причина такого исхода"
                      value={engagement.reason ?? ""}
                      onChange={(e) => {
                        const next = [...draft.pastEngagements];
                        next[idx] = { ...engagement, reason: e.target.value };
                        patch("pastEngagements", next);
                      }}
                    />
                    <div className="flex items-center gap-1">
                      <div className="flex flex-wrap gap-1">
                        {pastEngagementOutcomeOptions.map((value) => (
                          <button
                            type="button"
                            key={value}
                            onClick={() => {
                              const next = [...draft.pastEngagements];
                              next[idx] = { ...engagement, outcome: value };
                              patch("pastEngagements", next);
                            }}
                            className={cn(
                              "rounded-md px-1.5 py-0.5 text-[11px]",
                              engagement.outcome === value
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:bg-muted/70",
                            )}
                          >
                            {outcomeLabels[value]}
                          </button>
                        ))}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          patch(
                            "pastEngagements",
                            draft.pastEngagements.filter((p) => p.id !== engagement.id),
                          )
                        }
                      >
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {dirty && (
            <div className="sticky bottom-4 flex justify-end">
              <Button onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <CircleCheck className="size-4" />}
                Сохранить изменения
              </Button>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Вспомогательные ────────────────────────────────────────────────────────

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn(full && "sm:col-span-2")}>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function SectionHeader({
  title,
  onAdd,
}: {
  title: string;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Users className="size-4 text-muted-foreground" />
        {title}
      </h3>
      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <Plus className="size-3.5" /> Добавить
      </Button>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function DraftSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function DraftRow({
  text,
  note,
  onAccept,
  onDismiss,
}: {
  text: string;
  note?: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed bg-background p-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">{text}</p>
        {note && <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>}
      </div>
      <button
        type="button"
        title="Принять"
        onClick={onAccept}
        className="shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 p-1.5 text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
      >
        <Check className="size-3.5" />
      </button>
      <button
        type="button"
        title="Отклонить"
        onClick={onDismiss}
        className="shrink-0 rounded-lg border p-1.5 text-muted-foreground transition hover:bg-muted"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function StringListField({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  const [input, setInput] = useState("");
  function add() {
    const clean = input.trim();
    if (!clean || values.includes(clean)) return;
    onChange([...values, clean]);
    setInput("");
  }
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{label}</p>
      {hint && <p className="mb-1.5 -mt-1 text-[11px] text-muted-foreground/80">{hint}</p>}
      <div className="flex gap-2">
        <Input
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          Добавить
        </Button>
      </div>
      {values.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <span
              key={value}
              className="inline-flex items-center gap-1 rounded-lg border bg-background px-2 py-0.5 text-xs"
            >
              {value}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => onChange(values.filter((v) => v !== value))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
