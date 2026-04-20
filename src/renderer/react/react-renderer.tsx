/**
 * React Renderer — RenderCommand[] → React component tree
 *
 * Produces React elements from renderer-agnostic draw commands.
 * Output is an SVG tree inside a React component, giving you:
 *   - Absolute-position accuracy (no DOM reflow can shift pretext geometry)
 *   - Native React composition (props, refs, keys, suspense boundaries)
 *   - Server-side rendering support (renderToString compatible)
 *   - Text selectability (unlike Canvas)
 *
 * @module @spatial/renderer/react/react-renderer
 */

import type { ReactElement, ReactNode } from 'react';
import type {
  RenderCommand,
  FillRectCommand,
  StrokeRectCommand,
  FillTextCommand,
  DrawImageCommand,
  ClipRectCommand,
  DrawLineCommand,
} from '../../types/render';
import type { Pixels } from '../../types/primitives';

// ─── Public Props ────────────────────────────────────────────────────

export interface SpatialViewProps {
  /** Draw commands produced by the pipeline's `onRender` callback. */
  readonly commands: ReadonlyArray<RenderCommand>;
  /** Logical viewport width in pixels. */
  readonly width: Pixels | number;
  /** Logical viewport height in pixels. */
  readonly height: Pixels | number;
  /** Optional className applied to the root <svg>. */
  readonly className?: string;
  /** Optional inline style applied to the root <svg>. */
  readonly style?: React.CSSProperties;
  /**
   * If true, allow selection and copy of text. Default: true.
   * SVG <text> is selectable by default; set false to disable.
   */
  readonly selectable?: boolean;
  /** Optional ARIA label for accessibility. */
  readonly ariaLabel?: string;
}

// ─── Clip Path Bookkeeping ───────────────────────────────────────────

interface ClipDef {
  readonly id: string;
  readonly rect: ReactElement;
}

// ─── Command → ReactElement Converters ───────────────────────────────

function fillRectToElement(cmd: FillRectCommand, key: string): ReactElement {
  const radiusProps =
    cmd.borderRadius > 0
      ? { rx: cmd.borderRadius, ry: cmd.borderRadius }
      : {};
  return (
    <rect
      key={key}
      x={cmd.x}
      y={cmd.y}
      width={cmd.width}
      height={cmd.height}
      fill={cmd.color}
      {...radiusProps}
    />
  );
}

function strokeRectToElement(cmd: StrokeRectCommand, key: string): ReactElement {
  const radiusProps =
    cmd.borderRadius > 0
      ? { rx: cmd.borderRadius, ry: cmd.borderRadius }
      : {};
  return (
    <rect
      key={key}
      x={cmd.x}
      y={cmd.y}
      width={cmd.width}
      height={cmd.height}
      fill="none"
      stroke={cmd.color}
      strokeWidth={cmd.lineWidth}
      {...radiusProps}
    />
  );
}

function fillTextToElement(cmd: FillTextCommand, key: string): ReactElement {
  const lines = cmd.text.split('\n');

  // Single line — simple <text>.
  if (lines.length <= 1) {
    return (
      <text
        key={key}
        x={cmd.x}
        y={cmd.y}
        // React converts `font` into a CSS shorthand on the element.
        // SVG supports the `font` presentation attribute via inline style.
        style={{ font: cmd.font }}
        fill={cmd.color}
        dominantBaseline="text-before-edge"
      >
        {lines[0] ?? ''}
      </text>
    );
  }

  // Multi-line — emit <tspan>s with baseline-advancing y.
  return (
    <text
      key={key}
      style={{ font: cmd.font }}
      fill={cmd.color}
      dominantBaseline="text-before-edge"
    >
      {lines.map((line, i) => (
        <tspan key={i} x={cmd.x} y={cmd.y + cmd.lineHeight * i}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function drawImageToElement(cmd: DrawImageCommand, key: string): ReactElement {
  return (
    <image
      key={key}
      x={cmd.x}
      y={cmd.y}
      width={cmd.width}
      height={cmd.height}
      href={cmd.src}
      preserveAspectRatio="xMidYMid slice"
    />
  );
}

function drawLineToElement(cmd: DrawLineCommand, key: string): ReactElement {
  return (
    <line
      key={key}
      x1={cmd.x1}
      y1={cmd.y1}
      x2={cmd.x2}
      y2={cmd.y2}
      stroke={cmd.color}
      strokeWidth={cmd.lineWidth}
      strokeLinecap="round"
    />
  );
}

function clipRectDef(cmd: ClipRectCommand, clipId: string): ClipDef {
  const radiusProps =
    cmd.borderRadius > 0
      ? { rx: cmd.borderRadius, ry: cmd.borderRadius }
      : {};
  const rect = (
    <rect
      x={cmd.x}
      y={cmd.y}
      width={cmd.width}
      height={cmd.height}
      {...radiusProps}
    />
  );
  return { id: clipId, rect };
}

// ─── Main Converter ──────────────────────────────────────────────────

/**
 * Convert a flat RenderCommand list into a tree of React elements.
 *
 * Clip commands open a <g clipPath="url(#id)"> group that wraps all
 * subsequent elements until RestoreClip closes it. We emit clip path
 * definitions separately in <defs> and track the active group stack.
 */
function commandsToElements(
  commands: ReadonlyArray<RenderCommand>,
): { defs: ReactElement[]; body: ReactElement } {
  const defs: ReactElement[] = [];
  const rootChildren: ReactNode[] = [];
  /**
   * Group stack — each entry owns a children array that accumulates
   * elements until the matching RestoreClip pops it.
   */
  const groupStack: Array<{ children: ReactNode[]; clipId: string }> = [];
  let clipCounter = 0;

  /** Append to the innermost group, or root if no group is open. */
  function append(node: ReactNode): void {
    if (groupStack.length > 0) {
      groupStack[groupStack.length - 1]!.children.push(node);
    } else {
      rootChildren.push(node);
    }
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i]!;
    const key = `cmd-${i}`;

    switch (cmd.kind) {
      case 'fill-rect':
        append(fillRectToElement(cmd, key));
        break;
      case 'stroke-rect':
        append(strokeRectToElement(cmd, key));
        break;
      case 'fill-text':
        append(fillTextToElement(cmd, key));
        break;
      case 'draw-image':
        append(drawImageToElement(cmd, key));
        break;
      case 'draw-line':
        append(drawLineToElement(cmd, key));
        break;
      case 'clip-rect': {
        const clipId = `spatial-clip-${clipCounter++}`;
        const def = clipRectDef(cmd, clipId);
        defs.push(
          <clipPath key={clipId} id={clipId}>
            {def.rect}
          </clipPath>,
        );
        groupStack.push({ children: [], clipId });
        break;
      }
      case 'restore-clip': {
        const closed = groupStack.pop();
        if (closed !== undefined) {
          const groupEl = (
            <g key={`clip-group-${closed.clipId}`} clipPath={`url(#${closed.clipId})`}>
              {closed.children}
            </g>
          );
          append(groupEl);
        }
        break;
      }
    }
  }

  // Defensive: close any unbalanced clip groups so we don't drop content.
  while (groupStack.length > 0) {
    const closed = groupStack.pop()!;
    const groupEl = (
      <g key={`clip-group-${closed.clipId}`} clipPath={`url(#${closed.clipId})`}>
        {closed.children}
      </g>
    );
    if (groupStack.length > 0) {
      groupStack[groupStack.length - 1]!.children.push(groupEl);
    } else {
      rootChildren.push(groupEl);
    }
  }

  const body = <>{rootChildren}</>;
  return { defs, body };
}

// ─── Public Component ────────────────────────────────────────────────

/**
 * `<SpatialView>` — renders a Spatial Markdown pipeline's output as
 * React-native SVG. Pure function of `commands` — no internal state.
 *
 * @example
 * ```tsx
 * import { createPipeline } from '@spatial-markdown/engine';
 * import { SpatialView } from '@spatial-markdown/engine/react';
 *
 * function App() {
 *   const [commands, setCommands] = useState([]);
 *   const pipelineRef = useRef<SpatialPipeline | null>(null);
 *
 *   useEffect(() => {
 *     const pipeline = createPipeline();
 *     pipeline.onRender(setCommands);
 *     pipeline.feed('<Slide><Heading level={1}>Hello</Heading></Slide>');
 *     pipeline.flush();
 *     pipelineRef.current = pipeline;
 *     return () => pipeline.destroy();
 *   }, []);
 *
 *   return <SpatialView commands={commands} width={800} height={600} />;
 * }
 * ```
 */
export function SpatialView(props: SpatialViewProps): ReactElement {
  const {
    commands,
    width,
    height,
    className,
    style,
    selectable = true,
    ariaLabel,
  } = props;

  const { defs, body } = commandsToElements(commands);

  const svgStyle: React.CSSProperties = {
    userSelect: selectable ? 'text' : 'none',
    ...style,
  };

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      style={svgStyle}
      role={ariaLabel !== undefined ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      {defs.length > 0 ? <defs>{defs}</defs> : null}
      {body}
    </svg>
  );
}

// ─── Low-level helper for non-component consumers ────────────────────

/**
 * Convert RenderCommands directly into a React element tree without
 * wrapping in `<svg>`. Useful if you want to embed inside an existing
 * SVG or compose with custom decorations.
 */
export function renderCommandsToReact(
  commands: ReadonlyArray<RenderCommand>,
): ReactElement {
  const { defs, body } = commandsToElements(commands);
  return (
    <>
      {defs.length > 0 ? <defs>{defs}</defs> : null}
      {body}
    </>
  );
}
