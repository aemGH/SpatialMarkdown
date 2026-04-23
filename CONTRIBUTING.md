# Contributing to `@spatial-markdown/engine`

Thanks for your interest in contributing. This document tells you how to get set up, what the architecture looks like, and what we expect from a PR.

This project is a high-performance, zero-reflow layout engine that renders structured documents to Canvas, SVG, or React from a closed tag vocabulary. It's built on [`@chenglou/pretext`](https://www.npmjs.com/package/@chenglou/pretext) for DOM-less text measurement. Performance and type strictness are non-negotiable.

---

## 1. Quick Start

**Prerequisites**: Node.js `>=20.0.0`, npm `>=10`.

```bash
git clone https://github.com/<org>/spatial-markdown.git
cd spatial-markdown/apps/SpacialMarkdown
npm install
npm test
```

If all 173 tests pass, you're set. Then try the demo:

```bash
npm run demo    # preset gallery (open the printed URL)
npm run dev     # library dev mode with HMR
```

---

## 2. Project Structure

The engine is a one-way pipeline. Each layer has a single responsibility and must not reach across layers.

```
src/
├── types/        Branded types, discriminated unions, ThemeConfig
├── parser/       Streaming tokenizer (FSM) → incremental AST builder → transforms
├── engine/       Constraint solver + pretext measurement + geometry. Pure TS, NO DOM.
├── renderer/     Canvas 2D / React / SVG backends. All consume RenderCommand[].
├── bridge/       WebSocket/SSE adapters, ring buffer, backpressure controller
├── theme/        Theme extraction from URLs/HTML → ThemeConfig
└── pipeline.ts   Top-level orchestrator that wires everything together
```

**Pipeline flow** (data moves left-to-right, always):

```
feed() → Tokenizer → AST Builder → Transforms
       → Constraint Solver → Measurement → Geometry
       → RenderCommand[] → Subscribers
```

All output is batched per `requestAnimationFrame`. The engine is streaming-safe — partial input must produce a partial, renderable AST.

**Layer rules**:
- `engine/` must not import from `renderer/` or touch the DOM.
- `renderer/` must not compute geometry — consume `RenderCommand[]` only.
- `parser/` must not know about measurement or layout.
- New cross-layer coupling is a red flag in review.

---

## 3. Development Workflow

1. **Open an issue first** for non-trivial changes. Fix-typo and doc PRs are fine without.
2. **Branch** from `main`: `git checkout -b feat/auto-grid-gap` or `fix/tokenizer-escape`.
3. **Code** the change. Keep PRs focused — one concern per PR.
4. **Verify locally** before pushing:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
5. **Benchmark** if you touched `engine/` (see [Performance Requirements](#7-performance-requirements)).
6. **Open a PR** against `main` using the template below.

### Branch naming

| Prefix | Use for |
|--------|---------|
| `feat/` | New features or tags |
| `fix/` | Bug fixes |
| `perf/` | Performance improvements |
| `refactor/` | Internal changes, no behavior delta |
| `docs/` | Documentation only |
| `test/` | Test-only changes |

### Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(parser): support escaped angle brackets in text nodes
fix(engine): prevent NaN width when Columns has zero children
perf(measurement): cache pretext font metrics per (family, size)
```

---

## 4. Code Standards

### TypeScript strictness (non-negotiable)

- **No `any`.** Ever. Use `unknown` at boundaries and narrow with guards.
- **No `as` casts** except for branded-type constructors and well-commented escape hatches.
- **Discriminated unions** for all layout nodes. Every node has a `kind` literal field; exhaustiveness is enforced via `never` checks.
- **Branded types** for identifiers and units (`NodeId`, `Px`, `Em`, `Ratio`). Never mix raw `number`s across unit boundaries.

```typescript
// ✅ Good — exhaustive, typed, no unsafe narrowing
function layout(node: LayoutNode): RenderCommand[] {
  switch (node.kind) {
    case 'slide':    return layoutSlide(node);
    case 'autoGrid': return layoutAutoGrid(node);
    // … all 16 tags …
    default: {
      const _exhaustive: never = node;
      return _exhaustive;
    }
  }
}

// ❌ Bad
function layout(node: any) { /* ... */ }
```

### Formatting & linting

- `npm run format` before committing (Prettier).
- `npm run lint` must be clean (oxlint).
- Imports: use path aliases (`@/engine/...`) where configured, relative imports only within a layer.

### The tag vocabulary is closed

We ship **16 built-in tags**: `Slide`, `AutoGrid`, `Stack`, `Columns`, `Canvas`, `MetricCard`, `CodeBlock`, `DataTable`, `Chart`, `Quote`, `Callout`, `Text`, `Heading`, `Spacer`, `Divider`, `Image`.

Adding a 17th tag requires an RFC-style issue with a concrete use case that cannot be composed from existing tags. Most proposals will be declined — prefer composition over vocabulary growth.

---

## 5. Adding a New Node Type

This is the happy path for touching all layers. Follow the order — each step depends on the previous one typechecking.

Let's say you're adding `Timeline` (hypothetical — do not actually add this without an RFC).

### Step 1 — Types (`src/types/nodes.ts`)

Add the discriminated-union variant:

```typescript
export interface TimelineNode {
  kind: 'timeline';
  id: NodeId;
  events: ReadonlyArray<TimelineEvent>;
  orientation: 'horizontal' | 'vertical';
}

export type LayoutNode =
  | SlideNode
  | AutoGridNode
  // … existing …
  | TimelineNode;
```

Run `npm run typecheck`. You should now see exhaustiveness errors everywhere `LayoutNode` is switched on. That's your to-do list.

### Step 2 — Parser (`src/parser/`)

1. Register the tag in `parser/tagRegistry.ts`.
2. Add tokenizer recognition in `parser/tokenizer.ts` (no FSM state change usually required — the FSM is tag-agnostic).
3. Map tokens → AST node in `parser/astBuilder.ts`.
4. Add parser tests in `src/parser/__tests__/` covering: happy path, partial/streaming input, malformed input.

### Step 3 — Engine (`src/engine/`)

1. Add a layout function in `engine/layouts/timeline.ts` that:
   - Takes a resolved `TimelineNode` + parent constraints.
   - Calls `measure()` (pretext) for any text content **before** computing geometry.
   - Returns a `LayoutResult` with absolute coordinates.
2. Wire it into the `layout()` dispatcher. The `never` check will tell you where.
3. No DOM access. No `document`, no `window`, no `getComputedStyle`.

### Step 4 — Renderer (`src/renderer/`)

The renderers consume `RenderCommand[]` — a flat, backend-agnostic list. You usually don't add a new command type; reuse `drawRect`, `drawText`, `drawPath`, `drawImage`. If you genuinely need a new primitive, add it in all three backends (Canvas, React, SVG) in the same PR.

### Step 5 — Tests

- **Unit**: layout math in isolation (`engine/__tests__/timeline.test.ts`).
- **Integration**: end-to-end via `pipeline.ts` — feed markdown, assert render commands.
- **Snapshot**: visual regression via Canvas pixel hash (see existing examples).
- **Benchmark**: add a case to `bench/` if layout complexity is O(n) or worse.

### Step 6 — Docs

Update the tag reference in `docs/tags.md` with: syntax, props, example, rendered screenshot.

---

## 6. Testing

```bash
npm test                  # all unit + integration (173 tests baseline)
npm test -- parser        # filter by path
npm test -- --watch       # watch mode
npm run test:coverage     # v8 coverage report
npm run test:bench        # performance benchmarks
```

### What to test

| Layer | What you test |
|-------|---------------|
| Types | (Nothing — compiler is the test) |
| Parser | Token sequences, AST shape, streaming/partial input, error recovery |
| Engine | Geometry math, constraint resolution, measurement caching |
| Renderer | `RenderCommand[]` → backend output (snapshot or pixel hash) |
| Bridge | Backpressure, buffer overflow, reconnection |
| Pipeline | End-to-end: text in → render commands out |

### Test style

- **Arrange / Act / Assert** blocks, separated by blank lines.
- One behavior per `it()`. Long setups belong in `beforeEach` or helpers.
- Prefer explicit fixtures over generated input. Reproducibility > cleverness.
- **Never** rely on timing or real clocks — use Vitest fake timers.

---

## 7. Performance Requirements

The engine targets 60fps streaming rendering. We have budgets, and the CI benchmark job enforces them.

### Budget targets (per frame)

| Operation | p50 | p95 |
|-----------|----:|----:|
| Tokenize 1KB chunk | < 0.2 ms | < 0.5 ms |
| AST rebuild (incremental) | < 0.5 ms | < 1.5 ms |
| Layout (100 nodes, single slide) | < 2 ms | < 5 ms |
| Layout (1000 nodes) | < 8 ms | < 16 ms |
| Measurement (cached) | < 0.05 ms | < 0.1 ms |
| RenderCommand emit | < 1 ms | < 3 ms |

A full streaming frame (all of the above) must stay under **16.6 ms** for 60fps.

### When a PR must include a benchmark report

If your diff touches any file under `src/engine/`, `src/parser/`, or `src/pipeline.ts`, run:

```bash
npm run test:bench -- --reporter=verbose > bench-report.txt
```

Paste the before/after numbers into the PR description using the template:

```
| Case                       | Before (ms) | After (ms) | Δ      |
|----------------------------|------------:|-----------:|-------:|
| layout.autoGrid.100nodes   |        1.82 |       1.74 |  -4.4% |
| layout.columns.1000nodes   |        7.91 |       7.88 |  -0.4% |
```

**Regressions > 5% require justification.** "It's clearer code" is not sufficient on a hot path.

### Profiling tips

- Use `--cpu-prof` on Vitest bench runs to get flamegraphs.
- `performance.mark()` / `measure()` are available in the engine via the `profiler` helper. Leave them in dev; the build strips them.

---

## 8. Pull Request Guidelines

### Before opening

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (all 173+ tests)
- [ ] `npm run build` succeeds (ESM + CJS + `.d.ts`)
- [ ] Benchmark report included if engine/parser/pipeline touched
- [ ] Docs updated if public API changed
- [ ] New code has tests (aim for ≥90% line coverage on new files)

### PR description template

```markdown
## What
One-sentence summary.

## Why
The problem this solves. Link the issue.

## How
Brief description of the approach. Call out anything non-obvious.

## Performance
(Required if engine/parser/pipeline.ts changed. Paste bench table.)

## Breaking changes
None / list them.

## Checklist
- [ ] Tests added
- [ ] Docs updated
- [ ] Benchmark report (if applicable)
```

### Review expectations

- PRs are reviewed within 2 business days.
- Expect a round or two of feedback. Performance-sensitive or cross-layer changes get deeper review.
- Squash-merge is the default. Write a clean commit message at merge time.

### What gets a PR rejected

- Use of `any` or untyped escape hatches without justification.
- DOM access in `engine/`.
- Adding a new tag without an approved RFC.
- Bypassing `pretext` measurement (e.g., estimating text width from char count).
- Performance regression > 5% with no rationale.
- Tests skipped or marked `.only` left in.

---

## Questions?

Open a [Discussion](https://github.com/<org>/spatial-markdown/discussions) for design questions, or an [Issue](https://github.com/<org>/spatial-markdown/issues) for bugs. For security reports, see `SECURITY.md`.

Thanks for helping keep the engine fast and correct.
