import type { CreateSessionInput } from "@/lib/schemas/session";
import type { RegionProfile } from "@/lib/schemas/region";
import { getStorage } from "./local-json-storage";

const translitMap: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Транслитерирует название региона в безопасный slug вроде "tulskaya-oblast". */
export function regionNameToSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .split("")
    .map((char) => translitMap[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `region-${Date.now().toString(36)}`;
}

/** Подбор существующего региона по имени — та же логика, что в resolveRegion. */
export function matchRegionByName(
  regions: RegionProfile[],
  name: string,
): RegionProfile | null {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return null;
  return (
    regions.find((item) => item.name.toLowerCase() === normalized) ??
    regions.find((item) => item.slug === normalized) ??
    regions.find(
      (item) =>
        normalized.includes(item.slug) || item.name.toLowerCase().includes(normalized),
    ) ??
    null
  );
}

export interface EnsureRegionResult<T> {
  input: T;
  /** id региона, если он был СОЗДАН в этом вызове (для фонового автозаполнения). */
  createdRegionId?: string;
}

/**
 * Гарантирует, что у сессии есть привязка к региону в справочнике.
 *
 * Если `regionId` уже задан и валиден — ничего не делаем. Иначе ищем регион по
 * имени; если его нет — создаём минимальный профиль (карточку дозаполнит фоновое
 * автозаполнение или пользователь вручную) и проставляем `regionId`.
 *
 * Возвращает (возможно изменённый) input и id созданного региона, если создан.
 */
export async function ensureRegionForSession<T extends CreateSessionInput>(
  input: T,
): Promise<EnsureRegionResult<T>> {
  const regionName = input.region?.trim();
  if (!regionName) return { input };

  const storage = getStorage();

  // Уже привязан валидный regionId — выходим.
  if (input.regionId) {
    const existing = await storage.getRegion(input.regionId);
    if (existing) return { input };
  }

  const regions = await storage.listRegions();
  const matched = matchRegionByName(regions, regionName);
  if (matched) {
    return { input: { ...input, region: matched.name, regionId: matched.id } };
  }

  // Региона нет в справочнике — создаём минимальный профиль.
  let slug = regionNameToSlug(regionName);
  if (regions.some((item) => item.slug === slug)) {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  }
  try {
    const created = await storage.createRegion({
      slug,
      name: regionName,
      topPriorities: [],
      federalProjects: [],
      painPoints: [],
      news: [],
      stakeholders: [],
      activeProjects: [],
      pastEngagements: [],
      relevantProducts: [],
      quarterlyPriorities: [],
      sberNote: "Карточка создана автоматически при создании сессии. Дозаполните профиль вручную или подтяните открытые данные.",
    });
    return {
      input: { ...input, region: created.name, regionId: created.id },
      createdRegionId: created.id,
    };
  } catch {
    // Регион не создался (например, гонка по slug) — оставляем текстовое имя.
    return { input };
  }
}
