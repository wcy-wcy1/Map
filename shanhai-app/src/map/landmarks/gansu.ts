import { A, B, G, I, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'gansu-mogao': {
    silhouette: `<path d="M5 60V24l13-10 23 3 14-7 20 10v40Z" fill="${A}"/><path d="M27 60V24h27v36Z" fill="${R}"/><path d="m23 25 8-7h19l8 7m-35 8h35m-35 8h35m-35 8h35m-35 8h35" fill="${P}"/><path d="M35 60v-9c0-7 11-7 11 0v9Z" fill="${I}"/>`,
    detail: `<path d="M11 33v-5a4 4 0 0 1 8 0v5Zm50-7v-5a4 4 0 0 1 8 0v5ZM10 52V42a4 4 0 0 1 8 0v10Zm51 0V41a4 4 0 0 1 8 0v11Z" fill="${I}"/><path d="M34 27v4m13-4v4m-13 4v4m13-4v4m-13 4v4m13-4v4M40 18V9" stroke="${A}"/><path d="M8 57h13m38 0h12" stroke="${P}"/>`,
  },
  'gansu-zhangye-danxia': {
    silhouette: `<path d="m4 58 13-23 13-7 15-17 18 14 13 33Z" fill="${A}"/><path d="m9 49 21-12 15-17 22 19m-54 17 22-11 14-15 24 19" stroke="${R}" stroke-width="5"/><path d="m5 60 24-8 22-10 24 16" fill="${S}"/>`,
    detail: `<path d="m15 41 15-8 14-16M18 53l18-10 11-10 22 16m-58 9 21-6 18-9 20 12" stroke="${P}" stroke-width="1.8"/><path d="M29 28 26 40m37-15-2 8m-26 19-2 8m21-12 6 12" stroke="${A}"/><path d="M6 61h68"/>`,
  },
  'gansu-guanegou': {
    silhouette: `<path d="M5 60V23l14-12 12 17-4 32Zm70 0V16L59 9 47 27l5 33Z" fill="${S}"/><path d="M26 26c8 3 16 3 25-1L45 49l11 11H20l13-14Z" fill="${W}"/><path d="M32 29c2 9 9 8 6 17" stroke="${P}" stroke-width="4"/><ellipse cx="39" cy="57" rx="20" ry="5" fill="${W}"/>`,
    detail: `<path d="m18 16-5 12 9 9-8 10m47-32 6 13-11 10 7 12" stroke="${G}" stroke-width="2.5"/><path d="M28 56h14m-6 4h12" stroke="${P}"/><path d="m6 58 5-12 5 12m48 0 5-16 5 16" fill="${G}"/><path d="M11 58v3m58-3v3"/>`,
  },
  'gansu-zhagana': {
    silhouette: `<path d="m4 55 8-22 8-18 7 18 8-25 8 21 9-17 9 24 8-10 7 29Z" fill="${S}"/><path d="M5 55c17-13 46-13 70 0v7H5Z" fill="${G}"/><path d="M14 43h19v15H14Zm30-5h23v21H44Z" fill="${P}"/><path d="m10 44 13-10 14 10Zm30-5 15-11 16 11Z" fill="${A}"/>`,
    detail: `<path d="m20 15-1 22m16-29-1 25m17-21-3 22m11 2-1 9" stroke="${P}" stroke-width="2"/><path d="M19 49h5v8h-5m25-12h5v6h-5m8-6h5v6h-5M50 59v-7h7v7" fill="${R}"/><path d="M31 62c2-8 10-11 10-17" stroke="${P}" stroke-width="2.5"/>`,
  },
} satisfies LandmarkPack
