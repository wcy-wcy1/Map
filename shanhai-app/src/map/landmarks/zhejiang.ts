import { A, B, G, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'zhejiang-west-lake': {
    silhouette: `<path d="M6 41c13-16 24-17 35-9 10-11 22-5 33 10" fill="${G}"/><ellipse cx="40" cy="51" rx="34" ry="11" fill="${W}"/><path d="M49 43V19h14v24Z" fill="${P}"/><path d="m45 20 11-9 11 9m-22 8h22m-22 8h22" fill="${S}"/><path d="M13 51h20l-6 6h-9Z" fill="${R}"/>`,
    detail: `<path d="M54 22v4m5-4v4m-5 4v4m5-4v4M22 51V38l8 13" fill="${P}"/><path d="M41 55v-7m-3 4h6m-6 5h6m18-3v-7m-3 4h6m-6 5h6M10 45h23m11 14h9" stroke="${P}"/><path d="M7 39V21m0 7 7-3m-7 8 8-3" stroke="${S}"/>`,
  },
  'zhejiang-wuzhen': {
    silhouette: `<path d="M26 30h29l12 32H15Z" fill="${W}"/><path d="M5 29h22v29H5Zm49-5h20v32H54Z" fill="${P}"/><path d="m2 30 10-10h10l10 10Zm47-5 13-13 15 13Z" fill="${S}"/><path d="M23 52v-7c10-13 25-13 35 0v7h-6c-5-12-18-12-23 0Z" fill="${P}"/>`,
    detail: `<path d="M9 35h6v9H9m9-9h5v9h-5m40-14h5v9h-5m9-9h4v9h-4M8 48h17m33-5h13M40 38v6m-9-3 3 6m14-6-3 6"/><path d="m34 57 13 0-3 4h-7Z" fill="${R}"/><path d="M19 61h10m22-2h11" stroke="${P}"/>`,
  },
  'zhejiang-guyan-huaxiang': {
    silhouette: `<path d="M5 39c22-10 42-3 70-6v28H5Z" fill="${W}"/><path d="M7 32h20v15H7Zm43-8h20v14H50Z" fill="${P}"/><path d="m3 33 14-11 14 11Zm43-8 17-12 12 12Z" fill="${S}"/><path d="M6 53c21-15 46-7 68-16v6C50 52 27 45 9 60Z" fill="${A}"/><path d="M30 35h16l-4 5h-9Z" fill="${R}"/>`,
    detail: `<path d="M38 34V19l7 16" fill="${P}"/><path d="M13 38h5v9h-5m40-17h6v7h-6m5-7h4v7h-4M15 52l3 4m9-9 2 5m11-7 1 5m12-7 1 5m10-8 2 4"/><path d="M16 40c-13 3-14-15-4-15 0-9 13-8 14 0 10 8-3 17-10 15Z" fill="${G}"/><path d="M18 39v10" stroke="${S}"/><path d="M33 58h18m6-4h11" stroke="${P}"/>`,
  },
  'zhejiang-chenjiapu': {
    silhouette: `<path d="m5 60 7-24 17-11 11-14 18 13 17 36Z" fill="${G}"/><path d="m9 46 25-7 10 6 27-5M6 56l28-8 12 6 26-5" stroke="${S}" stroke-width="4"/><path d="M25 27h17v13H25Zm20 14h22v14H45ZM9 47h20v13H9Z" fill="${P}"/><path d="m21 28 12-10 13 10Zm20 14 14-10 16 10ZM5 48l13-10 15 10Z" fill="${S}"/>`,
    detail: `<path d="M29 31h4v6h-4m5-6h4v6h-4m12 10h5v7h-5m7-7h5v7h-5M14 52h5v8h-5" fill="${A}"/><path d="M41 33c-10 7-3 10-10 16s4 7-1 13" stroke="${P}" stroke-width="2.4"/><path d="M61 28v-9m-4 5 4-7 5 7" fill="${S}"/>`,
  },
} satisfies LandmarkPack
