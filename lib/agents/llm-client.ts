import type { LlmCall } from "@/lib/schemas/agent";

// 2 попытки на модель: при наличии запасной модели суммарно до 4 попыток на двух
// моделях — быстрее уходим на фолбэк, не залипая на недоступной основной.
const MAX_ATTEMPTS = 2;
// Транзиентные ошибки сети/сервера, которые имеет смысл повторить.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Один сетевой запрос к LLM. Возвращает content или бросает ошибку с пометкой,
 * можно ли повторить (retryable).
 */
async function callOnce(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  isReasoningModel: boolean;
  messages: LlmCall["messages"];
  temperature: number;
  maxTokens: number;
  responseFormat?: LlmCall["responseFormat"];
}): Promise<string> {
  const { baseUrl, apiKey, model, isReasoningModel, messages, temperature, maxTokens, responseFormat } = params;

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      // 120с: щедро для медленных ответов, но обрываем зависший коннект раньше,
      // чем провайдерский шлюз отдаст 504 (~180с) — быстрее уходим на ретрай/фолбэк.
      signal: AbortSignal.timeout(Number(process.env.LLM_REQUEST_TIMEOUT_MS || 120_000)),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: isReasoningModel ? 1 : temperature, // reasoning models require temperature=1
        max_tokens: maxTokens,
        top_p: 0.95,
        presence_penalty: 0,
        ...(responseFormat ? { response_format: { type: responseFormat } } : {}),
      }),
    });
  } catch (err) {
    // Таймаут/обрыв сети — транзиентно, повторяем.
    const e = new Error(`LLM network error for ${model}: ${err instanceof Error ? err.message : err}`);
    (e as Error & { retryable?: boolean }).retryable = true;
    throw e;
  }

  if (!response.ok) {
    const body = await response.text();
    const e = new Error(`LLM request failed for ${model}: ${response.status} ${body.slice(0, 500)}`);
    (e as Error & { retryable?: boolean }).retryable = RETRYABLE_STATUS.has(response.status);
    throw e;
  }

  const data = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | null;
      };
    }>;
  };

  const msg = data.choices?.[0]?.message;
  // Reasoning-модели могут вернуть content=null, а ответ в reasoning/reasoning_content
  const content = msg?.content || msg?.reasoning_content || msg?.reasoning || null;

  if (!content) {
    console.error(
      `[llm-client] Empty content from ${model}. Full response:`,
      JSON.stringify(data).slice(0, 800),
    );
    // Пустой ответ у reasoning-моделей бывает транзиентным — повторяем.
    const e = new Error(`LLM returned empty content for ${model}.`);
    (e as Error & { retryable?: boolean }).retryable = true;
    throw e;
  }
  return content;
}

function isReasoning(model: string) {
  return model.includes("gpt-oss") || model.includes("o1") || model.includes("o3");
}

export async function callLLM({ messages, temperature = 0.2, maxTokens = 4000, responseFormat }: LlmCall) {
  const baseUrl = process.env.CLOUD_RU_BASE_URL || "https://foundation-models.api.cloud.ru/v1";
  const apiKey = process.env.CLOUD_RU_API_KEY;

  if (!apiKey) {
    throw new Error("CLOUD_RU_API_KEY is required. Mock generation is disabled.");
  }

  // Основная модель + запасная. При недоступности основной (503/504/no healthy
  // upstream, таймаут) автоматически повторяем запрос на запасной модели, чтобы
  // сбой одного провайдера не ронял генерацию. Запасная по умолчанию — дешёвая
  // и стабильная GigaChat (Сбер, внутренняя, не reasoning).
  const primary = process.env.CLOUD_RU_MODEL || "ai-sage/GigaChat3-10B-A1.8B";
  const fallback = process.env.CLOUD_RU_FALLBACK_MODEL || "ai-sage/GigaChat3-10B-A1.8B";
  const models = [primary, ...(fallback && fallback !== primary ? [fallback] : [])];

  let lastError: unknown;
  for (let m = 0; m < models.length; m++) {
    const model = models[m];
    const isReasoningModel = isReasoning(model);
    const effectiveMaxTokens = isReasoningModel ? Math.max(maxTokens * 3, 8000) : maxTokens;
    if (m > 0) {
      console.warn(`[llm-client] primary failed; failover to fallback model ${model}`);
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await callOnce({
          baseUrl,
          apiKey,
          model,
          isReasoningModel,
          messages,
          temperature,
          maxTokens: effectiveMaxTokens,
          responseFormat,
        });
      } catch (err) {
        lastError = err;
        const retryable = (err as Error & { retryable?: boolean }).retryable === true;
        if (!retryable || attempt === MAX_ATTEMPTS) break; // прекращаем ретраи этой модели
        // Экспоненциальный backoff: 1.5с, 3с.
        const delay = 1500 * attempt;
        console.warn(
          `[llm-client] ${model} attempt ${attempt}/${MAX_ATTEMPTS} failed (${err instanceof Error ? err.message : err}); retry in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
    // Модель исчерпала попытки — переходим к следующей (запасной), если есть.
  }
  throw lastError instanceof Error ? lastError : new Error("LLM call failed");
}
