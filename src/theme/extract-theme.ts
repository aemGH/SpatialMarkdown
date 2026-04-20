/**
 * Theme Extraction — Fetches a website URL and extracts design tokens.
 *
 * Produces an `ExtractedTheme` that can be mapped to the engine's `ThemeConfig`
 * via `mapExtractedTheme()`. The extraction is deterministic: no AI, no LLM,
 * just computed styles from HTML/CSS.
 *
 * Strategy:
 *   1. Fetch the HTML (via CORS proxy if direct fetch fails).
 *   2. Parse into a detached DOM document.
 *   3. Create a hidden <iframe> with the fetched document to get computed styles.
 *   4. Sample key elements (body, h1-h3, p, a, section, .card-like, button)
 *      and extract their computed color, font, spacing, border, and shadow values.
 *   5. Cluster and pick the mode/frequent values as the representative tokens.
 *
 * If the full iframe approach is not available (e.g., SSR or restricted
 * environments), extraction falls back to parsing CSS color declarations
 * from <style> and inline style attributes.
 *
 * @module @spatial-markdown/engine/theme
 */

// ─── Extracted Theme Type ─────────────────────────────────────────────

export interface ExtractedColors {
  /** Most common background color (body or main container) */
  background: string;
  /** Surface/card background (elevated elements) */
  surface: string;
  /** Primary text color */
  text: string;
  /** Secondary / muted text */
  textSecondary: string;
  /** Accent / link / brand color */
  accent: string;
  /** Border color */
  border: string;
}

export interface ExtractedTypography {
  /** Heading font family (e.g., 'Inter', 'Georgia') */
  headingFamily: string;
  /** Body font family */
  bodyFamily: string;
  /** Monospace font family */
  monoFamily: string;
  /** H1 font size in px */
  h1Size: number;
  /** H2 font size in px */
  h2Size: number;
  /** H3 font size in px */
  h3Size: number;
  /** Body font size in px */
  bodySize: number;
  /** Body line-height ratio (e.g., 1.5) */
  bodyLineHeight: number;
  /** Heading font weight (e.g., 700) */
  headingWeight: number;
}

export interface ExtractedSpacing {
  /** Base spacing unit in px (inferred from most common gap/padding) */
  unit: number;
  /** Section-level gap in px */
  sectionGap: number;
  /** Paragraph-level gap in px */
  paragraphGap: number;
}

export interface ExtractedSurfaces {
  /** Most common border-radius in px */
  borderRadius: number;
  /** Card/container background */
  cardBg: string;
  /** Box shadow for cards (CSS string) or empty string */
  cardShadow: string;
}

export interface ExtractedTheme {
  readonly url: string;
  readonly title: string;
  readonly colors: ExtractedColors;
  readonly typography: ExtractedTypography;
  readonly spacing: ExtractedSpacing;
  readonly surfaces: ExtractedSurfaces;
  /** Any CSS custom properties (variables) found at :root */
  readonly cssVariables: Record<string, string>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Attempt to resolve a CSS color value to a hex string.
 * Handles: hex (#fff, #ffffff), rgb(r,g,b), rgba(r,g,b,a),
 * hsl(h,s%,l%), named colors.
 * Returns the value as-is if it cannot be resolved.
 */
function resolveColor(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === '') return '';
  if (s === 'transparent' || s === 'none') return '';

  // Already hex
  if (s.startsWith('#')) return s;

  // rgb/rgba
  const rgbMatch = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10);
    const g = parseInt(rgbMatch[2]!, 10);
    const b = parseInt(rgbMatch[3]!, 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  // hsl — convert via temp element
  // named color — resolve via temp element
  // For both, we'll use a canvas context if in browser
  return s; // fallback: return as-is
}

/**
 * Resolve any CSS color string to hex using a Canvas 2D context.
 * Falls back to returning the raw string if resolution fails.
 */
function colorToHex(color: string, ctx: CanvasRenderingContext2D | null): string {
  if (!ctx) return resolveColor(color);
  if (color.trim() === '' || color.trim().toLowerCase() === 'transparent' || color.trim().toLowerCase() === 'none') {
    return '';
  }
  // Use the canvas context to parse any CSS color
  ctx.fillStyle = '#000000'; // reset
  ctx.fillStyle = color;
  const parsed = ctx.fillStyle;
  // fillStyle normalizes to hex or rgba
  if (parsed.startsWith('#')) return parsed;
  // Parse rgba
  const m = parsed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    const r = parseInt(m[1]!, 10);
    const g = parseInt(m[2]!, 10);
    const b = parseInt(m[3]!, 10);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }
  return color;
}

/** Parse a CSS padding value (possibly shorthand) to px number. */
function parsePxValue(raw: string): number {
  const m = raw.match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]!) : 0;
}

/** Extract CSS custom properties from :root or html. */
function extractCSSVariables(doc: Document): Record<string, string> {
  const vars: Record<string, string> = {};

  // From <style> blocks
  const styleElements = doc.querySelectorAll('style');
  for (const el of styleElements) {
    const css = el.textContent ?? '';
    // Stop at semicolon OR closing brace
    const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}]+)/g;
    let match: RegExpExecArray | null;
    while ((match = varRegex.exec(css)) !== null) {
      vars[`--${match[1]}`] = match[2]!.trim();
    }
  }

  // From inline styles on html/body
  const root = doc.documentElement;
  const rootStyle = root.getAttribute('style');
  if (rootStyle) {
    const varRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;}]+)/g;
    let match: RegExpExecArray | null;
    while ((match = varRegex.exec(rootStyle)) !== null) {
      vars[`--${match[1]}`] = match[2]!.trim();
    }
  }

  // From <link> style sheets — we can't fetch those cross-origin, so we
  // rely on the computed-style approach below if in browser context.

  return vars;
}

/** Pick the most frequent value from an array. */
function mode<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<T, number>();
  let maxCount = 0;
  let maxVal: T = arr[0]!;
  for (const v of arr) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > maxCount) {
      maxCount = c;
      maxVal = v;
    }
  }
  return maxVal;
}

/** Like mode() but for strings. */
function modeString(arr: string[]): string | undefined {
  return mode(arr);
}

/** Pick a color that is "closest to dark" for text, using luminance. */
function luminance(hex: string): number {
  if (!hex.startsWith('#')) return 0;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lighten a background color slightly for surface/cards. */
function lightenBg(hex: string, amount: number = 0.06): string {
  if (!hex.startsWith('#') || hex.length < 4) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = Math.min(255, Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Darken a background color slightly for surface/cards. */
function darkenBg(hex: string, amount: number = 0.03): string {
  if (!hex.startsWith('#') || hex.length < 4) return hex;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const r = Math.max(0, Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function resolveNestedVar(val: string, vars: Record<string, string>): string {
  let resolved = val;
  for (let i = 0; i < 5; i++) { // Max 5 levels of nesting
    const varRef = resolved.match(/var\(\s*([\w-]+)\s*\)/);
    if (varRef) {
      const refVal = vars[varRef[1]!];
      if (refVal !== undefined) {
        resolved = resolved.replace(varRef[0]!, refVal);
      } else {
        break;
      }
    } else {
      break;
    }
  }
  return resolved;
}

/**
 * Resolve a CSS custom property from the variables map.
 * Tries each candidate name in order and resolves var() references.
 * Returns a hex color or undefined.
 */
function resolveCSSVar(
  vars: Record<string, string>,
  candidates: string[],
  ctx: CanvasRenderingContext2D | null,
): string | undefined {
  for (const name of candidates) {
    const val = vars[name];
    if (val !== undefined) {
      const resolved = resolveNestedVar(val, vars);
      const hex = colorToHex(resolved.trim(), ctx);
      if (hex && hex.startsWith('#') && hex.length >= 4) return hex;
    }
  }
  return undefined;
}

/** Resolve a CSS custom property to a string (for font families). */
function resolveCSSVarString(
  vars: Record<string, string>,
  candidates: string[],
): string | undefined {
  for (const name of candidates) {
    const val = vars[name];
    if (val !== undefined) {
      const resolved = resolveNestedVar(val, vars);
      // Strip quotes and take first family
      const cleaned = resolved.trim().replace(/^["']|["']$/g, '');
      const first = cleaned.split(',')[0]!.trim().replace(/^["']|["']$/g, '');
      if (first && first !== 'inherit' && first !== 'initial' && first !== 'unset' && !first.startsWith('var(')) {
        return first;
      }
    }
  }
  return undefined;
}

/** Resolve a CSS custom property to a number (for sizes, spacing). */
function resolveCSSVarNumber(
  vars: Record<string, string>,
  candidates: string[],
): number | undefined {
  for (const name of candidates) {
    const val = vars[name];
    if (val !== undefined) {
      const resolved = resolveNestedVar(val, vars);
      const pxMatch = resolved.match(/([\d.]+)px/);
      if (pxMatch) return parseFloat(pxMatch[1]!);
      const remMatch = resolved.match(/([\d.]+)rem/);
      if (remMatch) return parseFloat(remMatch[1]!) * 16; // assume 16px base
      const emMatch = resolved.match(/([\d.]+)em/);
      if (emMatch) return parseFloat(emMatch[1]!) * 16;
      const num = parseFloat(resolved);
      if (!isNaN(num) && num > 0 && /^\d/.test(resolved.trim())) return num;
    }
  }
  return undefined;
}

/** Parse a CSS font-size value to a number in px. */
function parseFontSize(val: string | undefined): number | undefined {
  if (val === undefined) return undefined;
  val = val.trim();
  const pxMatch = val.match(/([\d.]+)px/);
  if (pxMatch) return parseFloat(pxMatch[1]!);
  const remMatch = val.match(/([\d.]+)rem/);
  if (remMatch) return parseFloat(remMatch[1]!) * 16;
  const emMatch = val.match(/([\d.]+)em/);
  if (emMatch) return parseFloat(emMatch[1]!) * 16;
  const percentMatch = val.match(/([\d.]+)%/);
  if (percentMatch) return parseFloat(percentMatch[1]!) * 0.16; // 100% = 16px
  
  if (/^[\d.]+$/.test(val)) {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) return num;
  }
  return undefined;
}

// ─── Extraction via DOM Parsing (browser-only) ───────────────────────

/**
 * Extract design tokens from an HTML string using the browser's DOM.
 * This is the primary extraction path when running in a browser.
 *
 * Strategy:
 *   1. Parse HTML with DOMParser
 *   2. Aggregate ALL CSS from <style> blocks
 *   3. Extract CSS custom properties (--var) — modern sites use these heavily
 *   4. Scan aggregated CSS for color/font/spacing patterns
 *   5. Also check inline styles on key elements (body, h1-h6, a, etc.)
 *   6. Cluster colors by luminance to pick bg/surface/text/accent
 */
function extractFromHTML(html: string, url: string, ctx: CanvasRenderingContext2D | null): ExtractedTheme {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Set the base URL so relative paths resolve
  const baseTag = doc.querySelector('base');
  if (!baseTag) {
    const base = doc.createElement('base');
    base.href = url;
    doc.head.prepend(base);
  }

  const title = doc.querySelector('title')?.textContent ?? url;

  // ── Aggregate all CSS ────────────────────────────────────────────────

  const allCSS: string[] = [];
  const styleBlocks = doc.querySelectorAll('style');
  for (const el of styleBlocks) {
    const css = el.textContent ?? '';
    if (css.length > 0) allCSS.push(css);
  }
  const combinedCSS = allCSS.join('\n');

  // ── Extract CSS Custom Properties ────────────────────────────────────

  const cssVars = extractCSSVariables(doc);

  // ── Extract colors from CSS ────────────────────────────────────────

  // We scan ALL color declarations and classify them by role heuristics.
  const allColors: string[] = [];

  // From CSS custom properties (most reliable for modern sites)
  const varColorPattern = /--[\w-]*color[\w-]*\s*:\s*([^;}\n]+)/gi;
  let varMatch: RegExpExecArray | null;
  while ((varMatch = varColorPattern.exec(combinedCSS)) !== null) {
    const val = varMatch[1]!.trim();
    if (val && val !== 'transparent' && val !== 'none' && val !== 'inherit' && val !== 'currentColor') {
      const hex = colorToHex(val, ctx);
      if (hex) allColors.push(hex);
    }
  }

  // From CSS property declarations (background-color, color, border-color, etc.)
  const colorProps = /(?:background-color|background|color|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke|accent-color|outline-color)\s*:\s*([^;}\n]+)/gi;
  let colorMatch: RegExpExecArray | null;
  while ((colorMatch = colorProps.exec(combinedCSS)) !== null) {
    const val = colorMatch[1]!.trim();
    if (val && val !== 'transparent' && val !== 'none' && val !== 'inherit' && val !== 'currentColor' && !val.includes('var(')) {
      const hex = colorToHex(val, ctx);
      if (hex) allColors.push(hex);
    }
  }

  // From hex colors directly in CSS
  const hexPattern = /#([0-9a-fA-F]{3,8})\b/g;
  let hexMatch: RegExpExecArray | null;
  while ((hexMatch = hexPattern.exec(combinedCSS)) !== null) {
    const hex = '#' + hexMatch[1]!;
    allColors.push(hex.length === 4 ? colorToHex(hex, ctx) : hex);
  }

  // From rgb/rgba in CSS
  const rgbPattern = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
  let rgbMatch: RegExpExecArray | null;
  while ((rgbMatch = rgbPattern.exec(combinedCSS)) !== null) {
    const r = parseInt(rgbMatch[1]!, 10);
    const g = parseInt(rgbMatch[2]!, 10);
    const b = parseInt(rgbMatch[3]!, 10);
    allColors.push(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`);
  }

  // ── Classify colors — structured approach ──────────────────────────

  // Build a frequency-sorted list of all discovered hex colors for fallback use
  const colorFreq = new Map<string, number>();
  for (const c of allColors) {
    if (c && c.startsWith('#')) {
      const normalized = c.length === 4
        ? '#' + c[1]! + c[1]! + c[2]! + c[2]! + c[3]! + c[3]!
        : c.toLowerCase();
      colorFreq.set(normalized, (colorFreq.get(normalized) ?? 0) + 1);
    }
  }
  const sortedColors = [...colorFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);

  // Strategy: Use the most specific signals first, fall back to heuristics.

  // 1. Check <meta name="theme-color"> — most reliable for modern sites
  const metaThemeColors: string[] = [];
  const metaTags = doc.querySelectorAll('meta[name="theme-color"]');
  for (const meta of metaTags) {
    const content = (meta as HTMLMetaElement).getAttribute('content');
    const media = (meta as HTMLMetaElement).getAttribute('media');
    if (content) {
      const hex = colorToHex(content, ctx);
      if (hex) {
        // Prefer dark-mode variant if it exists
        if (media && media.includes('dark')) {
          metaThemeColors.unshift(hex); // Put dark first
        } else {
          metaThemeColors.push(hex);
        }
      }
    }
  }

  // 2. Check body/html CSS declarations for background and color
  const bodyBgColors: string[] = [];
  const bodyTextColors: string[] = [];

  // Regex to find body { ... background(-color): VALUE } in CSS
  // We need to handle both `body{background:#fff}` and `body { background-color: #fff; }`
  const bodyBgPattern = /body\s*\{[^}]*?background(?:-color)?\s*:\s*([^;}\n]+)/gi;
  let bodyBgMatch: RegExpExecArray | null;
  while ((bodyBgMatch = bodyBgPattern.exec(combinedCSS)) !== null) {
    const val = bodyBgMatch[1]!.trim();
    if (val && val !== 'transparent' && val !== 'none' && !val.includes('var(')) {
      const hex = colorToHex(val, ctx);
      if (hex) bodyBgColors.push(hex);
    }
  }

  // Also check the full HTML (not just <style> blocks) since some
  // frameworks inline CSS directly in <style> without proper blocks
  const bodyBgInHtml = /body\s*\{[^}]*?background(?:-color)?\s*:\s*([^;}\n]+)/gi;
  let bodyBgHtmlMatch: RegExpExecArray | null;
  while ((bodyBgHtmlMatch = bodyBgInHtml.exec(html)) !== null) {
    const val = bodyBgHtmlMatch[1]!.trim();
    if (val && val !== 'transparent' && val !== 'none' && !val.includes('var(')) {
      const hex = colorToHex(val, ctx);
      if (hex && !bodyBgColors.includes(hex)) bodyBgColors.push(hex);
    }
  }

  // Body text color
  const bodyColorPattern = /body\s*\{[^}]*?(?<!background-)color\s*:\s*([^;}\n]+)/gi;
  let bodyColorMatch: RegExpExecArray | null;
  while ((bodyColorMatch = bodyColorPattern.exec(html)) !== null) {
    const val = bodyColorMatch[1]!.trim();
    if (val && val !== 'transparent' && val !== 'none' && val !== 'inherit' && !val.includes('var(')) {
      const hex = colorToHex(val, ctx);
      if (hex) bodyTextColors.push(hex);
    }
  }

  // 3. CSS custom properties for common design token names
  const varBg = resolveCSSVar(cssVars, [
    '--background', '--bg', '--bg-color', '--background-color', 
    '--color-bg', '--color-background', '--page-background', 
    '--bg-primary', '--sk-body-background-color',
  ], ctx);
  const varSurface = resolveCSSVar(cssVars, [
    '--surface', '--surface-color', '--card-bg', '--color-surface', 
    '--color-card', '--bg-secondary', '--sk-fill-secondary',
  ], ctx);
  const varText = resolveCSSVar(cssVars, [
    '--text', '--text-color', '--color-text', '--foreground', '--fg',
    '--text-primary', '--sk-body-text-color',
  ], ctx);
  const varTextSec = resolveCSSVar(cssVars, ['--text-secondary', '--text-muted', '--color-text-secondary', '--color-muted', '--muted'], ctx);
  const varAccent = resolveCSSVar(cssVars, ['--accent', '--accent-color', '--primary', '--primary-color', '--color-primary', '--color-accent', '--link', '--link-color'], ctx);
  const varBorder = resolveCSSVar(cssVars, ['--border', '--border-color', '--color-border', '--divider-color'], ctx);

  // 4. Determine background color — priority order:
  //    a) CSS var for bg
  //    b) meta theme-color (prefer dark variant)
  //    c) Last body background declaration (dark mode override comes last in CSS)
  //    d) Frequency-based fallback
  let bgHex: string | undefined = varBg;

  if (!bgHex && metaThemeColors.length > 0) {
    bgHex = metaThemeColors[0]!;
  }

  if (!bgHex && bodyBgColors.length > 0) {
    // If there are multiple body bg declarations, the last one is likely
    // the dark mode override (comes after light mode in CSS cascade)
    bgHex = bodyBgColors[bodyBgColors.length - 1]!;
  }

  if (!bgHex && sortedColors.length > 0) {
    // Fallback: pick the lightest color as the default background,
    // UNLESS the site is overwhelmingly dark (mode color is dark)
    const lightest = sortedColors.reduce((a, b) => luminance(a) > luminance(b) ? a : b);
    
    // Check the most frequent colors
    const mostFrequent = modeString(sortedColors);
    
    // If the most frequent color is very dark and there's no explicitly defined light bg,
    // assume it's a dark theme. Otherwise, assume light theme.
    if (mostFrequent && luminance(mostFrequent) < 0.1) {
      bgHex = mostFrequent;
    } else {
      bgHex = lightest;
    }
  }

  if (!bgHex) bgHex = '#000000';

  const isDarkBg = luminance(bgHex) < 0.5;

  // 5. Determine text color
  let textHex: string | undefined = varText;

  if (!textHex && bodyTextColors.length > 0) {
    // Pick the text color that contrasts with the bg
    textHex = bodyTextColors.find(c =>
      isDarkBg ? luminance(c) >= 0.5 : luminance(c) < 0.4
    ) ?? bodyTextColors[bodyTextColors.length - 1]!;
  }

  if (!textHex) {
    textHex = isDarkBg ? '#ffffff' : '#000000';
  }

  // 6. Secondary text
  let textSecHex: string | undefined = varTextSec;
  if (!textSecHex) {
    textSecHex = isDarkBg ? '#8b949e' : '#666666';
  }

  // 7. Accent color
  let accentHex: string | undefined = varAccent;
  if (!accentHex) {
    // Filter to mid-range luminance colors that aren't bg or text
    const accentCandidates = sortedColors.filter(c =>
      c !== bgHex && c !== textHex &&
      luminance(c) > 0.1 && luminance(c) < 0.9
    );
    accentHex = accentCandidates.length > 0 ? accentCandidates[0]! : (isDarkBg ? '#58a6ff' : '#4c6ef5');
  }

  // 8. Surface and border — derive from bg
  let surfaceHex: string | undefined = varSurface;
  if (!surfaceHex) {
    surfaceHex = isDarkBg ? lightenBg(bgHex) : darkenBg(bgHex);
  }

  let borderHex: string | undefined = varBorder;
  if (!borderHex) {
    borderHex = isDarkBg ? lightenBg(bgHex, 0.14) : darkenBg(bgHex, 0.12);
  }

  // ── Extract fonts from CSS ──────────────────────────────────────────

  // Scan for font-family declarations
  const fontFamilyPattern = /font-family\s*:\s*([^;}\n]+)/gi;
  const fontFamilies: string[] = [];
  let fontMatch: RegExpExecArray | null;
  while ((fontMatch = fontFamilyPattern.exec(combinedCSS)) !== null) {
    const raw = fontMatch[1]!.trim();
    const resolved = resolveNestedVar(raw, cssVars);
    
    // Split by comma, but respect quotes (naive split is okay if we just want the first font that isn't a var())
    // A better approach: take the first thing before a comma that isn't inside parentheses
    const parts = resolved.split(/,(?![^(]*\))/);
    const first = parts[0]!.trim().replace(/^["']|["']$/g, '');
    if (first && first !== 'inherit' && first !== 'initial' && first !== 'unset' && !first.startsWith('var(')) {
      fontFamilies.push(first);
    }
  }

  // Also check CSS vars for font families
  const varHeadingFont = resolveCSSVarString(cssVars, ['--heading-font', '--heading-font-family', '--font-heading', '--font-display', '--font-sans']);
  const varBodyFont = resolveCSSVarString(cssVars, ['--body-font', '--body-font-family', '--font-body', '--font-sans', '--font-default']);
  const varMonoFont = resolveCSSVarString(cssVars, ['--mono-font', '--mono-font-family', '--font-mono']);

  // Heading font: CSS var > most common font in headings > first font-family declaration
  const headingFamily = varHeadingFont ?? modeString(fontFamilies) ?? 'Inter';
  const bodyFamily = varBodyFont ?? modeString(fontFamilies) ?? 'Inter';
  const monoFamily = varMonoFont ?? '"JetBrains Mono", monospace';

  // ── Extract font sizes from CSS ────────────────────────────────────

  const varH1Size = resolveCSSVarNumber(cssVars, ['--h1-size', '--font-size-h1', '--heading-1-size']);
  const varH2Size = resolveCSSVarNumber(cssVars, ['--h2-size', '--font-size-h2', '--heading-2-size']);
  const varH3Size = resolveCSSVarNumber(cssVars, ['--h3-size', '--font-size-h3', '--heading-3-size']);
  const varBodySize = resolveCSSVarNumber(cssVars, ['--body-size', '--font-size-body', '--font-size-base']);

  // Scan CSS for font-size declarations
  const h1SizeMatch = combinedCSS.match(/h1\s*\{[^}]*font-size\s*:\s*([^;}\n]+)/);
  const h2SizeMatch = combinedCSS.match(/h2\s*\{[^}]*font-size\s*:\s*([^;}\n]+)/);
  const h3SizeMatch = combinedCSS.match(/h3\s*\{[^}]*font-size\s*:\s*([^;}\n]+)/);
  const bodySizeMatch = combinedCSS.match(/body\s*\{[^}]*font-size\s*:\s*([^;}\n]+)/);

  const h1Size = varH1Size ?? parseFontSize(h1SizeMatch?.[1]) ?? 42;
  const h2Size = varH2Size ?? parseFontSize(h2SizeMatch?.[1]) ?? 24;
  const h3Size = varH3Size ?? parseFontSize(h3SizeMatch?.[1]) ?? 20;
  const bodySize = varBodySize ?? parseFontSize(bodySizeMatch?.[1]) ?? 14;

  // Font weight
  const varHeadingWeight = resolveCSSVarNumber(cssVars, ['--heading-weight', '--font-weight-heading']);
  const h1WeightMatch = combinedCSS.match(/h1\s*\{[^}]*font-weight\s*:\s*(\d+)/);
  const headingWeight = varHeadingWeight ?? (h1WeightMatch ? parseInt(h1WeightMatch[1]!, 10) : 700);

  // Line height
  const varLH = resolveCSSVarNumber(cssVars, ['--line-height', '--line-height-body', '--body-line-height']);
  const bodyLHMatch = combinedCSS.match(/body\s*\{[^}]*line-height\s*:\s*([^;}\n]+)/);
  let bodyLineHeight = varLH ?? 1.5;
  if (bodyLHMatch) {
    const parsed = parseFloat(bodyLHMatch[1]!);
    if (!isNaN(parsed) && parsed > 1) bodyLineHeight = parsed;
  }

  // ── Extract spacing from CSS ────────────────────────────────────────

  const varSpacing = resolveCSSVarNumber(cssVars, ['--spacing', '--spacing-unit', '--space-unit', '--space']);
  const varGap = resolveCSSVarNumber(cssVars, ['--gap', '--spacing-gap', '--space-gap']);

  // Scan for common spacing patterns in CSS
  const spacingValues: number[] = [];
  const spacingPattern = /(?:padding|gap|margin)\s*:\s*([^;}\n]+)/gi;
  let spacingMatch: RegExpExecArray | null;
  while ((spacingMatch = spacingPattern.exec(combinedCSS)) !== null) {
    const val = spacingMatch[1]!.trim();
    const px = parsePxValue(val);
    if (px > 0 && px < 100) spacingValues.push(px);
  }

  const spacingUnit = varSpacing ?? (mode(spacingValues) as number) ?? 8;
  const sectionGap = varGap ?? Math.round((spacingValues.reduce((a, b) => a + b, 0) / (spacingValues.length || 1)));
  const paragraphGap = Math.round(spacingUnit * 1.5);

  // ── Extract surfaces from CSS ────────────────────────────────────────

  const varRadius = resolveCSSVarNumber(cssVars, ['--radius', '--border-radius', '--radius-md']);

  const borderRadiusCandidates: number[] = [];
  const radiusPattern = /border-radius\s*:\s*([^;}\n]+)/gi;
  let radiusMatch: RegExpExecArray | null;
  while ((radiusMatch = radiusPattern.exec(combinedCSS)) !== null) {
    const px = parsePxValue(radiusMatch[1]!);
    if (px > 0 && px < 50) borderRadiusCandidates.push(px);
  }
  const borderRadius = varRadius ?? (mode(borderRadiusCandidates) as number) ?? 8;

  const cardShadow = modeString(
    [...combinedCSS.matchAll(/box-shadow\s*:\s*([^;}\n]+)/gi)].map(m => m[1]!.trim()).filter(s => s && s !== 'none')
  ) ?? '';

  // ── Build result ────────────────────────────────────────────────────

  return {
    url,
    title: title.trim(),
    colors: {
      background: bgHex,
      surface: surfaceHex!,
      text: textHex!,
      textSecondary: textSecHex!,
      accent: accentHex!,
      border: borderHex!,
    },
    typography: {
      headingFamily,
      bodyFamily,
      monoFamily,
      h1Size,
      h2Size,
      h3Size,
      bodySize,
      bodyLineHeight,
      headingWeight,
    },
    spacing: {
      unit: spacingUnit,
      sectionGap: sectionGap > 0 ? sectionGap : 24,
      paragraphGap,
    },
    surfaces: {
      borderRadius,
      cardBg: surfaceHex!,
      cardShadow,
    },
    cssVariables: cssVars,
  };
}

// ─── Style attribute extraction helper ───────────────────────────────

// ─── CSS-based extraction fallback ────────────────────────────────────

// extractFromHTML now handles both inline + <style> CSS extraction in one pass.
// The preferCSS option is kept for backwards compatibility but currently
// calls the same extraction logic.

// ─── Public API ──────────────────────────────────────────────────────

export interface ExtractionOptions {
  /** CORS proxy URL template. {url} is replaced with the encoded target URL.
   *  Defaults to https://api.allorigins.win/raw?url={url} */
  proxyUrl?: string;
  /** Whether to prefer CSS-only extraction over iframe (default: false) */
  preferCSS?: boolean;
  /** Optional Canvas 2D context for color parsing. Created if not provided. */
  colorContext?: CanvasRenderingContext2D | null;
}

/**
 * Fetch a website URL and extract its design tokens.
 *
 * Workflow:
 *   1. Try direct fetch
 *   2. On CORS failure, retry through a CORS proxy
 *   3. Parse HTML and extract design tokens from inline styles,
 *      <style> blocks, and structural element patterns
 *   4. Return an `ExtractedTheme` suitable for mapping to ThemeConfig
 *
 * @param url - The website URL to extract theme from
 * @param options - Extraction configuration
 * @returns ExtractedTheme with design tokens
 */
export async function extractThemeFromURL(
  url: string,
  options?: ExtractionOptions,
): Promise<ExtractedTheme> {
  // Get or create Canvas context for color parsing
  let ctx = options?.colorContext;
  if (!ctx) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      ctx = canvas.getContext('2d');
    } catch {
      // Not in browser — colorToHex will use regex fallback
      ctx = null;
    }
  }

  // ── Fetch HTML with multiple fallback strategies ────────────────────

  // CORS proxy services — tried in order if direct fetch fails.
  // codetabs is first because it's the most reliable for SSR sites.
  // Each returns raw HTML. The {url} placeholder gets URL-encoded.
  const CORS_PROXIES = [
    'https://api.codetabs.com/v1/proxy?quest={url}',
    'https://api.allorigins.win/raw?url={url}',
  ];

  // Custom proxy from options takes priority
  const customProxy = options?.proxyUrl;

  let html: string | null = null;
  let lastError: string = '';

  /**
   * Validate that a fetched HTML string looks like real website HTML
   * and not an error page from the proxy/CDN itself.
   * Checks for minimum length and presence of actual content indicators.
   */
  function isValidHTML(text: string, targetUrl: string): boolean {
    // Too short to be a real page
    if (text.length < 200) return false;
    // Cloudflare/proxy error pages
    if (text.includes('cloudflare') && text.includes('Error code')) return false;
    // Must contain <html or <!DOCTYPE
    if (!text.includes('<html') && !text.includes('<!DOCTYPE') && !text.includes('<!doctype')) return false;
    // Should have at least some CSS (inline or <style>) or <script> tags
    // A totally empty shell is probably an error page
    const hostname = new URL(targetUrl).hostname;
    // If the HTML mentions the target domain, it's probably legit
    if (text.includes(hostname)) return true;
    // If it has <style> blocks or significant content, it's probably legit
    if (text.includes('<style') || text.length > 5000) return true;
    return false;
  }

  // Strategy 1: Direct fetch (works for same-origin or CORS-enabled sites)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await fetch(url, {
      mode: 'cors',
      headers: { 'Accept': 'text/html' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (response.ok) {
      const text = await response.text();
      if (isValidHTML(text, url)) {
        html = text;
      } else {
        lastError = 'Direct fetch returned invalid HTML';
      }
    } else {
      lastError = `HTTP ${response.status}`;
    }
  } catch (err: unknown) {
    lastError = err instanceof Error ? err.message : 'CORS blocked';
  }

  // Strategy 2: Try CORS proxies in order
  if (html === null) {
    const proxies = customProxy ? [customProxy, ...CORS_PROXIES] : CORS_PROXIES;

    for (const proxyTemplate of proxies) {
      try {
        const proxyUrl = proxyTemplate.replace('{url}', encodeURIComponent(url));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const response = await fetch(proxyUrl, {
          headers: { 'Accept': 'text/html' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const text = await response.text();
          if (isValidHTML(text, url)) {
            html = text;
            break; // Success — stop trying proxies
          } else {
            lastError = `Proxy returned error page, not target HTML`;
          }
        } else {
          lastError = `Proxy returned HTTP ${response.status}`;
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : 'Proxy failed';
        // Continue to next proxy
      }
    }
  }

  if (html === null) {
    throw new Error(
      `Could not fetch ${url}. Tried direct + ${CORS_PROXIES.length} proxies. Last error: ${lastError}. ` +
      `Tip: Check the URL, or try copying the page source and using extractThemeFromHTML() instead.`,
    );
  }

  // ── Extract ────────────────────────────────────────────────────────

  // Parse HTML to find external stylesheets
  let combinedHtml = html;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const baseTag = doc.createElement('base');
    baseTag.href = url;
    doc.head.prepend(baseTag);

    const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
    
    // Fetch external CSS via proxy
    const cssPromises = links.map(async (link) => {
      try {
        const cssUrl = link.href;
        if (!cssUrl || cssUrl.startsWith('data:')) return '';
        
        // Use codetabs proxy for CSS
        const proxyUrl = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent(cssUrl);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5_000);
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeout);
        
        if (res.ok) {
          const text = await res.text();
          // Verify it's actually CSS, not an HTML error page
          if (!text.includes('<html') && text.length > 10) {
            return text;
          }
        }
      } catch (err) {
        // Ignore errors fetching individual stylesheets
      }
      return '';
    });

    const cssContents = await Promise.all(cssPromises);
    
    // Append fetched CSS as <style> blocks to the HTML string
    let stylesToAppend = '';
    for (const css of cssContents) {
      if (css) {
        stylesToAppend += `\n<style>\n${css}\n</style>\n`;
      }
    }
    
    if (stylesToAppend) {
      combinedHtml += stylesToAppend;
    }
  } catch (err) {
    // If DOMParser fails (e.g. in Node without JSDOM), just proceed with raw HTML
    console.warn('[Theme Extraction] Could not fetch external CSS:', err);
  }

  // Both paths now use the same CSS-aware extraction
  return extractFromHTML(combinedHtml, url, ctx);
}

/**
 * Extract theme from raw HTML string.
 * Useful when you already have the HTML and don't need to fetch.
 *
 * @param html - The raw HTML string
 * @param sourceUrl - The source URL (used for resolving relative paths)
 * @param colorContext - Optional Canvas 2D context for color parsing
 */
export function extractThemeFromHTML(
  html: string,
  sourceUrl?: string,
  colorContext?: CanvasRenderingContext2D | null,
): ExtractedTheme {
  return extractFromHTML(html, sourceUrl ?? 'about:blank', colorContext ?? null);
}