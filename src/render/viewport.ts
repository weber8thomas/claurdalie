// Pure viewport-virtualization math. No DOM — unit-testable.

export interface VisibleRange {
  firstRow: number
  lastRow: number // exclusive
  firstCol: number
  lastCol: number // exclusive
}

export interface ViewportParams {
  scrollX: number
  scrollY: number
  cellW: number
  cellH: number
  gridWidthPx: number // available grid area (excludes gutter)
  gridHeightPx: number // available grid area (excludes ruler)
  rows: number
  cols: number
  overscan?: number
}

/** Compute the visible cell range, clamped to the alignment bounds, with overscan. */
export function computeVisible(p: ViewportParams): VisibleRange {
  const over = p.overscan ?? 1
  const firstCol = Math.max(0, Math.floor(p.scrollX / p.cellW) - over)
  const lastCol = Math.min(p.cols, Math.ceil((p.scrollX + p.gridWidthPx) / p.cellW) + over)
  const firstRow = Math.max(0, Math.floor(p.scrollY / p.cellH) - over)
  const lastRow = Math.min(p.rows, Math.ceil((p.scrollY + p.gridHeightPx) / p.cellH) + over)
  return { firstRow, lastRow, firstCol, lastCol }
}

/** Maximum scroll offsets so content stays in view. */
export function maxScroll(p: {
  cols: number
  rows: number
  cellW: number
  cellH: number
  gridWidthPx: number
  gridHeightPx: number
}): { x: number; y: number } {
  return {
    x: Math.max(0, p.cols * p.cellW - p.gridWidthPx),
    y: Math.max(0, p.rows * p.cellH - p.gridHeightPx),
  }
}

/** Clamp a scroll offset into range. */
export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}
