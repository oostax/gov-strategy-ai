# Region Analysis — Working Notes

> Status: analysis captured for later. No code changes pending. The dashboard
> component (`components/strategy/structured/region-dashboard.tsx`) is restored
> to its committed baseline (commit `217d544`, 466 lines).

## 1. Reference briefing structure (the target)

The Kuban-style regional briefing we are trying to reproduce is organized as a
top-down decision document, roughly:

1. **Executive snapshot** — region, period, who the briefing is for, headline read.
2. **Situational picture** — key macro/sector indicators with light trend signals.
3. **Priorities & objectives** — what the region is trying to achieve.
4. **Sber entry angle ("Заход Сбера")** — decision-makers, competitors, entry points.
   (Already collapsed into its own section in the current component.)
5. **Opportunities / proposed bets** — matched to region priorities.
6. **Risks & data gaps** — what is uncertain or missing, shown muted rather than hidden.
7. **Next steps** — concrete, owner-able actions.

## 2. Gap map — reference deck vs. current `RegionAnalysisOutput`

This compares what the reference briefing contains against the current schema in
`lib/schemas/structured-output.ts`. **Verify each row against the actual schema
before acting on it** — these notes predate the file restoration and were not
re-confirmed.

| Briefing element | Likely schema field | Status / note |
| --- | --- | --- |
| Executive snapshot | `summary` / header fields | Confirm field names against schema |
| Situational indicators | `metrics[]` | Check whether trend/direction is modeled |
| Priorities & objectives | `priorities[]` (?) | Existence unconfirmed — verify |
| Sber entry angle | sales sub-fields (ЛПР, конкуренты, точки входа) | Present; already grouped in UI |
| Opportunities / bets | `bets[]` / `opportunities[]` | Confirm naming; check link to priorities |
| Risks | `risks[]` | Present |
| Data gaps | `dataGaps[]` (?) | Was the source of the earlier corruption — verify it exists |
| Next steps | `nextSteps[]` | Present |

## 3. Prompt / contract direction

- The region-analysis mode prompt lives in `lib/prompts/region-analysis-mode.ts`;
  the structured contract in `lib/prompts/structured-contract.ts`. Any new section
  the UI renders must be backed by both a schema field **and** a contract instruction,
  otherwise the model will not populate it reliably.
- Direction discussed earlier: make the output map 1:1 onto the briefing structure above, so each section has a clear home rather than being improvised at render time.
- Keep risks and data gaps visually muted (lower contrast) rather than omitted, so the briefing reads as honest about uncertainty.

## 4. What NOT to repeat next session

- The dashboard file is **466 lines**, not 732. Earlier "verified line" claims about
  this file were unreliable and led to overwriting it with a placeholder. Trust git
  and a fresh re-read, not prior notes.
- Before any edit: re-read the actual file and the schema, then make one small change
  and verify the tooling executed before scaling up.

## 5. Recommended next steps (when resuming code work)

1. Re-read `region-dashboard.tsx` and `lib/schemas/structured-output.ts` fresh.
2. Confirm the gap-map table above row by row against the real schema.
3. For any missing section, add the schema field + contract instruction first, UI last.
4. Make incremental, verified edits.
=======_PLACEHOLDER_DO_NOT_USE
<path>docs/region-analysis-notes.md</path>
<content># Region Analysis — Working Notes

> Status: analysis captured for later. No code changes pending. The dashboard
> component (`components/strategy/structured/region-dashboard.tsx`) is restored
> to its committed baseline (commit `217d544`, 466 lines).

## 1. Reference briefing structure (the target)

The Kuban-style regional briefing we are trying to reproduce is organized as a
top-down decision document, roughly:

1. **Executive snapshot** — region, period, who the briefing is for, headline read.
2. **Situational picture** — key macro/sector indicators with light trend signals.
3. **Priorities & objectives** — what the region is trying to achieve.
4. **Sber entry angle ("Заход Сбера")** — decision-makers, competitors, entry points.
   (Already collapsed into its own section in the current component.)
5. **Opportunities / proposed bets** — matched to region priorities.
6. **Risks & data gaps** — what is uncertain or missing, shown muted rather than hidden.
7. **Next steps** — concrete, owner-able actions.

## 2. Gap map — reference deck vs. current `RegionAnalysisOutput`

This compares what the reference briefing contains against the current schema in
`lib/schemas/structured-output.ts`. **Verify each row against the actual schema
before acting on it** — these notes predate the file restoration and were not
re-confirmed.

| Briefing element | Likely schema field | Status / note |
| --- | --- | --- |
| Executive snapshot | `summary` / header fields | Confirm field names against schema |
| Situational indicators | `metrics[]` | Check whether trend/direction is modeled |
| Priorities & objectives | `priorities[]` (?) | Existence unconfirmed — verify |
| Sber entry angle | sales sub-fields (ЛПР, конкуренты, точки входа) | Present; already grouped in UI |
| Opportunities / bets | `bets[]` / `opportunities[]` | Confirm naming; check link to priorities |
| Risks | `risks[]` | Present |
| Data gaps | `dataGaps[]` (?) | Was the source of the earlier corruption — verify it exists |
| Next steps | `nextSteps[]` | Present |

## 3. Prompt / contract direction

- The region-analysis mode prompt lives in `lib/prompts/region-analysis-mode.ts`;
  the structured contract in `lib/prompts/structured-contract.ts`. Any new section
  the UI renders must be backed by both a schema field **and** a contract instruction,
  otherwise the model will not populate it reliably.
- Direction discussed earlier: make the output map 1:1 onto the briefing structure above, so each section has a clear home rather than being improvised at render time.
- Keep risks and data gaps visually muted (lower contrast) rather than omitted, so the briefing reads as honest about uncertainty.

## 4. What NOT to repeat next session

- The dashboard file is **466 lines**, not 732. Earlier "verified line" claims about
  this file were unreliable and led to overwriting it with a placeholder. Trust git
  and a fresh re-read, not prior notes.
- Before any edit: re-read the actual file and the schema, then make one small change
  and verify the tooling executed before scaling up.

## 5. Recommended next steps (when resuming code work)

1. Re-read `region-dashboard.tsx` and `lib/schemas/structured-output.ts` fresh.
2. Confirm the gap-map table above row by row against the real schema.
3. For any missing section, add the schema field + contract instruction first, UI last.
4. Make incremental, verified edits.