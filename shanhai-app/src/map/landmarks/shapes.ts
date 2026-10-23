/** Composition primitives, called only by authored local packs with literal geometry. */
export { A, B, G, I, P, R, S, W } from './shared'
import { P, S, type LandmarkDrawing } from './shared'
export const path = (d: string, fill = 'none', stroke?: string): string => `<path d="${d}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}/>`
export const rect = (x: number, y: number, width: number, height: number, fill = P): string => `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}"/>`
export const ellipse = (cx: number, cy: number, rx: number, ry: number, fill = P): string => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"/>`
export const circle = (cx: number, cy: number, r: number, fill = P): string => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`
export const house = (x: number, y: number, w: number, h: number, roof = S): string => rect(x, y, w, h) + path(`M${x - 4} ${y + 1} ${x + w / 2} ${y - 10} ${x + w + 4} ${y + 1}Z`, roof)
export const scene = (silhouette: string, detail: string): LandmarkDrawing => ({ silhouette, detail })
