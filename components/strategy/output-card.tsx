import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OutputSection } from "@/lib/schemas/output";
import { TextBlock } from "./text-block";

export function OutputCard({ section }: { section: OutputSection }) {
  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">{section.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <TextBlock content={section.content} />
      </CardContent>
    </Card>
  );
}
