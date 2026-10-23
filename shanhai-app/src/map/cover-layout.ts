export interface Rect { x: number; y: number; width: number; height: number }
export interface CoverMarker extends Rect {
  id: string
  /** x/y are the artwork rectangle's top-left; anchors are absolute container
   * pixels (not icon-relative offsets). Neither is changed by this layout. */
  anchorX: number
  anchorY: number
  hasCover: boolean
  selected?: boolean
}
export interface CoverPlacement extends Rect { compact: boolean }

const GAP = 4, EDGE = 8
const REGULAR = { width: 48, height: 44, compact: false }
const COMPACT = { width: 44, height: 44, compact: true }
const finite = (...values: number[]) => values.every(Number.isFinite)
const validRect = (rect: Rect) => finite(rect.x, rect.y, rect.width, rect.height, rect.x + rect.width, rect.y + rect.height) && rect.width > 0 && rect.height > 0
const compareId = (a: CoverMarker, b: CoverMarker) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const separated = (a: Rect, b: Rect) =>
  a.x + a.width + GAP <= b.x || b.x + b.width + GAP <= a.x ||
  a.y + a.height + GAP <= b.y || b.y + b.height + GAP <= a.y
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Names can move around a fixed geographic symbol; the symbol never moves.
 * Reserve actual label widths instead of an invisible 172px strip per place. */
export function layoutMapLabels(
  markers: readonly (CoverMarker & { labelWidth: number })[],
  viewport: { width: number; height: number },
  obstacles: readonly Rect[] = [],
): Map<string, Rect> {
  const result = new Map<string, Rect>()
  if (!finite(viewport.width, viewport.height) || viewport.width <= EDGE * 2 || viewport.height <= EDGE * 2) return result
  const blocked = [...markers.filter(validRect), ...obstacles.filter(validRect)]
  const ordered = markers.filter(marker => validRect(marker) && finite(marker.labelWidth, marker.anchorX, marker.anchorY) && marker.labelWidth > 0)
    .slice().sort((a, b) => Number(b.selected === true) - Number(a.selected === true) || compareId(a, b))
  for (const marker of ordered) {
    const width = Math.min(172, marker.labelWidth), height = 29
    const x = clamp(marker.anchorX - width / 2, EDGE, viewport.width - EDGE - width)
    const middle = marker.y + (marker.height - height) / 2
    const candidates = [
      { x, y: marker.y + marker.height + 6, width, height },
      { x, y: marker.y - height - 6, width, height },
      { x: marker.x + marker.width + 6, y: middle, width, height },
      { x: marker.x - width - 6, y: middle, width, height },
    ]
    const placed = candidates.find(rect => rect.x >= EDGE && rect.y >= EDGE &&
      rect.x + width <= viewport.width - EDGE && rect.y + height <= viewport.height - EDGE &&
      blocked.every(obstacle => separated(rect, obstacle)))
    if (placed) { result.set(marker.id, placed); blocked.push(placed) }
  }
  return result
}

/** Place small photo stacks around immutable landmark rectangles. Every valid
 * landmark remains an obstacle, including ones without photos or valid anchors.
 * Invalid/ambiguous markers receive no photo; hiding a cover never moves or
 * deletes its landmark. Caller also supplies label/control/cluster obstacles. */
export function layoutMapCovers(
  markers: readonly CoverMarker[],
  viewport: { width: number; height: number },
  obstacles: readonly Rect[] = [],
  previousOffsets: ReadonlyMap<string, CoverPlacement> = new Map(),
): Map<string, CoverPlacement> {
  const result = new Map<string, CoverPlacement>()
  if (!finite(viewport.width, viewport.height) || viewport.width < COMPACT.width + EDGE * 2 || viewport.height < COMPACT.height + EDGE * 2) return result
  const blocked: Rect[] = [...markers.filter(validRect), ...obstacles.filter(validRect)]
  const idCounts = new Map<string, number>()
  for (const marker of markers) idCounts.set(marker.id, (idCounts.get(marker.id) ?? 0) + 1)
  const eligible = markers.filter(marker => marker.hasCover === true && !!marker.id && idCounts.get(marker.id) === 1 &&
    validRect(marker) && finite(marker.anchorX, marker.anchorY) &&
    marker.anchorX >= 0 && marker.anchorX <= viewport.width && marker.anchorY >= 0 && marker.anchorY <= viewport.height).slice().sort((a, b) =>
      Number(b.selected === true) - Number(a.selected === true) || compareId(a, b))
  const sizes = viewport.width <= 400 ? [COMPACT] : [REGULAR, COMPACT]

  function fits(rect: Rect) {
    return validRect(rect) && rect.x >= EDGE && rect.y >= EDGE &&
      rect.x + rect.width <= viewport.width - EDGE && rect.y + rect.height <= viewport.height - EDGE &&
      blocked.every(obstacle => separated(rect, obstacle))
  }
  for (const marker of eligible) {
    const previous = previousOffsets.get(marker.id)
    const retained = previous && { ...previous, x: marker.anchorX + previous.x, y: marker.anchorY + previous.y }
    let placed: CoverPlacement | undefined = retained && fits(retained) && sizes.some(size => size.width === retained.width) ? retained : undefined
    for (const size of sizes) {
      if (placed) break
      const sideY = clamp(marker.y + (marker.height - size.height) / 2, EDGE, viewport.height - EDGE - size.height)
      const candidates: CoverPlacement[] = [
        { x: marker.x + marker.width + GAP, y: sideY, ...size },
        { x: marker.x - GAP - size.width, y: sideY, ...size },
        { x: clamp(marker.anchorX - size.width / 2, EDGE, viewport.width - EDGE - size.width), y: Math.max(marker.y + marker.height, marker.anchorY) + GAP, ...size },
      ]
      placed = candidates.find(fits)
      if (placed) break
    }
    if (placed) { result.set(marker.id, placed); blocked.push(placed) }
  }
  return result
}
