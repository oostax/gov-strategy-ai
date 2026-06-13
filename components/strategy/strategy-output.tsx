import { ArrowRight, Building2, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentOutput } from "@/lib/schemas/output";
import { MetricsCard } from "./metrics-card";
import { OutputCard } from "./output-card";
import { RiskCard } from "./risk-card";
import { RoadmapCard } from "./roadmap-card";
import { TextBlock, cleanText } from "./text-block";

const outputTypeLabels: Record<string, string> = {
  strategic_bets: "Стратегические ставки",
  sber_region_strategy: "Стратегия Сбера в регионе",
  region_strategy: "Региональная стратегия",
  scenario_analysis: "Сценарный анализ",
  roadmap: "Дорожная карта",
  product_hypothesis: "Продуктовая гипотеза",
  executive_brief: "Краткая записка",
  meeting_preparation: "Подготовка встречи",
  playbook_update: "Обновление правил",
  strategy: "Стратегия",
  action: "Действие",
  evolution_rewrite: "Улучшенная версия",
};

export function StrategyOutput({ output }: { output: AgentOutput | null }) {
  if (!output) {
    return (
      <Card className="rounded-2xl border-dashed">
        <CardContent className="flex min-h-96 items-center justify-center p-10 text-center">
          <div className="max-w-md">
            <FileText className="mx-auto mb-4 size-10 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Документ не сформирован</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Сформулируйте запрос выше. После генерации здесь появится стратегический материал: резюме, MVP, метрики, риски, источники и роль Сбера.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const visibleSections = output.sections.filter((section, index, all) => {
    if (["План ответа", "Краткое резюме"].includes(section.title)) return false;
    if (section.title.toLowerCase().includes("сбер")) return false;
    if (cleanText(section.content) === cleanText(output.summary)) return false;
    return all.findIndex((candidate) => candidate.title === section.title && candidate.content === section.content) === index;
  });
  const sberSection =
    output.sections.find((section) => section.title.toLowerCase().includes("сбер")) ??
    output.sections.find((section) => section.content.toLowerCase().includes("как может помочь сбер")) ??
    output.sections.find((section) => section.content.toLowerCase().includes("роль сбера"));
  const usedSources = output.sources?.filter((source) => source.status === "used") ?? [];
  const sourcesToCheck = output.sources?.filter((source) => source.status === "needs_check") ?? [];

  return (
    <article className="space-y-4">
      <Card className="rounded-2xl border-primary/10">
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
            <div>
              <Badge variant="secondary">{outputTypeLabels[output.type] ?? output.type}</Badge>
              <CardTitle className="mt-2 max-w-3xl text-xl font-semibold tracking-tight">{cleanText(output.title)}</CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-xl bg-muted/40 p-4">
            <TextBlock content={output.summary} />
          </div>
          {output.nextSteps.length > 0 && (
            <div className="rounded-xl border p-3">
              <p className="mb-2 text-sm font-semibold">Следующие шаги</p>
              <div className="grid gap-1.5">
                {output.nextSteps.map((step) => (
                  <div key={step} className="flex gap-2 text-sm text-muted-foreground">
                    <ArrowRight className="mt-0.5 size-4 shrink-0" />
                    <span>{cleanText(step)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <div className="grid gap-4">
        {visibleSections.map((section) => {
          if (section.type === "roadmap") return <RoadmapCard key={section.id} content={section.content} />;
          if (section.type === "metrics") return <MetricsCard key={section.id} content={section.content} />;
          return <OutputCard key={section.id} section={section} />;
        })}
      </div>
      <RiskCard risks={output.risks} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Building2 className="size-5" /> Где может помочь Сбер</CardTitle>
          </CardHeader>
          <CardContent>
            <TextBlock content={extractSberText(sberSection?.content || "") || defaultSberHelp} />
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><ShieldCheck className="size-5" /> Источники и проверки</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Открытые источники</p>
              <div className="space-y-2">
                {usedSources.filter((source) => source.url).slice(0, 5).map((source) => (
                  <a
                    key={`${source.title}-${source.url}`}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-xl border p-3 text-sm leading-5 transition-colors hover:bg-muted/50"
                  >
                    <span className="flex items-start gap-2 font-medium">
                      <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
                      {cleanText(source.title)}
                    </span>
                    <span className="mt-1 block text-muted-foreground">{cleanText(source.excerpt)}</span>
                  </a>
                ))}
                {usedSources.filter((source) => source.url).length === 0 && (
                  <p className="rounded-xl border p-3 text-sm text-muted-foreground">Открытые источники не найдены за время поиска.</p>
                )}
              </div>
            </div>
            {sourcesToCheck.length > 0 && <div>
              <p className="mb-2 text-sm font-medium">Нужно подтвердить</p>
              <div className="space-y-2">
                {sourcesToCheck.map((source) => <p key={source.title} className="rounded-xl border p-3 text-sm leading-6 text-muted-foreground">{cleanText(source.excerpt)}</p>)}
              </div>
            </div>}
          </CardContent>
        </Card>
      </div>
    </article>
  );
}

function extractSberText(content: string) {
  const cleaned = cleanText(content);
  if (!cleaned) return "";
  const marker = cleaned.toLowerCase().indexOf("как сбер");
  if (marker === -1) return cleaned;
  return cleaned.slice(marker).replace(/^как сбер может помочь[:\s-]*/i, "").trim();
}

const defaultSberHelp = [
  "Провести диагностику процесса и снять базовую линию: объем, стоимость, время цикла, качество, риски.",
  "Собрать финансовую модель эффекта и карту решений: регламент, данные, каналы, интеграции, владельцы.",
  "Подготовить демонстрационный контур на данных заказчика и вынести решение на управляющий комитет.",
].join("\n");
