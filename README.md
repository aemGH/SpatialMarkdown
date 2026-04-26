# @spatial-markdown/engine

A DOM-less, multi-pass layout engine designed for asynchronous streaming text. It calculates pure geometry via a custom AST and renders strictly to Canvas and Android Jetpack Compose, bypassing browser reflows entirely.

## Motivation

Standard HTML/DOM architectures suffer from constant layout thrashing (reflows) when text streams in dynamically. This engine was built from first principles to solve this by moving layout calculations entirely out of the DOM. By treating text rendering as a geometry problem, it guarantees strictly zero layout shift during continuous text streams.

## Core Architecture

The pipeline is structured as a one-way data flow, decoupling text parsing, measurement, constraint solving, and rendering.

```
Stream Buffer → FSM Tokenizer → AST Builder → Constraint Solver → Geometry Calculator → RenderCommand[] → Canvas / Kotlin Runtime
```

### 1. Chunk-Safe FSM Tokenizer
Instead of relying on fragile Regular Expressions, the parser uses a 5-state Push-Down Automaton (State Machine). Because text streams arrive in unpredictable byte chunks, the tokenizer buffers partial states (e.g., `<CodeB`) and resumes seamlessly without re-evaluating the entire string, avoiding O(n²) parsing performance degradation.

### 2. Multi-Pass Constraint Solver
Layout is calculated mathematically before a single pixel is painted. 
- **Pass 1 (Bottom-Up):** Child nodes determine their intrinsic sizes via `@chenglou/pretext`.
- **Pass 2 (Top-Down):** Parent containers (Grid, FlexRow, Stack) push absolute coordinate constraints `(x, y, width, height)` down to their children.

### 3. LRU Measurement Cache
Text measurement is the most expensive operation in layout. The engine implements a hand-rolled LRU cache utilizing a doubly-linked list mapped to a `Map` for guaranteed `O(1)` reads/writes. It uses sentinel nodes (`head` and `tail`) to eliminate branch checks during memory surgery, and zero-allocation composite keys (separated by null bytes `\x00`) to prevent cache collisions.

### 4. Cross-Platform Runtimes (Canvas & Android QuickJS)
The engine does not output HTML. It outputs a flat array of z-ordered `RenderCommand` objects (e.g., `fill-rect`, `fill-text`, `clip-rect`). 
- **Web:** A High-DPI aware Canvas 2D backend blindly paints these commands, managing sub-pixel offsets for crisp 1px borders.
- **Android:** An embedded QuickJS engine runs the TypeScript layout pipeline natively, bridging the resulting `RenderCommand` array to Android's Jetpack Compose for native 60fps mobile rendering.

## Type Safety

The codebase enforces a strict "Zero `any`" policy. 
- **Discriminated Unions:** The entire component tree and command structure are strictly typed unions.
- **Branded Types:** Numeric values are cast to branded generics (`Pixels`, `NodeId`, `FontDescriptor`) to prevent unit confusion at compile time.
- **Immutability:** Extensive use of `ReadonlyArray` and `ReadonlyMap` ensures layout constraints cannot be mutated mid-flight.

## Performance Benchmarks

Targeting a 16ms frame budget (60fps), the engine heavily relies on dirty-flag propagation (`textDirty`, `constraintDirty`) to calculate only the exact subset of the UI that changed.

| Stage | Budget | Measured (mean, 10-slide doc) |
|---|---|---|
| Tokenize + AST build | < 1 ms | ~0.05 ms |
| Constraint solve | < 0.5 ms | ~0.12 ms |
| Pretext measurement (cache hit) | < 0.5 ms | ~0.02 ms |
| Geometry | < 1 ms | ~0.14 ms |
| **Full pipeline** | **< 16 ms** | **~0.15 ms** |

*Run `npm run test:bench` to reproduce locally.*

## Development

```bash
npm run dev           # library dev mode (Vite)
npm run build         # ESM + CJS + .d.ts to dist/
npm test              # Unit + integration tests
npm run test:bench    # Performance benchmarks
npm run typecheck     # strict tsc --noEmit
```

## License

MIT. Built on [`@chenglou/pretext`](https://github.com/chenglou/pretext) for DOM-less text measurement.