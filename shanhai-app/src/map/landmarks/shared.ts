/** Shared ink and paper palette. All path data comes from authored modules only. */
export const P = '#FBF8EF', I = '#163D3A', G = '#CCDCC8', W = '#A9CED3'
export const R = '#A23E34', A = '#D2AE65', S = '#849F98', B = '#7199AA'
export interface LandmarkDrawing { silhouette: string; detail: string }
export type LandmarkPack = Readonly<Record<string, LandmarkDrawing>>

export function wrapLandmark(drawing: LandmarkDrawing, simple = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 72" aria-hidden="true" focusable="false" data-anchor-x="40" data-anchor-y="68"><g fill="none" stroke="${I}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="40" cy="62" rx="27" ry="3" fill="${G}" stroke="none"/>${drawing.silhouette}${simple ? '' : `<g data-detail="true">${drawing.detail}</g>`}<path d="M40 63v3"/><circle cx="40" cy="68" r="2" fill="${I}" stroke="${P}" stroke-width="1"/></g></svg>`
}
