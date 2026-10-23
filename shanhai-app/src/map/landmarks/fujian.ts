import { A, B, G, I, P, R, S, W, type LandmarkPack } from './shared'

export default {
  'fujian-gulangyu': {
    silhouette: `<ellipse cx="40" cy="56" rx="35" ry="7" fill="${W}"/><path d="M9 52c8-15 42-15 62 0l-6 6H15Z" fill="${G}"/><path d="M17 31h24v23H17Zm27-7h19v29H44Z" fill="${P}"/><path d="m13 32 16-13 16 13Zm29-9h23v5H42Z" fill="${R}"/><path d="M49 24V13h9v11Z" fill="${A}"/><path d="M48 13c0-10 11-10 11 0Z" fill="${R}"/>`,
    detail: `<path d="M22 54V43a5 5 0 0 1 10 0v11m17-19h4v6h-4m7-6h4v6h-4m-11 5h4v7h-4m7-7h4v7h-4"/><circle cx="29" cy="29" r="3" fill="${A}"/><path d="M54 8V5m-40 53V37m0 4-6-4m6 1 5-4"/><path d="M21 60h15m17-1h12" stroke="${P}"/>`,
  },
  'fujian-tianluokeng': {
    silhouette: `<path d="M5 26c13-16 56-17 70 6v25H5Z" fill="${G}"/><path d="M27 22v8c0 9 27 9 27 0v-8" fill="${A}"/><ellipse cx="40.5" cy="22" rx="13.5" ry="7" fill="${S}"/><ellipse cx="40.5" cy="22" rx="6" ry="3" fill="${P}"/><path d="M5 36v11c0 9 26 9 26 0V36m18 0v11c0 9 26 9 26 0V36" fill="${A}"/><ellipse cx="18" cy="36" rx="13" ry="7" fill="${S}"/><ellipse cx="62" cy="36" rx="13" ry="7" fill="${S}"/><ellipse cx="18" cy="36" rx="6" ry="3" fill="${P}"/><ellipse cx="62" cy="36" rx="6" ry="3" fill="${P}"/><path d="M26 36h27v15H26Z" fill="${A}"/><path d="M23 36h33l-5-6H29Z" fill="${S}"/><path d="M24 51v8c0 9 33 9 33 0v-8" fill="${A}"/><ellipse cx="40.5" cy="51" rx="16.5" ry="8" fill="${S}"/><ellipse cx="40.5" cy="51" rx="8" ry="4" fill="${P}"/>`,
    detail: `<path d="M38 64v-5h5v5M10 44v3m6-2v4m7-5v3m33-3v3m6-2v4m6-5v3M33 29v3m15-3v3M31 39v4m6-4v4m7-4v4m6-4v4" stroke="${I}"/>`,
  },
  'fujian-qida': {
    silhouette: `<path d="M6 52 8 31 22 9l17 19 15 8 20 20Z" fill="${G}"/><path d="M28 32c14 6 15 15 46 13v17H20Z" fill="${W}"/><path d="m16 31 17 3 5 15-14-4Z" fill="${P}"/><path d="m12 31 10-8 13 11Z" fill="${R}"/><path d="m35 48 10-5 11 4-10 6Zm16 8 11-5 12 4-11 6Z" fill="${A}"/>`,
    detail: `<path d="m22 12 2 10-7 6m-3 11 4 11m8-12 3 6m13 2 8 5m-13-2 11-5m10 9 9 5m-12-3 12-5M54 34h14l-4 5h-6Z" fill="${R}"/><path d="M62 34V25l5 9" fill="${P}"/><path d="M25 55h13m8 5h8" stroke="${P}"/>`,
  },
  'fujian-beigang': {
    silhouette: `<path d="M6 52c17-3 42-5 68 0v10H6Z" fill="${W}"/><path d="m5 41 11-18 14 16 24-25 20 28" fill="${G}"/><path d="M10 36h25v21H10Zm31-4h29v24H41Z" fill="${A}"/><path d="m6 37 15-11 19 11Zm30-4 17-13 22 13Z" fill="${S}"/>`,
    detail: `<path d="M14 43h6v7h-6m28-12h7v8h-7m10-8h7v8h-7" fill="${B}"/><path d="M25 57V46h7v11m19-1V46h9v10" fill="${R}"/><path d="M12 40h19m-19 12h10m20-17h25m-26 15h9m13 0h5M13 33h7m4-2h6m19-2h8m5-2h7" stroke="${P}"/><path d="m5 58 6-3 5 3m48 3 6-4 6 4" fill="${S}"/>`,
  },
} satisfies LandmarkPack
