import { A, B, G, P, R, S, W, wrapLandmark } from './shared'
import { extraRepresentatives, extraSilhouettes } from './national-extras'

// Small always-available silhouettes; province packs supply the detailed place portraits.
const silhouettes: Readonly<Record<string, string>> = {
  ...extraSilhouettes,
  'cn-11': `<path d="M12 40h56v20H12Z" fill="${R}"/><path d="m6 41 14-13h40l14 13ZM23 28l17-12 17 12Z" fill="${A}"/><path d="M34 60V46h12v14" fill="${P}"/>`,
  'cn-51': `<path d="M23 14C10 29 5 45 8 60h64c2-17-6-33-16-46Z" fill="${W}"/><path d="M40 27 23 60h34Z" fill="${G}"/><path d="m40 27-5 18h11Z" fill="${A}"/><path d="M22 40 16 54m42-14 7 14" stroke="${P}" stroke-width="3"/>`,
  'cn-33': `<ellipse cx="40" cy="51" rx="33" ry="10" fill="${W}"/><path d="M43 46V19h15v27Z" fill="${P}"/><path d="m39 20 11-9 12 9m-23 9h23m-23 9h23" fill="${S}"/><path d="M13 48h20l-5 6H18Z" fill="${R}"/>`,
  'cn-35': `<path d="M9 35v17c0 16 62 16 62 0V35" fill="${A}"/><ellipse cx="40" cy="35" rx="31" ry="14" fill="${S}"/><ellipse cx="40" cy="35" rx="17" ry="7" fill="${P}"/><path d="M36 63v-9h8v9" fill="${R}"/>`,
  'cn-45': `<path d="M6 50 14 29l7-9 9 30 9-30 7-7 8 37 8-22 7 7 6 15Z" fill="${G}"/><path d="M6 50c19-6 37 6 68 0v10H6Z" fill="${W}"/><path d="M27 55h22" stroke="${R}" stroke-width="3"/>`,
  'cn-62': `<path d="m5 58 13-21 13-6 14-18 14 13 16 32Z" fill="${A}"/><path d="m12 48 20-7 12-15 21 18m-48 11 22-8 12-11 20 17" stroke="${R}" stroke-width="5"/>`,
  'cn-52': `<path d="M9 57V26l14-8 20 6 16-6 13 12v27Z" fill="${S}"/><path d="M23 26c10 3 22 3 34 0v26l9 7H15l8-7Z" fill="${W}"/><path d="M32 32v19m8-18v20m9-21v19" stroke="${P}" stroke-width="3"/>`,
  'cn-65': `<path d="m6 44 16-22 10 9 14-21 28 35" fill="${B}"/><path d="m46 10-9 14 8-3 5 5 6-1Z" fill="${P}"/><ellipse cx="40" cy="51" rx="30" ry="11" fill="${W}"/><path d="M22 51h19m3 5h14" stroke="${P}"/>`,
}
const icons = new Map(Object.entries(silhouettes).map(([id, silhouette]) => [id, wrapLandmark({ silhouette, detail: '' }, true)]))
const representatives: Readonly<Record<string, string>> = {
  ...extraRepresentatives,
  'cn-11': 'beijing-forbidden-city', 'cn-51': 'sichuan-dujiangyan',
  'cn-33': 'zhejiang-west-lake', 'cn-35': 'fujian-tianluokeng',
  'cn-45': 'guangxi-li-river', 'cn-62': 'gansu-zhangye-danxia',
  'cn-52': 'guizhou-huangguoshu', 'cn-65': 'xinjiang-tianchi',
}
export function nationalLandmarkId(provinceId: unknown): string | undefined {
  return typeof provinceId === 'string' && Object.prototype.hasOwnProperty.call(representatives, provinceId) ? representatives[provinceId] : undefined
}
export function nationalLandmarkSvg(provinceId: unknown, variantId?: unknown): string | undefined {
  if (typeof provinceId !== 'string' || !Object.prototype.hasOwnProperty.call(representatives, provinceId)) return undefined
  // A province symbol must never silently become a different named place's portrait.
  if (variantId !== representatives[provinceId]) return undefined
  return icons.get(provinceId)
}
