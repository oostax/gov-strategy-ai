import type { LlmCall } from "@/lib/schemas/agent";

const MAX_ATTEMPTS = 3;
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
      signal: AbortSignal.timeout(180_000),
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

export async function callLLM({ messages, temperature = 0.2, maxTokens = 4000, responseFormat }: LlmCall) {
  const baseUrl = process.env.CLOUD_RU_BASE_URL || "https://foundation-models.api.cloud.ru/v1";
  const apiKey = process.env.CLOUD_RU_API_KEY;
  const model = process.env.CLOUD_RU_MODEL || "ai-sage/GigaChat3-10B-A1.8B";

  if (!apiKey) {
    throw new Error("CLOUD_RU_API_KEY is required. Mock generation is disabled.");
  }

  // Reasoning-модели (gpt-oss-120b и подобные) нуждаются в большем max_tokens,
  // потому что reasoning-токены тоже считаются. Увеличиваем для них.
  const isReasoningModel = model.includes("gpt-oss") || model.includes("o1") || model.includes("o3");
  const effectiveMaxTokens = isReasoningModel ? Math.max(maxTokens * 3, 8000) : maxTokens;

  let lastError: unknown;
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
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      // Экспоненциальный backoff: 1.5с, 3с.
      const delay = 1500 * attempt;
      console.warn(
        `[llm-client] attempt ${attempt}/${MAX_ATTEMPTS} failed (${err instanceof Error ? err.message : err}); retry in ${delay}ms`,
      );
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("LLM call failed");
}
