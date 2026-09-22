---
title: BrewOps IQ Agent Instructions
description: Staged implementation guidance for the Chain Operations Suite assignment
---

## Required workflow

1. Read `harness/STATE.md` first.
2. Work only on the module named by `stage` and only in its listed target file.
3. Read only the brief named by `brief`, plus `src/data/index.ts` for loader types.
4. Treat the selected brief as a lossless distillation of `SPEC.md`. Do not read
   `SPEC.md` unless the brief is internally contradictory.
5. Do not inspect or use `src/legacy/**` or `docs/RETRO.md`; they intentionally
   contradict the assignment.
6. Do not change completed modules, UI files, data files, configuration, harness
   files, or `COST.txt`.
7. Do not create or run tests. Do not run builds or type checks; the provided
   wrapper performs compilation after the run.
8. Implement the complete selected module in one pass. Keep helpers private and
   export exactly the interfaces and function required by the selected brief.
9. Read catalog data only through `src/data/index.ts`. Never import JSON directly.

## Implementation priorities

* Follow exact output shapes, validation messages, ordering, boundaries, and
  tie-breaks from the selected brief.
* Use deterministic UTC date arithmetic where the brief requires dates.
* Use a decimal-safe half-up money helper. Do not use banker's rounding or naive
  `Math.round(value * 100) / 100`.
* Avoid unrelated refactoring and dependencies.