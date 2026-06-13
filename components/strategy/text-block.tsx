export function TextBlock({ content, className = "" }: { content: string; className?: string }) {
  const lines = cleanText(content).split("\n").map((line) => line.trim()).filter(Boolean);
  return (
    <div className={`space-y-2 ${className}`}>
      {lines.map((line, index) => {
        const normalized = line.replace(/^[-•]\s*/, "").replace(/^\d+[.)]\s*/, "");
        return <p key={`${index}-${line.slice(0, 32)}`} className="text-sm leading-6 text-foreground/85 md:text-[15px]">{normalized}</p>;
      })}
    </div>
  );
}

export function cleanText(value: string) {
  return value
    .replace(/\*\*/g, "")
    .replace(/#{1,6}\s?/g, "")
    .replace(/`/g, "")
    .trim();
}
