import type { LlmCall } from "@/lib/schemas/agent";

export async function callLLM({ messages, temperature = 0.2, maxTokens = 4000 }: LlmCall) {
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

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
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
      max_tokens: effectiveMaxTokens,
      top_p: 0.95,
      presence_penalty: 0,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed for ${model}: ${response.status} ${body}`);
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
    throw new Error(`LLM returned empty content for ${model}.`);
  }
  return content;
}
