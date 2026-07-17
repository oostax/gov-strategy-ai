import type { SessionProfile } from "@/lib/schemas/session";
import type { RegionProfile } from "@/lib/schemas/region";
import type { TypedOutput } from "@/lib/schemas/structured-output";
import { formatRegionContext, selectRelevantPlaybooks } from "@/lib/agents/prompt-builder";
import { formatSberProjectsForPrompt } from "@/lib/storage/sber-projects";
import { getStorage } from "@/lib/storage/local-json-storage";
import { getMemoryClient } from "@/lib/integrations/mempalace-client";
import { logBlockEvent } from "@/lib/agents/region-blocks/logger";
import { canUseAsHistoricalUserInput } from "@/lib/quality/memory-provenance";
import { fallbackMeetingBlocksPlan, planMeetingBlocks } from "./planner";
import { generateMinistryBlock } from "./blocks/ministry";
import { generateDossierBlock } from "./blocks/dossier";
import { generateParticipantsBlock } from "./blocks/participants";
import { generateThesesBlock } from "./blocks/theses";
import { generateObjectionsBlock } from "./blocks/objections";
import { generateSberBlock } from "./blocks/sber";
import { generateAgendaBlock } from "./blocks/agenda";
import { generateAfterBlock } from "./blocks/after";
import {
  MEETING_BLOCK_LABELS,
  MEETING_BLOCK_MODE_DIRECTIVES,
  MEETING_BLOCK_ORDER,
  type MeetingBlockDeps,
  type MeetingBlockKind,
  type MeetingBlockMode,
  type MeetingBlockPlan,
  type MeetingBlockRun,
  type MeetingBlocksPlan,
} from "./types";
import { assembleMeetingBlocks, toTypedMeetingOutput } from "./assembler";
import { synthesizeMeetingHeader } from "./synthesis";
import {
  createMeetingRun,
  readBlockData,
  readMeetingRun,
  structuredErrorPath,
  structuredOutputPath,
  updateBlockState,
  updateRun,
  writeBlockData,
  writeStructuredOutput,
} from "./storage";

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

type BlockGenerator = (deps: MeetingBlockDeps, queries: string[]) => Promise<unknown>;

const BLOCK_GENERATORS: Record<MeetingBlockKind, BlockGenerator> = {
  ministry: generateMinistryBlock as BlockGenerator,
  dossier: generateDossierBlock as BlockGenerator,
  participants: generateParticipantsBlock as BlockGenerator,
  theses: generateThesesBlock as BlockGenerator,
  objections: generateObjectionsBlock as BlockGenerator,
  sber: generateSberBlock as BlockGenerator,
  agenda: generateAgendaBlock as BlockGenerator,
  after: generateAfterBlock as BlockGenerator,
};

/** Таймаут генерации одного блока. Reasoning-модель медленная — держим запас. */
const BLOCK_TIMEOUT_MS = Number(process.env.MEETING_BLOCK_TIMEOUT_MS || 120_000);

function buildWaves(plan: MeetingBlocksPlan): MeetingBlockPlan[][] {
  const waves: MeetingBlockPlan[][] = [];
  const done = new Set<MeetingBlockKind>();
  const present = new Set(plan.blocks.map((b) => b.kind));
  let remaining = [...plan.blocks];

  while (remaining.length > 0) {
    const wave: MeetingBlockPlan[] = [];
    const next: MeetingBlockPlan[] = [];
    for (const block of remaining) {
      // Зависимость учитывается только если она реально в наборе генерации.
      const deps = block.dependsOn.filter((dep) => present.has(dep));
      if (deps.every((dep) => done.has(dep))) wave.push(block);
      else next.push(block);
    }
    if (!wave.length && next.length) wave.push(next.shift() as MeetingBlockPlan);
    waves.push(wave);
    wave.forEach((block) => done.add(block.kind));
    remaining = next;
  }
  return waves;
}

async function collectReadyBlocks(run: MeetingBlockRun) {
  const blocks: Array<{ kind: MeetingBlockKind; data: unknown }> = [];
  for (const kind of MEETING_BLOCK_ORDER) {
    const stored = await readBlockData(run.sessionId, run.runId, kind);
    if (stored?.state.status === "ready" && stored.data) {
      blocks.push({ kind, data: stored.data });
    }
  }
  return blocks;
}

async function loadAgentInstructions(session: SessionProfile) {
  try {
    const playbooks = await getStorage().listPlaybooks();
    const activePlaybooks = selectRelevantPlaybooks(session, playbooks);
    return activePlaybooks
      .map((playbook) =>
        [
          `# ${playbook.name}`,
          playbook.description,
          ...playbook.rules.map((rule) => `- ${rule}`),
        ].join("\n"),
      )
      .join("\n\n");
  } catch (error) {
    console.warn("[meeting-blocks] Failed to load agent instructions:", error);
    return "";
  }
}

async function loadSberProjectsContext(plan: MeetingBlocksPlan, prompt: string) {
  const focus = [plan.focusTopic, plan.ministry, prompt].filter(Boolean).join(" ");
  try {
    const catalog = await getStorage().listSberCatalog();
    return formatSberProjectsForPrompt(focus, plan.region, 8, catalog);
  } catch (error) {
    console.warn("[meeting-blocks] Failed to load Sber catalog:", error);
    return formatSberProjectsForPrompt(focus, plan.region, 8);
  }
}

/**
 * Retrieve only prior USER INPUT. Generated answers, feedback/evolution and
 * distilled model summaries are excluded: they may contain hallucinations and
 * must never be promoted to tier="crm" on a later run.
 */
async function loadMemoryContext(plan: MeetingBlocksPlan, prompt: string): Promise<string> {
  const query = [plan.ministry, plan.lprName, plan.region, plan.focusTopic, prompt]
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!query) return "";
  try {
    const hits = await getMemoryClient().search(query);
    const lines = hits
      .filter((hit) => canUseAsHistoricalUserInput(hit.sourceFile))
      .filter((hit) => hit.excerpt && hit.excerpt.trim().length > 0)
      .slice(0, 4)
      .map((hit) => `- [предыдущий ввод пользователя] ${hit.excerpt.replace(/\s+/g, " ").trim().slice(0, 400)}`);
    return lines.length ? lines.join("\n") : "";
  } catch (error) {
    console.warn(`[meeting-blocks] MemPalace retrieve skipped: ${error instanceof Error ? error.message : error}`);
    return "";
  }
}

/**
 * CRM-контекст берём только из явно заполненного портфельного слоя карточки
 * региона. Автосинхронизированное отношение stakeholder не используем.
 */
function buildTrustedCrmContext(region: RegionProfile | null): string {
  if (!region) return "";
  const lines: string[] = [];
  if (region.keyAccountManager?.trim()) lines.push(`Key-account: ${region.keyAccountManager.trim()}`);
  if (region.relationshipManager?.trim()) lines.push(`RM госсектора: ${region.relationshipManager.trim()}`);
  for (const project of region.activeProjects ?? []) {
    lines.push(`Проект Сбера: ${project.product} — ${project.title}; стадия=${project.stage}${project.notes ? `; ${project.notes}` : ""}`);
  }
  for (const engagement of region.pastEngagements ?? []) {
    lines.push(`История взаимодействия: ${engagement.topic}; исход=${engagement.outcome}${engagement.reason ? `; причина=${engagement.reason}` : ""}`);
  }
  if (region.sberNote?.trim()) lines.push(`Подтверждённая заметка карточки: ${region.sberNote.trim()}`);
  return lines.slice(0, 8).join("\n");
}

/**
 * Persist: сохраняем компактные факты встречи (ведомство, цель, ключевые факты
 * портрета, оффер, целевая договорённость) — чтобы будущие встречи с этим
 * ведомством подтягивали накопленный контекст. Best-effort.
 */
function buildMeetingFacts(plan: MeetingBlocksPlan, output: TypedOutput): string {
  const data = output.kind === "meeting" ? output.data : undefined;
  const parts: string[] = [
    `Встреча (${new Date().toISOString().slice(0, 10)}): регион=${plan.region}; ведомство=${plan.ministry || "—"}; ЛПР=${plan.lprName || plan.lprRole || "—"}.`,
  ];
  if (data) {
    if (data.meetingGoal) parts.push(`Цель: ${String(data.meetingGoal).slice(0, 300)}`);
    const portrait = data.ministryPortrait;
    if (portrait && Array.isArray(portrait.stats)) {
      const stats = portrait.stats
        .map((s) => (s && typeof s === "object" ? `${s.label ?? ""}: ${s.value ?? ""}` : ""))
        .filter((s) => s.trim().length > 2)
        .slice(0, 4);
      if (stats.length) parts.push(`Факты ведомства: ${stats.join("; ")}`);
    }
    if (data.proposal) parts.push(`Оффер Сбера: ${String(data.proposal).slice(0, 300)}`);
    if (data.askLadder?.target) parts.push(`Целевая договорённость: ${String(data.askLadder.target).slice(0, 200)}`);
  }
  return parts.join("\n");
}

async function persistMeetingFacts(sessionId: string, plan: MeetingBlocksPlan, output: TypedOutput) {
  try {
    await getMemoryClient().rememberFacts(sessionId, buildMeetingFacts(plan, output), "meeting_facts");
  } catch (error) {
    console.warn(`[meeting-blocks] MemPalace persist skipped: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Собирает базовый набор deps встречи (без priorBlocks). Вынесено, чтобы полная
 * генерация (continueMeetingBlocks) и правка одного блока (regenerateMeetingBlock)
 * строили ОДИНАКОВЫЙ контекст: region/ministry/lprName/focusTopic/agentInstructions/
 * regionContext/sberProjectsContext/memoryContext/trustedCrmContext.
 */
async function buildBaseMeetingDeps(
  session: SessionProfile,
  region: RegionProfile | null,
  plan: MeetingBlocksPlan,
  runId: string,
  prompt: string,
): Promise<MeetingBlockDeps> {
  return {
    session,
    runId,
    region: plan.region,
    ministry: plan.ministry,
    lprName: plan.lprName,
    lprRole: plan.lprRole,
    focusTopic: [plan.focusTopic, prompt].filter(Boolean).join(" ").trim(),
    agentInstructions: await loadAgentInstructions(session),
    regionContext: formatRegionContext(region, { includeSberPortfolio: true }),
    sberProjectsContext: await loadSberProjectsContext(plan, prompt),
    memoryContext: await loadMemoryContext(plan, prompt),
    trustedCrmContext: buildTrustedCrmContext(region),
  };
}

/**
 * Финальная сборка прогона: assemble → синтез шапки (некритичный, по таймауту) →
 * мягкий гейт готовности (toTypedMeetingOutput) → запись structured output →
 * очистка error → persist фактов → статус ready. Используется и полной генерацией,
 * и правкой одного блока — чтобы quality gate/логи/фолбэки были идентичны.
 */
async function finalizeMeetingRun(
  session: SessionProfile,
  region: RegionProfile | null,
  plan: MeetingBlocksPlan,
  initialRun: MeetingBlockRun,
  generationStartedAt: number,
): Promise<{ output: TypedOutput; run: MeetingBlockRun }> {
  let run = (await readMeetingRun(initialRun.sessionId, initialRun.runId)) || initialRun;
  run = await updateRun(run, { status: "assembling" });
  const blocks = await collectReadyBlocks(run);
  const assembled = assembleMeetingBlocks({ session, blocks });
  if (plan.sectionOrder?.length) assembled.sectionOrder = plan.sectionOrder;

  // Синтез — обогащающий слой, некритичный. Ограничиваем по времени.
  try {
    const synthesisTimeoutMs = Number(process.env.MEETING_SYNTHESIS_TIMEOUT_MS || 60_000);
    const header = await withTimeout(
      synthesizeMeetingHeader(assembled),
      synthesisTimeoutMs,
      `Synthesis timeout after ${synthesisTimeoutMs}ms`,
    );
    if (header.mainThesis) assembled.mainThesis = header.mainThesis;
    // Гуард 10d4806: синтез НЕ перезаписывает цель встречи, заданную пользователем.
    if (header.meetingGoal && !session.meetingGoal?.trim()) {
      assembled.meetingGoal = header.meetingGoal;
    }
    if (header.proposal && !assembled.proposal) assembled.proposal = header.proposal;
  } catch (err) {
    console.warn("[meeting-blocks][synthesis] skipped", err);
  }

  let output: TypedOutput;
  try {
    // Мягкий гейт готовности внутри toTypedMeetingOutput.
    output = toTypedMeetingOutput(assembled, session.taskType);
    await writeStructuredOutput(session.id, output);
  } catch (assemblyError) {
    const message = assemblyError instanceof Error ? assemblyError.message : String(assemblyError);
    console.error(`[meeting-blocks][assemble] finalize failed: ${message}`);
    run = await updateRun(run, { status: "error", error: { message } });
    await logBlockEvent({
      sessionId: session.id,
      runId: run.runId,
      scope: "meeting.assemble",
      message: "failed",
      data: { error: message },
    });
    throw assemblyError;
  }

  try {
    const fs = await import("fs/promises");
    await fs.unlink(structuredErrorPath(session.id));
  } catch {}

  // Persist в MemPalace: компактные факты встречи для будущих сессий (best-effort).
  await persistMeetingFacts(session.id, plan, output);

  run = await updateRun(run, {
    status: "ready",
    completedAt: new Date().toISOString(),
    outputPath: structuredOutputPath(session.id),
  });
  console.log(
    `[meeting-blocks][assemble] ready total=${elapsedMs(generationStartedAt)} blocks=${blocks.length}`,
  );
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "meeting.assemble",
    message: "ready",
    data: { totalElapsedMs: Date.now() - generationStartedAt, blocks: blocks.length },
  });

  return { output, run };
}

async function continueMeetingBlocks(
  session: SessionProfile,
  region: RegionProfile | null,
  plan: MeetingBlocksPlan,
  initialRun: MeetingBlockRun,
  prompt = "",
): Promise<{ output: TypedOutput; run: MeetingBlockRun }> {
  const generationStartedAt = Date.now();
  let run = initialRun;
  run = await updateRun(run, { status: "generating" });
  console.log(
    `[meeting-blocks][run] start session=${session.id} run=${run.runId} region="${plan.region}" ministry="${plan.ministry}" blocks=${plan.blocks.length}`,
  );
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "meeting.run",
    message: "start",
    data: { region: plan.region, ministry: plan.ministry, blocks: plan.blocks.length },
  });

  const baseDeps: MeetingBlockDeps = await buildBaseMeetingDeps(
    session,
    region,
    plan,
    run.runId,
    prompt,
  );
  if (baseDeps.memoryContext) {
    console.log(`[meeting-blocks][memory] retrieved ${baseDeps.memoryContext.split("\n").length} prior context lines`);
  }

  const waves = buildWaves(plan);
  for (let waveIndex = 0; waveIndex < waves.length; waveIndex++) {
    const wave = waves[waveIndex];
    const waveStartedAt = Date.now();
    console.log(
      `[meeting-blocks][wave] start ${waveIndex + 1}/${waves.length}: ${wave.map((b) => b.kind).join(", ")}`,
    );

    let priorBlocks: Array<{ kind: MeetingBlockKind; data: unknown }> = [];
    try {
      priorBlocks = await collectReadyBlocks(run);
    } catch {
      priorBlocks = [];
    }
    const waveDeps: MeetingBlockDeps = { ...baseDeps, priorBlocks };
    const baseRun = run;

    // Per-block allSettled: падение одного блока не роняет всю волну.
    await Promise.allSettled(
      wave.map(async (blockPlan) => {
        const blockStartedAtMs = Date.now();
        const startedAt = new Date().toISOString();
        await updateBlockState(baseRun, blockPlan.kind, {
          status: "searching",
          startedAt,
          error: undefined,
        });
        const generator = BLOCK_GENERATORS[blockPlan.kind];
        if (!generator) {
          await writeBlockData(baseRun, blockPlan.kind, {
            kind: blockPlan.kind,
            status: "failed",
            error: `No generator for ${blockPlan.kind}`,
            startedAt,
          });
          return;
        }
        try {
          await updateBlockState(baseRun, blockPlan.kind, { status: "generating", startedAt });
          const data = await withTimeout(
            generator(waveDeps, blockPlan.searchQueries),
            BLOCK_TIMEOUT_MS,
            `Block ${blockPlan.kind} timeout after ${BLOCK_TIMEOUT_MS}ms`,
          );
          await writeBlockData(
            baseRun,
            blockPlan.kind,
            { kind: blockPlan.kind, status: "ready", startedAt, completedAt: new Date().toISOString() },
            data,
          );
          console.log(`[meeting-blocks][block] ${blockPlan.kind} ready in ${elapsedMs(blockStartedAtMs)}`);
          await logBlockEvent({
            sessionId: session.id,
            runId: baseRun.runId,
            scope: "meeting.block",
            message: "ready",
            data: { kind: blockPlan.kind, elapsedMs: Date.now() - blockStartedAtMs },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[meeting-blocks][block] ${blockPlan.kind} failed in ${elapsedMs(blockStartedAtMs)}: ${message}`);
          await logBlockEvent({
            sessionId: session.id,
            runId: baseRun.runId,
            scope: "meeting.block",
            message: "failed",
            data: { kind: blockPlan.kind, error: message },
          });
          await writeBlockData(baseRun, blockPlan.kind, {
            kind: blockPlan.kind,
            status: "failed",
            startedAt,
            completedAt: new Date().toISOString(),
            error: message,
          });
        }
      }),
    );

    run = (await readMeetingRun(run.sessionId, run.runId)) || run;
    console.log(
      `[meeting-blocks][wave] done ${waveIndex + 1}/${waves.length} in ${elapsedMs(waveStartedAt)} ready=${run.blocks.filter((b) => b.status === "ready").length}/${run.blocks.length}`,
    );
  }

  // ── Сборка ──────────────────────────────────────────────────────────────────
  return finalizeMeetingRun(session, region, plan, run, generationStartedAt);
}

/**
 * Волна 8.5 — правка ОДНОГО готового блока встречи по кнопке.
 * Перезапускает генератор только указанного блока с теми же deps и priorBlocks,
 * что и оркестратор (region/ministry/lprName/focusTopic/agentInstructions/
 * regionContext/sberProjectsContext/memoryContext/trustedCrmContext), затем
 * ПЕРЕСОБИРАЕТ output (assemble + synthesis + quality gate + запись), не трогая
 * остальные блоки. mode добавляет в промпт блока директиву объёма/перепроверки.
 *
 * Соблюдает существующие таймауты (BLOCK_TIMEOUT_MS), логи и мягкий гейт
 * готовности. Прогон должен существовать и содержать этот блок в плане.
 */
export async function regenerateMeetingBlock(
  session: SessionProfile,
  region: RegionProfile | null,
  run: MeetingBlockRun,
  blockKind: MeetingBlockKind,
  mode: MeetingBlockMode = "rebuild",
): Promise<{ output: TypedOutput; run: MeetingBlockRun }> {
  const startedAtMs = Date.now();
  const plan = run.plan;
  const prompt = run.prompt ?? "";

  const generator = BLOCK_GENERATORS[blockKind];
  if (!generator) {
    throw new Error(`No generator for ${blockKind}`);
  }
  // Блок должен быть частью плана этого прогона (иначе нечего пересобирать).
  const planned = plan.blocks.find((b) => b.kind === blockKind);
  if (!planned) {
    throw new Error(`Block ${blockKind} is not part of run ${run.runId}`);
  }

  console.log(
    `[meeting-blocks][edit] start session=${session.id} run=${run.runId} block=${blockKind} mode=${mode}`,
  );
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "meeting.block",
    message: "edit_start",
    data: { kind: blockKind, mode },
  });

  let current = await updateRun(run, { status: "generating", error: undefined });

  // Те же deps, что и в полной генерации; priorBlocks — из уже готовых блоков.
  const baseDeps = await buildBaseMeetingDeps(session, region, plan, current.runId, prompt);
  let priorBlocks: Array<{ kind: MeetingBlockKind; data: unknown }> = [];
  try {
    priorBlocks = (await collectReadyBlocks(current)).filter((b) => b.kind !== blockKind);
  } catch {
    priorBlocks = [];
  }
  const modeDirective =
    mode === "rebuild" ? undefined : MEETING_BLOCK_MODE_DIRECTIVES[mode];
  const deps: MeetingBlockDeps = { ...baseDeps, priorBlocks, modeDirective };

  const startedAt = new Date().toISOString();
  await updateBlockState(current, blockKind, {
    status: "generating",
    startedAt,
    error: undefined,
  });

  try {
    const data = await withTimeout(
      generator(deps, planned.searchQueries),
      BLOCK_TIMEOUT_MS,
      `Block ${blockKind} timeout after ${BLOCK_TIMEOUT_MS}ms`,
    );
    await writeBlockData(
      current,
      blockKind,
      { kind: blockKind, status: "ready", startedAt, completedAt: new Date().toISOString() },
      data,
    );
    console.log(`[meeting-blocks][edit] ${blockKind} regenerated in ${elapsedMs(startedAtMs)}`);
    await logBlockEvent({
      sessionId: session.id,
      runId: current.runId,
      scope: "meeting.block",
      message: "edit_ready",
      data: { kind: blockKind, mode, elapsedMs: Date.now() - startedAtMs },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[meeting-blocks][edit] ${blockKind} failed in ${elapsedMs(startedAtMs)}: ${message}`);
    await logBlockEvent({
      sessionId: session.id,
      runId: current.runId,
      scope: "meeting.block",
      message: "edit_failed",
      data: { kind: blockKind, mode, error: message },
    });
    // Не затираем прежний готовый блок при сбое правки: помечаем статус блока,
    // но оставляем его data. Прогон возвращаем в ready — материал остаётся прежним.
    await updateBlockState(current, blockKind, {
      status: "ready",
      completedAt: new Date().toISOString(),
      error: message,
    });
    current = await updateRun(current, { status: "ready" });
    throw error;
  }

  // Пересборка полного output из блоков (изменён только один блок).
  current = (await readMeetingRun(current.sessionId, current.runId)) || current;
  return finalizeMeetingRun(session, region, plan, current, startedAtMs);
}

export async function startMeetingBlocks(
  session: SessionProfile,
  region: RegionProfile | null,
  prompt = "",
): Promise<{ run: MeetingBlockRun; promise: Promise<{ output: TypedOutput; run: MeetingBlockRun }> }> {
  const planStartedAt = Date.now();
  console.log(`[meeting-blocks][plan] start session=${session.id}`);
  const plannerTimeoutMs = Number(process.env.MEETING_PLANNER_TIMEOUT_MS || 45_000);
  let plan: MeetingBlocksPlan;
  let planMode: "llm" | "fallback" = "llm";
  try {
    plan = await withTimeout(
      planMeetingBlocks(session, region),
      plannerTimeoutMs,
      `Planner timeout after ${plannerTimeoutMs}ms`,
    );
  } catch (error) {
    planMode = "fallback";
    console.warn(`[meeting-blocks][plan] fallback: ${error instanceof Error ? error.message : error}`);
    plan = fallbackMeetingBlocksPlan(session, region);
  }
  console.log(
    `[meeting-blocks][plan] done in ${elapsedMs(planStartedAt)} mode=${planMode} blocks=${plan.blocks.length}`,
  );
  const run = await createMeetingRun({ session, plan, prompt });
  await logBlockEvent({
    sessionId: session.id,
    runId: run.runId,
    scope: "meeting.plan",
    message: "ready",
    data: {
      elapsedMs: Date.now() - planStartedAt,
      mode: planMode,
      region: plan.region,
      ministry: plan.ministry,
      blocks: plan.blocks.map((b) => ({ kind: b.kind, hidden: b.hidden, queries: b.searchQueries })),
    },
  });
  return {
    run,
    promise: continueMeetingBlocks(session, region, plan, run, prompt),
  };
}

export async function getMeetingBlocksState(sessionId: string, runId?: string) {
  const run = await readMeetingRun(sessionId, runId);
  if (!run) return null;
  const readyBlocks: Array<{ kind: MeetingBlockKind; data: unknown }> = [];
  for (const kind of MEETING_BLOCK_ORDER) {
    const stored = await readBlockData(sessionId, run.runId, kind);
    if (stored?.state.status === "ready" && stored.data) {
      readyBlocks.push({ kind, data: stored.data });
    }
  }
  return { ...run, readyBlocks, labels: MEETING_BLOCK_LABELS };
}
