/**
 * Логика обучения playbook от сессий и оценок.
 *
 * Правила playbook реально используются в генерации (prompt-builder и
 * structured-generator берут верхние правила), поэтому от их качества зависит
 * результат. Чтобы петля обучения не деградировала, мы:
 *  - кладём свежее правило В НАЧАЛО (генератор берёт верхние);
 *  - схлопываем почти-дубликаты (иначе одно и то же правило копится десятками);
 *  - ограничиваем общий объём, чтобы playbook оставался применимым.
 */

/** Максимум правил в одном playbook — выше этого старые/слабые отбрасываются. */
export const MAX_PLAYBOOK_RULES = 14;

function normalizeRule(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeRule(text).split(" ").filter((w) => w.length >= 4));
}

/** Жаккарова близость множеств слов двух правил (0–1). */
function similarity(a: string, b: string): number {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const word of sa) if (sb.has(word)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Добавляет выученное правило в список:
 *  - если такое (или очень похожее) правило уже есть — заменяет его свежей
 *    формулировкой и поднимает наверх (без накопления дублей);
 *  - иначе ставит правило первым;
 *  - обрезает список до MAX_PLAYBOOK_RULES.
 *
 * Возвращает новый массив (исходный не мутируется).
 */
export function mergeRule(
  rules: string[],
  newRule: string,
  maxRules = MAX_PLAYBOOK_RULES,
): string[] {
  const clean = newRule.trim();
  if (!clean) return rules.slice(0, maxRules);

  const kept = rules.filter((rule) => {
    const norm = normalizeRule(rule);
    if (norm === normalizeRule(clean)) return false; // точный дубль
    if (similarity(rule, clean) >= 0.6) return false; // почти-дубль
    return true;
  });

  return [clean, ...kept].slice(0, maxRules);
}
