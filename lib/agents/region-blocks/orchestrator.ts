import type { SessionProfile } from "@/lib/schemas/session";
import type { RegionProfile } from "@/lib/schemas/region";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import { formatRegionContext, selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { formatSberProjectsForPrompt } from "@/lib/storage/sber-projects";
import { getStorage } from "@/lib/storage/local-json-storage";
import { fallbackRegionBlocksPlan, planRegionBlocks } from "./planner";
import { generateSummaryBlock } from "./blocks/summary";
import { generateBudgetBlock } from "./blocks/budget";
import { generateIndustriesBlock } from "./blocks/industries";
import { generatePrioritiesBlock } from "./blocks/priorities";
import { generateScenariosBlock } from "./blocks/scenarios";
import { generateCompetitionBlock } from "./blocks/competition";
import { generateStakeholdersBlock } from "./blocks/stakeholders";
import {
  BLOCK_LABELS,
  BLOCK_ORDER,
  type BlockKind,
  type BlockPlan,
  type BlockRun,
  type BlockDeps,
  type RegionBlocksPlan,
} from "./types";
import {
  assembleRegionBlocks,
  toTypedRegionOutput,
} from "./assembler";
import {
  createBlockRun,
  readBlockData,
  readBlockRun,
  structuredOutputPath,
  structuredErrorPath,
  updateBlockState,
  updateRun,
  writeBlockData,
  writeStructuredOutput,
} from "./storage";
import { logBlockEvent } from "./logger";
import { guardRegionOutput } from "@/lib/agents/fact-guard";
import { synthesizeRegionInsights } from "./synthesis";

function elapsedMs(startedAt: number) {
  return `${Date.now() - startedAt}ms`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

type BlockGenerator = (deps: BlockDeps, queries: string[]) => Promise<unknown>;

const BLOCK_GENERATORS: Record<BlockKind, BlockGenerator> = {
  summary: generateSummaryBlock as BlockGenerator,
  budget: generateBudgetBlock as BlockGenerator,
  industries: generateIndustriesBlock as BlockGenerator,
  priorities: generatePrioritiesBlock as BlockGenerator,
  scenarios: generateScenariosBlock as BlockGenerator,
  competition: generateCompetitionBlock as BlockGenerator,
  stakeholders: generateStakeholdersBlock as BlockGenerator,
};

function buildWaves(plan: RegionBlocksPlan): BlockPlan[][] {
  const waves: BlockPlan[][] = [];
  const done = new Set<BlockKind>();
  let remaining = [...plan.blocks];

  while (remaining.length > 0) {
    const wave: BlockPlan[] = [];
    const next: BlockPlan[] = [];

    for (const block of remaining) {
      if (block.dependsOn.every((dep) => done.has(dep))) wave.push(block);
      else next.push(block);
    }

    if (!wave.length && next.length) wave.push(next.shift() as BlockPlan);
    waves.push(wave);
    wave.forEach((block) => done.add(block.kind));
    remaining = next;
  }

  return waves;
}

async function collectReadyBlocks(run: BlockRun) {
  const blocks: Array<{ kind: BlockKind; data: unknown }> = [];
  for (const kind of BLOCK_ORDER) {
    const stored = await readBlockData(run.sessionId, run.runId, kind);
    if (stored?.state.status === "ready" && stored.data) {
      blocks.push({ kind, data: stored.data });
    }
  }
  return blocks;
}

function failedBlocks(run: BlockRun) {
  return run.blocks.filter((block) => block.status === "failed");
}

async function loadAgentInstructions(session: SessionProfile) {
  try {
    const playbooks = await getStorage().listPlaybooks();
    const activePlaybooks = selectRelevantPlaybooks(session, playbooks);
    return activePlaybooks
      .map((playbook) => [
        `# ${playbook.name}`,
        playbook.description,
        ...playbook.rules.map((rule) => `- ${rule}`),
      ].join("\n"))
      .join("\n\n");
  } catch (error) {
    console.warn("[blocks] Failed to load agent instructions:", error);
    return "";
  }
}

async function loadSberProjectsContext(session: SessionProfile, plan: RegionBlocksPlan, prompt: string) {
  if (session.taskType !== "sber_region_strategy") return "";
  const focus = [plan.focusTopic, prompt].filter(Boolean).join(" ");
  try {
    const catalog = await getStorage().listSberCatalog();
    return formatSberProjectsForPrompt(focus, plan.region, 8, catalog);
  } catch (error) {
    console.warn("[blocks] Failed to load Sber catalog:", error);
    return formatSberProjectsForPrompt(focus, plan.region, 8);
  }
}

async function continueBlocksGeneration(
  session: SessionProfile,
  region: RegionProfile | null,
  plan: RegionBlocksPlan,
  initialRun: BlockRun,
  prompt = "",
): Promise<{ output: TypedOutput; run: BlockRun }> {
  const generationStartedAt = Date.now();
  let run = initialRun;
  run = await updateRun(run, { status: "generating" });
  console.log(
    `[blocks][run] start session=${session.id} run=${run.runId} region="${plan.region}" blocks=${plan.blocks.length}`,
  );
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "blocks.run",
    message: "start",
    data: { region: plan.region, blocks: plan.blocks.length },
  });

  const deps: BlockDeps = {
    session,
    runId: run.runId,
    region: plan.region,
    focusTopic: [plan.focusTopic, prompt].filter(Boolean).join(" ").trim(),
    agentInstructions: await loadAgentInstructions(session),
    regionContext: formatRegionContext(region, {
      includeSberPortfolio: session.taskType === "sber_region_strategy",
    }),
    sberProjectsContext: await loadSberProjectsContext(session, plan, prompt),
  };
  console.log(
    `[blocks][run] instructions chars=${deps.agentInstructions?.length || 0} regionContext=${deps.regionContext?.length || 0} sberProjects=${deps.sberProjectsContext?.length || 0} refinement=${process.env.BLOCK_REFINEMENT_MODE || "off"}`,
  );
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "blocks.run",
    message: "instructions_loaded",
    data: {
      chars: deps.agentInstructions?.length || 0,
      regionContextChars: deps.regionContext?.length || 0,
      sberProjectsChars: deps.sberProjectsContext?.length || 0,
      refinement: process.env.BLOCK_REFINEMENT_MODE || "off",
    },
  });

  const waves = buildWaves(plan);
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave = waves[waveIndex];
    const waveStartedAt = Date.now();
    console.log(
      `[blocks][wave] start ${waveIndex + 1}/${waves.length}: ${wave.map((block) => block.kind).join(", ")}`,
    );
    await logBlockEvent({
      sessionId: session.id,
      runId: run.runId,
      scope: "blocks.wave",
      message: "start",
      data: { index: waveIndex + 1, total: waves.length, blocks: wave.map((block) => block.kind) },
    });

    let priorBlocks: Array<{ kind: BlockKind; data: unknown }> = [];
    try {
      priorBlocks = await collectReadyBlocks(run);
    } catch { priorBlocks = []; }
    const waveDeps: BlockDeps = { ...deps, priorBlocks };

    const baseRun = run;
    const blockResults = await Promise.allSettled(
      wave.map(async (blockPlan) => {
        const blockStartedAtMs = Date.now();
        const startedAt = new Date().toISOString();
        console.log(
          `[blocks][block] ${blockPlan.kind} start queries=${blockPlan.searchQueries.length}`,
        );
        await logBlockEvent({
          sessionId: session.id,
          runId: baseRun.runId,
          scope: "blocks.block",
          message: "start",
          data: { kind: blockPlan.kind, queries: blockPlan.searchQueries },
        });
        await updateBlockState(baseRun, blockPlan.kind, {
          status: "searching",
          startedAt,
          error: undefined,
        });

        const generator = BLOCK_GENERATORS[blockPlan.kind];
        if (!generator) {
          await writeBlockData(baseRun, blockPlan.kind, {
            status: "failed",
            error: `No generator for ${blockPlan.kind}`,
            startedAt,
          });
          throw new Error(`No generator for ${blockPlan.kind}`);
        }

        try {
          await updateBlockState(baseRun, blockPlan.kind, {
            status: "generating",
            startedAt,
          });
          const data = await generator(waveDeps, blockPlan.searchQueries);
          await writeBlockData(baseRun, blockPlan.kind, {
            kind: blockPlan.kind,
            status: "ready",
            startedAt,
            completedAt: new Date().toISOString(),
          }, data);
          console.log(`[blocks][block] ${blockPlan.kind} ready in ${elapsedMs(blockStartedAtMs)}`);
          await logBlockEvent({
            sessionId: session.id,
            runId: baseRun.runId,
            scope: "blocks.block",
            message: "ready",
            data: { kind: blockPlan.kind, elapsedMs: Date.now() - blockStartedAtMs },
          });
        } catch (error) {
          console.error(
            `[blocks][block] ${blockPlan.kind} failed in ${elapsedMs(blockStartedAtMs)}:`,
            error,
          );
          await logBlockEvent({
            sessionId: session.id,
            runId: baseRun.runId,
            scope: "blocks.block",
            message: "failed",
            data: {
              kind: blockPlan.kind,
              elapsedMs: Date.now() - blockStartedAtMs,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          await writeBlockData(baseRun, blockPlan.kind, {
            kind: blockPlan.kind,
            status: "failed",
            startedAt,
            completedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }),
    );

    const firstRejection = blockResults.find(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (firstRejection) {
      const reason = firstRejection.reason instanceof Error
        ? firstRejection.reason.message
        : String(firstRejection.reason);
      run = await readBlockRun(baseRun.sessionId, baseRun.runId) || baseRun;
      const failedBlock = run.blocks.find((b) => b.status === "failed");
      if (failedBlock) {
        run = await updateRun(run, {
          status: "error",
          error: {
            message: failedBlock.error || reason,
            blockKind: failedBlock.kind,
          },
        });
        throw new Error(`${BLOCK_LABELS[failedBlock.kind]}: ${failedBlock.error || "block failed"}`);
      }
    }

    run = await readBlockRun(run.sessionId, run.runId) || run;
    console.log(
      `[blocks][wave] done ${waveIndex + 1}/${waves.length} in ${elapsedMs(waveStartedAt)} ready=${run.blocks.filter((block) => block.status === "ready").length}/${run.blocks.length}`,
    );
    await logBlockEvent({
      sessionId: session.id,
      runId: run.runId,
      scope: "blocks.wave",
      message: "done",
      data: {
        index: waveIndex + 1,
        elapsedMs: Date.now() - waveStartedAt,
        ready: run.blocks.filter((block) => block.status === "ready").length,
        total: run.blocks.length,
      },
    });
    const failed = failedBlocks(run);
    if (failed.length) {
      const first = failed[0];
      run = await updateRun(run, {
        status: "error",
        error: {
          message: first.error || `Block failed: ${first.kind}`,
          blockKind: first.kind,
        },
      });
      throw new Error(`${BLOCK_LABELS[first.kind]}: ${first.error || "block failed"}`);
    }
  }

  const assembleStartedAt = Date.now();
  console.log(`[blocks][assemble] start session=${session.id} run=${run.runId}`);
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "blocks.assemble",
    message: "start",
  });
  run = await readBlockRun(run.sessionId, run.runId) || run;
  const notReady = run.blocks.filter((block) => block.status !== "ready");
  if (notReady.length) {
    const message = `Cannot assemble: not ready blocks ${notReady.map((block) => `${block.kind}:${block.status}`).join(", ")}`;
    run = await updateRun(run, {
      status: "error",
      error: { message },
    });
    console.error(`[blocks][assemble] ${message}`);
    await logBlockEvent({
      sessionId: session.id,
      runId: run.runId,
      scope: "blocks.assemble",
      message: "failed",
      data: { error: message },
    });
    throw new Error(message);
  }
  run = await updateRun(run, { status: "assembling" });
  const blocks = await collectReadyBlocks(run);
  const assembled = assembleRegionBlocks({ regionName: plan.region, blocks });
  // Адаптивная композиция: тип региона, фокус и порядок блоков — из плана в вывод.
  if (plan.archetype) assembled.regionArchetype = plan.archetype;
  if (plan.focusAngle) assembled.focusAngle = plan.focusAngle;
  if (plan.sectionOrder?.length) assembled.sectionOrder = plan.sectionOrder;
  // Синтез — обогащающий слой, но не критичный. Ограничиваем по времени, чтобы
  // медленная/перегруженная модель не блокировала завершение генерации на минуты.
  try {
    const synthesisTimeoutMs = Number(process.env.BLOCK_SYNTHESIS_TIMEOUT_MS || 60_000);
    const insights = await withTimeout(
      synthesizeRegionInsights(assembled),
      synthesisTimeoutMs,
      `Synthesis timeout after ${synthesisTimeoutMs}ms`,
    );
    if (insights.coreThesis) assembled.coreThesis = insights.coreThesis;
    if (insights.claims?.length) assembled.claims = insights.claims;
    if (insights.strategyRealityGap?.length) assembled.strategyRealityGap = insights.strategyRealityGap;
  } catch (err) {
    console.warn("[blocks][synthesis] skipped", err);
  }
  // Привязка «факт → источник → уверенность»: числам бюджета/сценариев/приоритетов
  // проставляем источник из собранных материалов, неподтверждённое уводим в dataGaps.
  // Сборку оборачиваем: любой сбой здесь должен явно перевести прогон в error,
  // иначе статус остаётся "assembling" и клиент вечно видит "generating".
  let output: TypedOutput;
  try {
    const guardEvidence = (assembled.sources ?? []).map((s) => ({
      title: s.title,
      url: s.url ?? "",
      snippet: s.excerpt ?? null,
    }));
    const guarded = guardRegionOutput(assembled, guardEvidence);
    output = toTypedRegionOutput(guarded);
    await writeStructuredOutput(session.id, output);
  } catch (assemblyError) {
    const message = assemblyError instanceof Error ? assemblyError.message : String(assemblyError);
    console.error(`[blocks][assemble] finalize failed: ${message}`);
    run = await updateRun(run, { status: "error", error: { message } });
    await logBlockEvent({
      sessionId: session.id,
      runId: run.runId,
      scope: "blocks.assemble",
      message: "failed",
      data: { error: message },
    });
    throw assemblyError;
  }
  try {
    const fs = await import("fs/promises");
    await fs.unlink(structuredErrorPath(session.id));
  } catch {}
  run = await updateRun(run, {
    status: "ready",
    completedAt: new Date().toISOString(),
    outputPath: structuredOutputPath(session.id),
  });
  console.log(
    `[blocks][assemble] ready in ${elapsedMs(assembleStartedAt)} total=${elapsedMs(generationStartedAt)}`,
  );
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "blocks.assemble",
    message: "ready",
    data: {
      elapsedMs: Date.now() - assembleStartedAt,
      totalElapsedMs: Date.now() - generationStartedAt,
    },
  });

  return { output, run };
}

export async function startBlocksGeneration(
  session: SessionProfile,
  region: RegionProfile | null,
  prompt = "",
): Promise<{ run: BlockRun; promise: Promise<{ output: TypedOutput; run: BlockRun }> }> {
  const planStartedAt = Date.now();
  console.log(`[blocks][plan] start session=${session.id}`);
  // Планировщик теперь отвечает и за адаптивную композицию (archetype/focusAngle/
  // sectionOrder). У reasoning-моделей (gpt-oss) ответ дольше — иначе частый фолбэк
  // без архетипа. 45с достаточно; при таймауте деградируем к дефолтному составу.
  const plannerTimeoutMs = Number(process.env.BLOCK_PLANNER_TIMEOUT_MS || 45_000);
  let plan: RegionBlocksPlan;
  let planMode: "llm" | "fallback" = "llm";
  try {
    plan = await withTimeout(
      planRegionBlocks(session, region),
      plannerTimeoutMs,
      `Planner timeout after ${plannerTimeoutMs}ms`,
    );
  } catch (error) {
    planMode = "fallback";
    console.warn(`[blocks][plan] fallback: ${error instanceof Error ? error.message : error}`);
    plan = fallbackRegionBlocksPlan(session, region);
  }
  console.log(
    `[blocks][plan] done in ${elapsedMs(planStartedAt)} mode=${planMode} blocks=${plan.blocks.length}`,
  );
  const run = await createBlockRun({ session, plan, prompt });
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "blocks.plan",
    message: "ready",
    data: {
      elapsedMs: Date.now() - planStartedAt,
      mode: planMode,
      region: plan.region,
      blocks: plan.blocks.map((block) => ({
        kind: block.kind,
        queries: block.searchQueries,
      })),
    },
  });
  return {
    run,
    promise: continueBlocksGeneration(session, region, plan, run, prompt),
  };
}

export async function runBlocksGeneration(
  session: SessionProfile,
  region: RegionProfile | null,
  prompt = "",
): Promise<{ output: TypedOutput; run: BlockRun }> {
  const { promise } = await startBlocksGeneration(session, region, prompt);
  return promise;
}

export async function getBlocksState(sessionId: string, runId?: string) {
  const run = await readBlockRun(sessionId, runId);
  if (!run) return null;
  const readyBlocks: Array<{ kind: BlockKind; data: unknown }> = [];

  for (const kind of BLOCK_ORDER) {
    const stored = await readBlockData(sessionId, run.runId, kind);
    if (stored?.state.status === "ready" && stored.data) {
      readyBlocks.push({ kind, data: stored.data });
    }
  }

  return {
    ...run,
    readyBlocks,
  };
}
