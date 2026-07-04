import { CATEGORICAL, BRAND_TILE_BG } from '../color/palette'

// The logo: a tiny colored alignment tile (residues + one faded gap). Colors
// come from the shared categorical palette so the brand teal is the accent teal.
const [TEAL, AMBER, INDIGO, CORAL] = CATEGORICAL

const CELLS: [number, number, string, number?][] = [
  [14, 16, TEAL], [33, 16, AMBER], [52, 16, INDIGO], [71, 16, CORAL],
  [14, 40, AMBER], [33, 40, INDIGO], [52, 40, TEAL, 0.22], [71, 40, TEAL],
  [14, 64, INDIGO], [33, 64, CORAL], [52, 64, AMBER], [71, 64, TEAL],
]

/** Brand mark used in the toolbar and the About dialog. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <rect width="100" height="100" rx="22" fill={BRAND_TILE_BG} />
      {CELLS.map(([x, y, fill, op], i) => (
        <rect key={i} x={x} y={y} width="15" height="18" rx="3" fill={fill} opacity={op ?? 1} />
      ))}
    </svg>
  )
}
