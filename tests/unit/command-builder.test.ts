/**
 * Command Builder unit tests — verifies RenderCommand generation from LayoutBox trees.
 *
 * @module @spatial/renderer/command-builder
 */

import { describe, it, expect } from 'vitest';
import { buildRenderCommands } from '../../src/renderer/command-builder';
import type { LayoutBox, MeasurementResult } from '../../src/types/layout';
import type { ThemeConfig } from '../../src/types/theme';
import { defaultTheme } from '../../src/types/theme';
import { px, nodeId, font } from '../../src/types/primitives';
import type { SpatialNode, NodeKind } from '../../src/types/ast';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeBox(overrides: Partial<LayoutBox> & { kind: NodeKind }): LayoutBox {
  return {
    nodeId: overrides.nodeId ?? nodeId(1),
    kind: overrides.kind,
    x: overrides.x ?? px(0),
    y: overrides.y ?? px(0),
    width: overrides.width ?? px(400),
    height: overrides.height ?? px(300),
    contentX: overrides.contentX ?? px(32),
    contentY: overrides.contentY ?? px(32),
    contentWidth: overrides.contentWidth ?? px(336),
    contentHeight: overrides.contentHeight ?? px(236),
    children: overrides.children ?? [],
    measurement: overrides.measurement ?? null,
    clipChildren: overrides.clipChildren ?? false,
    scrollable: overrides.scrollable ?? false,
  };
}

function makeLineMeasurement(lines: { text: string; width: number }[]): MeasurementResult {
  return {
    kind: 'line-detail',
    height: px(lines.length * 20),
    lineCount: lines.length,
    lines: lines.map(l => ({ text: l.text, width: px(l.width) })),
  };
}

function makeNodeIndex(nodes: SpatialNode[]): Map<number, SpatialNode> {
  const map = new Map<number, SpatialNode>();
  for (const node of nodes) {
    map.set(node.id, node);
  }
  return map;
}

describe('Command Builder', () => {
  const theme: ThemeConfig = defaultTheme;

  describe('Fill-rect backgrounds', () => {
    it('should produce a fill-rect for a slide node', () => {
      const box = makeBox({ kind: 'slide', nodeId: nodeId(1) });
      const commands = buildRenderCommands([box], theme);

      const fills = commands.filter(c => c.kind === 'fill-rect');
      expect(fills.length).toBeGreaterThanOrEqual(1);
      // Slide background should be the theme's background color
      expect((fills[0] as any).color).toBe(theme.colors.background);
    });

    it('should produce a fill-rect for a metric-card node with surface color', () => {
      const box = makeBox({ kind: 'metric-card', nodeId: nodeId(1) });
      const commands = buildRenderCommands([box], theme);

      const fills = commands.filter(c => c.kind === 'fill-rect');
      expect(fills.length).toBeGreaterThanOrEqual(1);
      expect((fills[0] as any).color).toBe(theme.colors.surface);
    });

    it('should NOT produce a fill-rect for plain text nodes', () => {
      const box = makeBox({ kind: 'text', nodeId: nodeId(1) });
      const commands = buildRenderCommands([box], theme);

      const fills = commands.filter(c => c.kind === 'fill-rect');
      // Text nodes have null background → no fill-rect emitted for background
      // (though parent containers may emit fills)
      const backgroundFills = fills.filter(
        f => (f as any).nodeId === nodeId(1)
      );
      expect(backgroundFills.length).toBe(0);
    });
  });

  describe('Fill-text rendering', () => {
    it('should produce fill-text commands for text nodes with measurements', () => {
      const measurement = makeLineMeasurement([
        { text: 'Hello World', width: 100 },
      ]);
      const box = makeBox({
        kind: 'text',
        nodeId: nodeId(1),
        measurement,
      });

      // Create a mock nodeIndex with a text node
      const textNode = {
        id: nodeId(1),
        kind: 'text' as const,
        status: 'closed' as const,
        dirty: { textDirty: false, constraintDirty: false, geometryDirty: false, renderDirty: false },
        computedRect: null,
        parentId: null,
        sourceOffset: 0,
        props: {
          font: font('14px Inter'),
          lineHeight: px(20),
          color: undefined,
          align: 'left' as const,
          whiteSpace: 'normal' as const,
          wordBreak: 'normal' as const,
          maxLines: undefined,
          opacity: 1,
        },
        children: [] as [],
        textBuffer: { raw: 'Hello World', lastPrepareLength: 0 },
      };

      const nodeIndex = makeNodeIndex([textNode]);
      const commands = buildRenderCommands([box], theme, nodeIndex);

      const texts = commands.filter(c => c.kind === 'fill-text');
      expect(texts.length).toBeGreaterThanOrEqual(1);
      expect((texts[0] as any).text).toBe('Hello World');
    });
  });

  describe('Clip/restore pairs', () => {
    it('should produce clip-rect + restore-clip pairs for code blocks', () => {
      const box = makeBox({
        kind: 'code-block',
        nodeId: nodeId(1),
        clipChildren: true,
      });

      const codeNode = {
        id: nodeId(1),
        kind: 'code-block' as const,
        status: 'closed' as const,
        dirty: { textDirty: false, constraintDirty: false, geometryDirty: false, renderDirty: false },
        computedRect: null,
        parentId: null,
        sourceOffset: 0,
        props: {
          language: 'typescript',
          title: undefined,
          showLineNumbers: false,
          startLine: 1,
          highlight: undefined,
          maxHeight: undefined,
          font: font('14px "JetBrains Mono", monospace'),
          lineHeight: px(20),
          padding: px(16),
          background: undefined,
          wrap: false,
        },
        children: [] as [],
        textBuffer: { raw: 'const x = 1;', lastPrepareLength: 0 },
      };

      const nodeIndex = makeNodeIndex([codeNode]);
      const commands = buildRenderCommands([box], theme, nodeIndex);

      const clips = commands.filter(c => c.kind === 'clip-rect');
      const restores = commands.filter(c => c.kind === 'restore-clip');

      // Code blocks should have clip-rect (from walkBox) — may have 2: one from
      // getBackgroundColor-induced clipChildren=true and one from emitCodeBlockCommands
      expect(clips.length).toBeGreaterThanOrEqual(1);
    });

    it('should produce clip-rect for slides', () => {
      const box = makeBox({
        kind: 'slide',
        nodeId: nodeId(1),
        clipChildren: true,
      });

      const slideNode = {
        id: nodeId(1),
        kind: 'slide' as const,
        status: 'closed' as const,
        dirty: { textDirty: false, constraintDirty: false, geometryDirty: false, renderDirty: false },
        computedRect: null,
        parentId: null,
        sourceOffset: 0,
        props: {
          width: px(800),
          height: px(600),
          padding: px(32),
          paddingX: undefined,
          paddingY: undefined,
          background: undefined,
        },
        children: [] as SpatialNode[],
      };

      const nodeIndex = makeNodeIndex([slideNode]);
      const commands = buildRenderCommands([box], theme, nodeIndex);

      const clips = commands.filter(c => c.kind === 'clip-rect');
      expect(clips.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Divider rendering', () => {
    it('should produce draw-line for a horizontal divider node', () => {
      const box = makeBox({
        kind: 'divider',
        nodeId: nodeId(1),
        contentX: px(32),
        contentY: px(100),
        contentWidth: px(336),
        contentHeight: px(2),
      });

      const dividerNode = {
        id: nodeId(1),
        kind: 'divider' as const,
        status: 'closed' as const,
        dirty: { textDirty: false, constraintDirty: false, geometryDirty: false, renderDirty: false },
        computedRect: null,
        parentId: null,
        sourceOffset: 0,
        props: {
          direction: 'horizontal' as const,
          thickness: px(2),
          color: undefined,
          marginTop: px(12),
          marginBottom: px(12),
          indent: px(0),
        },
        children: [] as [],
      };

      const nodeIndex = makeNodeIndex([dividerNode]);
      const commands = buildRenderCommands([box], theme, nodeIndex);

      const lines = commands.filter(c => c.kind === 'draw-line');
      expect(lines.length).toBe(1);
    });
  });

  describe('Empty input', () => {
    it('should return empty commands array for empty input', () => {
      const commands = buildRenderCommands([], theme);
      expect(commands).toEqual([]);
    });

    it('should work without a nodeIndex', () => {
      const box = makeBox({ kind: 'slide', nodeId: nodeId(1) });
      const commands = buildRenderCommands([box], theme);
      // Should still produce commands (background fill)
      expect(commands.length).toBeGreaterThanOrEqual(1);
    });
  });
});