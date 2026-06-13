import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cleanText } from "./text-block";

export function RiskCard({ risks }: { risks: string[] }) {
  const items = risks
    .flatMap((risk) => cleanText(risk).split(/\n/))
    .map((risk) => risk.replace(/^[-*\d.)#\s]+/, "").replace(/\*\*/g, "").trim())
    .filter((risk) => risk.length > 18)
    .filter((risk) => !/^(ключевые риски|как их снять|риски|решение|механизм эффекта|следующий шаг)$/i.test(risk))
    .slice(0, 4);
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="size-4" /> Риски</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {items.map((risk, index) => (
          <div key={`${index}-${risk.slice(0, 32)}`} className="rounded-xl border bg-background p-3">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Стоп-фактор {index + 1}</p>
            <p className="text-sm leading-5 text-foreground/85">{risk}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
