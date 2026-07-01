import type { RegionProfile } from "@/lib/schemas/region";
import { russianRegions } from "./russian-regions";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"']/g, "")
    .replace(/[—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantTokens(value: string): string[] {
  return normalize(value)
    .split(/[\s(),]+/)
    .filter(Boolean)
    .filter((token) => !["республика", "область", "край", "город", "автономный", "автономная", "округ"].includes(token));
}

function bestSubjectMatch(input: string): string | null {
  const normalizedInput = normalize(input);
  if (!normalizedInput) return null;

  const exact = russianRegions.find((name) => normalize(name) === normalizedInput);
  if (exact) return exact;

  const inputTokens = significantTokens(input);
  if (!inputTokens.length) return null;

  const candidates = russianRegions
    .map((name) => {
      const normalizedName = normalize(name);
      const tokens = significantTokens(name);
      const exactTokenHits = inputTokens.filter((token) => tokens.includes(token)).length;
      const prefixHits = inputTokens.filter((token) => tokens.some((regionToken) => regionToken.startsWith(token))).length;
      const includesInput = normalizedName.includes(normalizedInput) ? 1 : 0;
      const score = exactTokenHits * 4 + prefixHits * 2 + includesInput;
      return { name, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);

  return candidates[0]?.name ?? null;
}

export function canonicalRegionName(
  input?: string | null,
  profiles: RegionProfile[] = [],
): string {
  const raw = input?.trim();
  if (!raw) return "регион";
  const normalizedRaw = normalize(raw);

  const profileMatch =
    profiles.find((item) => normalize(item.name) === normalizedRaw) ??
    profiles.find((item) => normalize(item.slug) === normalizedRaw) ??
    profiles.find((item) => normalize(item.name).includes(normalizedRaw));
  if (profileMatch) return profileMatch.name;

  return bestSubjectMatch(raw) ?? raw;
}

