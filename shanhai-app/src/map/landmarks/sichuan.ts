import { A, B, G, I, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'sichuan-jiuzhaigou': {
    silhouette: `<path d="m5 34 13-18 13 12 12-18 15 17 14-9 4 22" fill="${G}"/><path d="M8 34c15-9 40-9 62 0l-4 8H15Z" fill="${W}"/><path d="M17 40v10h45V40" fill="${P}"/><path d="M6 52c15-9 48-9 68 0l-7 8H12Z" fill="${W}"/>`,
    detail: `<path d="M22 41v8m8-7v6m20-7v6m7-6v7M18 35h17m10-1h14M18 55h17m8 2h19" stroke="${P}" stroke-width="2.4"/><path d="m12 29 4-12 4 12m40-1 4-15 5 15" fill="${S}"/><path d="M16 29v6m48-7v5"/>`,
  },
  'sichuan-dujiangyan': {
    silhouette: `<path d="M20 10C8 25 3 43 7 60h66c3-18-7-36-16-50Z" fill="${W}"/><path d="M39 24C28 36 25 48 21 60h38c-5-12-9-24-20-36Z" fill="${G}"/><path d="m39 24-7 21h14Z" fill="${A}"/><path d="M37 45v15h7V45" fill="${P}"/>`,
    detail: `<path d="M29 18c-7 11-12 23-12 33m32-33c8 9 14 22 15 34" stroke="${P}" stroke-width="2.5"/><path d="m12 46 5 6 3-7m40 1 4 7 3-7M34 47h12m-13 6h14"/><path d="M25 14h30" stroke="${R}" stroke-width="3"/><path d="M26 11v6m7-6v6m7-6v6m7-6v6m7-6v6" stroke="${I}"/>`,
  },
  'sichuan-shangli': {
    silhouette: `<path d="M5 52c18-5 43-5 70 0v10H5Z" fill="${W}"/><path d="M7 34h22v17H7Zm41-8h22v24H48Z" fill="${P}"/><path d="m3 34 15-11 16 11Zm40-7 16-13 16 13Z" fill="${S}"/><path d="M15 54v-7c14-22 35-22 49 0v7h-7c-6-20-29-20-35 0Z" fill="${P}"/>`,
    detail: `<path d="M18 44c14-17 29-17 42 0M40 35v7m-9-5 3 7m14-7-3 7M11 39h5v8h-5m9-8h5v8h-5m33-18h5v7h-5m9-7h5v7h-5"/><path d="M30 58h20" stroke="${P}"/><path d="M66 37v8" stroke="${R}" stroke-width="3"/>`,
  },
  'sichuan-taoping': {
    silhouette: `<path d="m4 43 14-22 17 15 22-24 18 30" fill="${G}"/><path d="m29 60 4-44h15l4 44Z" fill="${A}"/><path d="M7 43h23v17H7Zm44-6h22v23H51Z" fill="${S}"/><path d="M33 16v-6h4v6h6v-6h5v6M7 43v-4h5v4h6v-4h5v4m28-6v-5h5v5h7v-5h5v5" fill="${A}"/>`,
    detail: `<path d="M38 23h5v6h-5Zm-1 13h6v7h-6ZM13 48h5v6h-5m40-11h6v5h-6m11 2h5v6h-5M34 32h13m-15 15h17"/><path d="M36 60v-9h9v9" fill="${I}"/><path d="M10 58h16m30-7h7m-10 7h17" stroke="${P}"/>`,
  },
} satisfies LandmarkPack
