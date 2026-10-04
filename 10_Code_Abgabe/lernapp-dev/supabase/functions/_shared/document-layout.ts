export interface PositionedText {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

/** Conservative routing signals, not a semantic diagram/table classifier. */
export function legacyPageReasons(
  items: PositionedText[],
  operatorNames: string[],
  structure: unknown,
): string[] {
  const reasons = new Set<string>();
  if (operatorNames.some((op) => /image/i.test(op))) reasons.add('image_present');
  if (
    operatorNames.some((op) =>
      /^(constructPath|shadingFill|fill|eoFill|stroke|closeStroke|fillStroke|eoFillStroke|closeFillStroke|closeEOFillStroke)$/i.test(
        op,
      ),
    )
  )
    reasons.add('vector_graphics');
  const text = items.map((i) => i.str).join(' ');
  if (
    text.includes('\uFFFD') ||
    Array.from(text).some((c) => c.charCodeAt(0) > 0 && c.charCodeAt(0) < 9)
  )
    reasons.add('poor_text');
  if (/[=∑∫√∂∏≈≠≤≥^]|\\(?:frac|sum|int)\b/.test(text)) reasons.add('formula_candidate');
  if (items.some((i) => /math|symbol|cmmi|cmsy/i.test(i.fontName)))
    reasons.add('formula_candidate');
  // Multiple separate text runs at the same baseline can be cells or columns.
  const rows = new Map<number, PositionedText[]>();
  for (const item of items.filter((i) => i.str.trim())) {
    if (!item.transform.every(Number.isFinite) || item.transform.length !== 6) {
      reasons.add('layout_uncertain');
      continue;
    }
    const [a, b, c, d, , y] = item.transform;
    if (Math.abs(b) > 0.1 || Math.abs(c) > 0.1 || a <= 0 || d <= 0) reasons.add('layout_uncertain');
    const baseline = Math.round(y / 3);
    rows.set(baseline, [...(rows.get(baseline) ?? []), item]);
  }
  for (const row of rows.values()) {
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    if (
      row.some(
        (item, i) => i > 0 && item.transform[4] - (row[i - 1].transform[4] + row[i - 1].width) > 10,
      )
    )
      reasons.add('table_or_columns');
    if (new Set(row.map((i) => Math.round(i.height))).size > 1) reasons.add('layout_uncertain');
  }
  const tagged = JSON.stringify(structure ?? null);
  if (/"(?:Table|TR|TH|TD)"/.test(tagged)) reasons.add('table_candidate');
  if (/"(?:Figure|Formula)"/.test(tagged)) reasons.add('visual_structure');
  if (!text.trim() && operatorNames.some((op) => /showText/i.test(op))) reasons.add('poor_text');
  return [...reasons];
}

export interface PageGraphics {
  imageArea: number;
  bodyImageArea: number;
  vectorShapes: number;
  vectorArea: number;
  unknownImages: boolean;
}
/** PDF.js 5/unpdf 1.8: transform unit image squares into page coordinates.
 * Ignore clipping paths, page backgrounds and thin horizontal/vertical decorations.
 */
export function pageGraphics(names: string[], args: unknown[][], view: number[]): PageGraphics {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const [left, bottom, right, top] = view;
  const area = (right - left) * (top - bottom);
  const result: PageGraphics = {
    imageArea: 0,
    bodyImageArea: 0,
    vectorShapes: 0,
    vectorArea: 0,
    unknownImages: false,
  };
  const bounds = (x0: number, y0: number, x1: number, y1: number) => {
    const points = [
      [x0, y0],
      [x0, y1],
      [x1, y0],
      [x1, y1],
    ].map(([x, y]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ]);
    return [
      Math.max(left, Math.min(...points.map((p) => p[0]))),
      Math.max(bottom, Math.min(...points.map((p) => p[1]))),
      Math.min(right, Math.max(...points.map((p) => p[0]))),
      Math.min(top, Math.max(...points.map((p) => p[1]))),
    ];
  };
  for (let i = 0; i < names.length; i++) {
    const op = names[i],
      a = args[i];
    if (op === 'save') stack.push([...matrix]);
    else if (op === 'restore') matrix = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    else if (op === 'transform') {
      const [a0, b, c, d, e, f] = a as number[],
        m = matrix;
      matrix = [
        m[0] * a0 + m[2] * b,
        m[1] * a0 + m[3] * b,
        m[0] * c + m[2] * d,
        m[1] * c + m[3] * d,
        m[0] * e + m[2] * f + m[4],
        m[1] * e + m[3] * f + m[5],
      ];
    } else if (/image/i.test(op)) {
      if (
        ![
          'paintImageXObject',
          'paintInlineImageXObject',
          'paintImageMaskXObject',
          'paintSolidColorImageMask',
        ].includes(op)
      ) {
        result.unknownImages = true;
        continue;
      }
      const [x0, y0, x1, y1] = bounds(0, 0, 1, 1);
      const fraction = (Math.max(0, x1 - x0) * Math.max(0, y1 - y0)) / area;
      result.imageArea = Math.max(result.imageArea, fraction);
      const margin = y1 < bottom + (top - bottom) * 0.12 || y0 > top - (top - bottom) * 0.12;
      if (!margin || fraction > 0.025) result.bodyImageArea += fraction;
    } else if (op === 'constructPath' && a[0] !== 28 && a[0] !== 29 && a[2]) {
      const b = Array.from(a[2] as ArrayLike<number>);
      if (b.length !== 4 || !b.every(Number.isFinite)) continue;
      const [x0, y0, x1, y1] = bounds(b[0], b[1], b[2], b[3]);
      const margin = y1 < bottom + (top - bottom) * 0.12 || y0 > top - (top - bottom) * 0.12;
      const w = x1 - x0,
        h = y1 - y0,
        fraction = (w * h) / area;
      if (!(margin && fraction < 0.025) && w > 3 && h > 3 && fraction < 0.85 && fraction > 0.0005) {
        result.vectorShapes++;
        result.vectorArea += fraction;
      }
    }
  }
  return result;
}
export function pageReasons(
  items: PositionedText[],
  names: string[],
  structure: unknown,
  graphics?: PageGraphics,
): string[] {
  const legacy = legacyPageReasons(items, names, structure);
  const reasons = new Set(legacy.filter((r) => ['poor_text', 'table_candidate'].includes(r)));
  if (/"Formula"/.test(JSON.stringify(structure ?? null))) reasons.add('formula_structure');
  const meaningful = items.filter((i) => i.str.trim());
  // URL punctuation (=, query parameters, superscript-like fragmented URLs) is not mathematics.
  const text = meaningful
    .map((i) => i.str)
    .join(' ')
    .replace(/https?:\/\/\S+/g, '');
  if (
    /[∑∫√∂∏≈≠≤≥]|[\w)\]]\s*[=^]\s*[-+\w(]|\\(?:frac|sum|int)\b/.test(text) ||
    meaningful.some((i) => /math|symbol|cmmi|cmsy/i.test(i.fontName))
  )
    reasons.add('formula_candidate');
  const rows = new Map<number, PositionedText[]>();
  for (const i of meaningful) {
    if (i.transform.length !== 6 || !i.transform.every(Number.isFinite)) {
      reasons.add('invalid_geometry');
      continue;
    }
    const y = Math.round(i.transform[5] / 3);
    rows.set(y, [...(rows.get(y) ?? []), i]);
  }
  let separatedRows = 0;
  for (const row of rows.values()) {
    row.sort((a, b) => a.transform[4] - b.transform[4]);
    if (
      row.some(
        (item, i) =>
          i > 0 &&
          item.transform[4] - (row[i - 1].transform[4] + row[i - 1].width) >
            Math.max(18, item.height * 1.5),
      )
    )
      separatedRows++;
  }
  if (separatedRows >= 3 || (separatedRows >= 2 && meaningful.length <= 12))
    reasons.add('repeated_columns');
  // Nearby small runs at shifted baselines preserve meaningful subscripts/exponents.
  const sorted = [...meaningful].sort((a, b) => a.transform[4] - b.transform[4]);
  for (let i = 0; i < sorted.length; i++) {
    const small = sorted[i];
    if (!/^[\dA-Za-z+−-]{1,5}$/.test(small.str)) continue;
    for (let j = Math.max(0, i - 12); j < Math.min(sorted.length, i + 12); j++) {
      const big = sorted[j],
        dy = Math.abs(small.transform[5] - big.transform[5]);
      const gap = Math.min(
        Math.abs(small.transform[4] - (big.transform[4] + big.width)),
        Math.abs(big.transform[4] - (small.transform[4] + small.width)),
      );
      if (
        big.height > small.height * 1.25 &&
        small.height > 0 &&
        dy > small.height * 0.2 &&
        dy < big.height * 0.85 &&
        gap < big.height * 0.4 &&
        /[\dA-Za-z)]/.test(big.str)
      )
        reasons.add('script_geometry');
    }
  }
  if (graphics) {
    if (graphics.imageArea >= 0.15) reasons.add('large_image_or_scan');
    else if (graphics.bodyImageArea >= 0.003) reasons.add('body_image');
    if (
      legacy.includes('visual_structure') &&
      (graphics.bodyImageArea >= 0.003 || graphics.vectorShapes >= 2)
    )
      reasons.add('visual_structure');
    if (graphics.unknownImages) reasons.add('unresolved_image_geometry');
    if (graphics.vectorShapes >= 3 && graphics.vectorArea >= 0.015) reasons.add('diagram_geometry');
    if (graphics.vectorShapes >= 1 && graphics.vectorArea >= 0.08)
      reasons.add('large_vector_graphic');
  } else if (names.some((op) => /image/i.test(op))) reasons.add('image_geometry_unavailable');
  if (legacy.includes('layout_uncertain') && (separatedRows >= 2 || reasons.size > 0))
    reasons.add('combined_layout');
  return [...reasons];
}
