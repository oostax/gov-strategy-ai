"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, MapPin, Save } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function NewRegionPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [federalDistrict, setFederalDistrict] = useState("");
  const [population, setPopulation] = useState("");
  const [sberNote, setSberNote] = useState("");

  // Auto-generate slug from name
  function handleNameChange(value: string) {
    setName(value);
    if (!slug || slug === generateSlug(name)) {
      setSlug(generateSlug(value));
    }
  }

  function generateSlug(text: string): string {
    const map: Record<string, string> = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
      з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
      п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
      ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya",
    };
    return text
      .toLowerCase()
      .split("")
      .map((c) => map[c] ?? c)
      .join("")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Укажите название региона");
      return;
    }
    if (!slug.trim()) {
      toast.error("Укажите slug");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          federalDistrict: federalDistrict.trim() || undefined,
          population: population.trim() || undefined,
          sberNote: sberNote.trim() || undefined,
          topPriorities: [],
          federalProjects: [],
          painPoints: [],
          news: [],
          stakeholders: [],
          activeProjects: [],
          pastEngagements: [],
          relevantProducts: [],
          quarterlyPriorities: [],
        }),
      });
      const data = (await response.json()) as { region?: { id: string }; error?: string };
      if (!response.ok || !data.region) {
        throw new Error(data.error || "Не удалось создать регион");
      }
      toast.success("Регион создан");
      router.push(`/regions/${data.region.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Link
            href="/regions"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Регионы
          </Link>
          <span className="text-muted-foreground">/</span>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <MapPin className="size-5" /> Новый регион
          </h1>
        </div>

        <Card className="rounded-2xl">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Название региона *" full>
              <Input
                placeholder="Республика Дагестан"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </Field>
            <Field label="Федеральный округ">
              <Input
                placeholder="Северо-Кавказский ФО"
                value={federalDistrict}
                onChange={(e) => setFederalDistrict(e.target.value)}
              />
            </Field>
            <Field label="Население">
              <Input
                placeholder="~3.1 млн"
                value={population}
                onChange={(e) => setPopulation(e.target.value)}
              />
            </Field>
            <Field label="Заметка для заходов Сбера" full>
              <Textarea
                rows={3}
                placeholder="Что важно знать при работе с этим регионом..."
                value={sberNote}
                onChange={(e) => setSberNote(e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Создать регион
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          После создания вы сможете добавить ЛПР, проекты Сбера, приоритеты и боли на странице редактирования.
        </p>
      </div>
    </AppShell>
  );
}

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
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}
