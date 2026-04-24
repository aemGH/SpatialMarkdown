import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load snapshot JSON files
function loadSnapshot(env: string, name: string): any[] {
  const filePath = path.join(__dirname, 'snapshots', env, `${name}.json`);
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/**
 * Normalizes a list of render commands for cross-host comparison.
 * Measurements across platforms (Node Canvas vs Android Paint) will differ
 * slightly due to different font shaping engines, hinting, and rasterization.
 * 
 * We normalize the geometric coordinates (x, y, width, height, maxWidth)
 * by rounding to the nearest integer to allow a small tolerance (±1px).
 * Text content and other strict properties must match exactly.
 */
function normalizeForComparison(commands: any[]): any[] {
  return commands.map(cmd => {
    const normalized = { ...cmd };
    
    // Normalize geometric properties
    if (typeof normalized.x === 'number') normalized.x = Math.round(normalized.x);
    if (typeof normalized.y === 'number') normalized.y = Math.round(normalized.y);
    if (typeof normalized.width === 'number') normalized.width = Math.round(normalized.width);
    if (typeof normalized.height === 'number') normalized.height = Math.round(normalized.height);
    if (typeof normalized.maxWidth === 'number') normalized.maxWidth = Math.round(normalized.maxWidth);
    
    return normalized;
  });
}

describe('Cross-Host Structural Equivalence', () => {
  it('node-canvas and android-paint should produce structurally equivalent app-full layouts', () => {
    // Load baselines
    const nodeCommands = loadSnapshot('node-canvas', 'app-full');
    const androidCommands = loadSnapshot('android-paint', 'app-full');
    
    // Extract just the component structure (ignoring text leaves which vary by line-wrapping)
    const nodeStructure = nodeCommands.filter(c => c.kind !== 'fill-text').map(c => c.kind);
    const androidStructure = androidCommands.filter(c => c.kind !== 'fill-text').map(c => c.kind);
    
    // The sequence of structural commands (rects, clips) MUST match exactly
    expect(nodeStructure).toEqual(androidStructure);
    
    // The number of text commands should be close (within a few lines difference due to wrapping)
    const nodeTextCount = nodeCommands.filter(c => c.kind === 'fill-text').length;
    const androidTextCount = androidCommands.filter(c => c.kind === 'fill-text').length;
    expect(Math.abs(nodeTextCount - androidTextCount)).toBeLessThanOrEqual(5);
  });
});
