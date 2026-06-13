import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cleanText } from "./text-block";

export function MetricsCard({ content }: { content: string }) {
  const items = parseMetrics(content);
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Метрики и контроль</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Метрики не сформированы.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border">
            <div className="grid grid-cols-[1fr_1.2fr] bg-muted/50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Метрика</span>
              <span>Как считать / где взять</span>
            </div>
            {items.map((item, index) => (
              <div key={`${index}-${item.metric}`} className="grid grid-cols-[1fr_1.2fr] gap-3 border-t px-3 py-3 text-sm leading-5">
                <span className="font-medium">{item.metric}</span>
                <span className="text-muted-foreground">{item.formula}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function parseMetrics(content: string) {
  const cleaned = cleanText(content).replace(/\*\*/g, "");
  const lines = cleaned
    .split(/\n|(?<=\.)\s+(?=[А-ЯA-Z])/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((item) => item.length > 20)
    .filter((item) => !/^(метрики|экономика|результат|для руководителя)$/i.test(item))
    .slice(0, 4);

  return lines.map((line) => {
    const [metric, ...rest] = line.split(/:\s+/);
    return {
      metric: metric.length > 48 ? metric.slice(0, 45).trim() + "..." : metric,
      formula: rest.join(": ") || "Требуется определить базовую линию и источник данных.",
    };
  });
}
