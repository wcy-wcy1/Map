import { A, B, G, I, P, R, S, type LandmarkPack } from './shared'

/** Palace axis; triple circular roof; Tibetan stupa; mountain monastery and ginkgo. */
export default {
  'beijing-forbidden-city': {
    silhouette: `<path d="M8 44h64v17H8Z" fill="${R}"/><path d="M23 31h34v20H23Z" fill="${R}"/><path d="m17 32 10-9h26l10 9Zm-12 13 9-9h11v4h30v-4h11l9 9Z" fill="${A}"/><path d="M29 60v-8h22v8M20 62h40" fill="${P}"/>`,
    detail: `<path d="M28 20h24m-23 15v9m7-9v9m8-9v9m7-9v9M13 49h9m36 0h9" stroke="${A}"/><path d="M12 61v-7a3 3 0 0 1 6 0v7m44 0v-7a3 3 0 0 1 6 0v7" fill="${I}"/><path d="m34 57 12 0m-15 4h18M18 29l-2-3m46 3 2-3"/>`,
  },
  'beijing-temple-of-heaven': {
    silhouette: `<ellipse cx="40" cy="59" rx="29" ry="5" fill="${P}"/><path d="M21 42h38v15c-9 4-29 4-38 0Z" fill="${R}"/><path d="M26 31h28v12H26Zm7-11h14v12H33Z" fill="${R}"/><path d="M14 43c10-4 17-9 26-11 9 2 16 7 26 11-14 5-38 5-52 0Zm8-12c8-4 13-9 18-12 5 3 10 8 18 12-11 5-25 5-36 0Zm7-12 11-10 11 10c-6 3-16 3-22 0Z" fill="${B}"/><path d="M40 9V5" stroke="${A}" stroke-width="3"/>`,
    detail: `<path d="M17 47c14 5 32 5 46 0M27 56v-7m8 9v-8m10 8v-8m8 6v-7M29 35l-1 5m8-3v5m8-5v5m8-7 1 5" stroke="${A}"/><path d="M16 59c12 5 36 5 48 0" stroke="${S}"/>`,
  },
  'beijing-white-pagoda': {
    silhouette: `<path d="M25 59v-6h30v6H25Zm5-6v-5c-14-10-6-23 10-24 16 1 24 14 10 24v5Z" fill="${P}"/><path d="m32 25 4-14h8l4 14ZM30 10l10-5 10 5Z" fill="${A}"/><path d="M7 49h14v11H7Zm52 0h14v11H59Z" fill="${P}"/><path d="m4 49 10-8 10 8Zm52 0 10-8 10 8Z" fill="${S}"/>`,
    detail: `<path d="M35 15h10m-11 5h12M33 48h14M11 52v8m5-8v8m48-8v8m5-8v8"/><path d="M34 33c-6 5-5 10-1 12" stroke="${G}" stroke-width="3"/><path d="M38 60v-5h4v5" fill="${R}"/>`,
  },
  'beijing-tanzhe-temple': {
    silhouette: `<path d="m5 40 15-20 10 7L45 12l30 30" fill="${G}"/><path d="M23 43h43v17H23Zm8-15h27v15H31Z" fill="${P}"/><path d="m26 29 17-12 20 12Zm-8 15 13-12 12 4 15-4 14 12Z" fill="${S}"/><path d="M12 59V33m0 8-6-6m6 4 7-8" stroke-width="3"/><path d="M4 32c-2-12 8-17 13-11 10-1 11 13 3 16-5 3-9 0-8-4-4 6-10 4-8-1Z" fill="${A}"/>`,
    detail: `<path d="M38 60V48h13v12" fill="${R}"/><path d="M27 49h5v6h-5m29-6h5v6h-5M35 31v5m16-5v5M19 62h52"/><path d="M11 28 7 26m5 4 4-4" stroke="${P}"/>`,
  },
} satisfies LandmarkPack
