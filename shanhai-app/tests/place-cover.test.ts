import { describe, expect, it } from 'vitest'
import type { Cover, VisitSummary } from '../src/domain/models'
import { selectPlaceCover } from '../src/domain/place-cover'

const row = (id: string, date = '2025-01-01', photos = 1, overrides: Partial<VisitSummary> = {}): VisitSummary => ({
  id, placeId: 'yulong', createdAt: 1, date, note: '山脚的豆浆', coverId: photos ? `${id}-0` : null,
  photos: Array.from({ length: photos }, (_, i) => ({ id: `${id}-${i}`, name: `${id}-${i}.jpg` })), ...overrides,
})
const index = (rows: readonly VisitSummary[]) => new Map([['yulong', rows]])
const choose = (rows: readonly VisitSummary[], covers: readonly Cover[] = [], query = '') => selectPlaceCover('yulong', index(rows), covers, query)

describe('shared metadata-only place cover selection', () => {
  it('honours a valid curated photo ahead of the latest visit and counts all candidate photos', () => {
    const old = row('old', '2024-01-01', 2), newest = row('new', '2025-01-01', 3)
    expect(choose([newest, old], [{ placeId: 'yulong', visitId: 'old', photoId: 'old-1' }])).toEqual({ visitId: 'old', photoId: 'old-1', photoName: 'old-1.jpg', photoCount: 5 })
  })
  it('ignores stale or wrong-place references and falls back to the latest photo-bearing visit', () => {
    const old = row('old', '2024-01-01', 2, { coverId: 'old-1' }), latestText = row('text', '2025-01-01', 0)
    const references = [{ placeId: 'yulong', visitId: 'missing', photoId: 'old-0' }, { placeId: 'other', visitId: 'old', photoId: 'old-0' }]
    expect(choose([latestText, old], references)).toEqual({ visitId: 'old', photoId: 'old-1', photoName: 'old-1.jpg', photoCount: 2 })
    expect(choose([old], [{ placeId: 'yulong', visitId: 'old', photoId: 'missing' }])?.photoId).toBe('old-1')
  })
  it('uses the first photo when the visit cover is absent or invalid', () => {
    expect(choose([row('one', undefined, 2, { coverId: null })])?.photoId).toBe('one-0')
    expect(choose([row('one', undefined, 2, { coverId: 'missing' })])?.photoId).toBe('one-0')
  })
  it('keeps curated rules for a place-name-only search, including normalized empty input', () => {
    const old = row('old', '2024-01-01', 2), newest = row('new'), cover = [{ placeId: 'yulong', visitId: 'old', photoId: 'old-1' }]
    expect(choose([newest, old], cover, '玉龙雪山')?.photoId).toBe('old-1')
    expect(choose([newest, old], cover, '  \t\n')?.photoId).toBe('old-1')
  })
  it('restricts a date/note search to matching rows and never borrows an unrelated curated picture', () => {
    const match = row('match', '2024-02-03', 2, { note: '热 豆 浆' }), other = row('other', '2025-01-01', 3, { note: '雪山合照' })
    const cover = [{ placeId: 'yulong', visitId: 'other', photoId: 'other-2' }]
    expect(choose([other, match], cover, '２０２４－０２－０３')).toEqual({ visitId: 'match', photoId: 'match-0', photoName: 'match-0.jpg', photoCount: 2 })
    expect(choose([other, match], cover, '热豆浆')?.visitId).toBe('match')
  })
  it('preserves a curated selection inside matching rows and counts only the matching candidates', () => {
    const old = row('old', '2024-01-01', 2), newest = row('new', '2025-01-01', 3), other = row('other', '2025-01-02', 4, { note: '其他回忆' })
    expect(choose([other, newest, old], [{ placeId: 'yulong', visitId: 'old', photoId: 'old-1' }], '豆浆')).toEqual({ visitId: 'old', photoId: 'old-1', photoName: 'old-1.jpg', photoCount: 5 })
  })
  it('shows no photo for matching text-only visits or entirely photo-free places', () => {
    const text = row('text', '2025-01-01', 0, { note: '记住这一天' }), picture = row('picture', '2024-01-01')
    expect(choose([picture, text], [{ placeId: 'yulong', visitId: 'picture', photoId: 'picture-0' }], '这一天')).toBeUndefined()
    expect(choose([text])).toBeUndefined(); expect(choose([])).toBeUndefined()
    expect(selectPlaceCover('absent', index([picture]), [], '')).toBeUndefined()
  })
  it('sorts by visit date, createdAt and id without depending on the caller array order', () => {
    const rows = [row('b', '2025-01-01', 1, { createdAt: 3 }), row('a', '2025-01-01', 1, { createdAt: 3 }), row('c', '2025-01-01', 1, { createdAt: 2 }), row('new-date', '2025-01-02')]
    expect(choose(rows)?.visitId).toBe('new-date')
    expect(choose(rows.slice(0, 3))?.visitId).toBe('a')
    expect(choose(rows.slice(0, 3).reverse())?.visitId).toBe('a')
  })
  it('ignores foreign records in a place bucket and never carries URLs or mutable input references out', () => {
    const source = row('own', undefined, 2), foreign = row('foreign', '2026-01-01', 3, { placeId: 'other' })
    const opaque = Object.assign(source.photos[0]!, { url: 'data:image/jpeg;base64,PRIVATE' })
    Object.freeze(opaque); Object.freeze(source.photos); Object.freeze(source)
    const rows = Object.freeze([source, foreign]), before = JSON.stringify(rows)
    const output = choose(rows)!
    expect(output).toEqual({ visitId: 'own', photoId: 'own-0', photoName: 'own-0.jpg', photoCount: 2 })
    expect(JSON.stringify(output)).not.toContain('PRIVATE')
    output.photoName = 'changed'
    expect(JSON.stringify(rows)).toBe(before)
  })
})
