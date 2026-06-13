import { GitBranch } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cleanText } from "./text-block";

export function RoadmapCard({ content }: { content: string }) {
  const items = parseRoadmap(content);
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><GitBranch className="size-4" /> MVP и дорожная карта</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {items.map((item, index) => (
          <div key={`${index}-${item.text.slice(0, 32)}`} className="grid grid-cols-[72px_1fr] gap-3 rounded-xl border bg-background p-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{item.label}</span>
            <p className="text-sm leading-5 text-foreground/85">{item.text}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function parseRoadmap(content: string) {
  const cleaned = cleanText(content)
    .replace(/#{1,6}\s*/g, "")
    .replace(/\*\*/g, "");
  const raw = cleaned
    .split(/\n|(?<=\.)\s+(?=(?:Неделя|Этап|Шаг|[1-4][.)]))/)
    .map((item) => item.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((item) => item.length > 18)
    .filter((item) => !/^(решение|ставка|механизм эффекта|цель|пилотный модуль позволит)$/i.test(item))
    .slice(0, 4);

  const labels = ["0-2 нед.", "3-4 нед.", "5-6 нед.", "7-8 нед."];
  return (raw.length ? raw : ["Определить пилотную зону и владельца результата.", "Снять базовую линию и ограничения данных.", "Собрать рабочий контур и проверить эффект.", "Принять решение о запуске или остановке."]).map((text, index) => ({
    label: labels[index] ?? `Шаг ${index + 1}`,
    text,
  }));
}
