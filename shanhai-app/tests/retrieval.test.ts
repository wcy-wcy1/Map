import { describe, expect, it } from 'vitest'
import { publicPlaces } from '../src/domain/catalogue'
import { detailPage, filter, group, indexVisits, matchesVisit, normalizeQuery } from '../src/domain/map-layout'
import type { Visit } from '../src/domain/models'

const visits: Visit[] = Array.from({ length: 18 }, (_, i) => ({ id: `visit-${i}`, createdAt: i, placeId: 'yulong', date: `2025-01-${String(i + 1).padStart(2, '0')}`, note: i === 0 ? '山脚下买了热豆浆' : `合成记录${i}`, photos: [], coverId: null }))
describe('memory retrieval and map grouping', () => {
  it('normalizes fullwidth and whitespace, without pretending to do image recognition', () => {
    expect(normalizeQuery(' ＡＢＣ １２ ')).toBe('abc12')
    expect(matchesVisit(visits[0]!, ' 热 豆 浆 ')).toBe(true)
    expect(matchesVisit(visits[1]!, '热豆浆')).toBe(false)
    expect(matchesVisit(visits[0]!, '')).toBe(false)
  })
  it('finds a place using an oldest visit, date, alias or region, with composable filters', () => {
    expect(filter(publicPlaces, { query: '热豆浆', visits }).map(p => p.id)).toEqual(['yulong'])
    expect(filter(publicPlaces, { query: '2025-01-01', visits }).map(p => p.id)).toEqual(['yulong'])
    expect(filter(publicPlaces, { query: '热豆浆', visits, regionId: 'kunming' })).toEqual([])
    expect(filter(publicPlaces, { visitedOnly: true })).toEqual([])
    expect(filter(publicPlaces, { visitedOnly: true, visitedIds: ['yulong'] }).map(p => p.id)).toEqual(['yulong'])
    const aliasPlace = publicPlaces.find(p => p.aliases.length)!
    expect(filter(publicPlaces, { query: aliasPlace.aliases[0] }).some(p => p.id === aliasPlace.id)).toBe(true)
  })
  it('sorts newest first but opens the actually matching older visit', () => {
    const sorted = indexVisits(visits).get('yulong')!
    expect(sorted[0]?.id).toBe('visit-17')
    expect(detailPage(sorted, '热豆浆').items.map(v => v.id)).toEqual(['visit-0'])
    expect(detailPage(sorted, '热豆浆')).toMatchObject({ total: 18, matched: 1, filtering: true, remaining: 0 })
    expect(detailPage(sorted, '热豆浆', { showAll: true })).toMatchObject({ filtering: false, remaining: 10 })
  })
  it('paginates 8 → 16 → 18, defaults invalid limits, and rebuilds index after edits', () => {
    expect(detailPage(visits, '').items).toHaveLength(8)
    expect(detailPage(visits, '', { limit: 16 }).items).toHaveLength(16)
    expect(detailPage(visits, '', { limit: 24 }).items).toHaveLength(18)
    expect(detailPage(visits, '', { limit: NaN }).items).toHaveLength(8)
    const edited = visits.map(v => v.id === 'visit-0' ? { ...v, note: '换成雪山的风' } : v)
    expect(filter(publicPlaces, { visits: edited, query: '热豆浆' })).toEqual([])
    expect(filter(publicPlaces, { visits: edited, query: '雪山的风' }).map(p => p.id)).toEqual(['yulong'])
  })
  it('keeps every actual coordinate, with selected place as a reachable representative', () => {
    const points = publicPlaces.map((p, i) => ({ ...p, x: (i % 7) * 40, y: Math.floor(i / 7) * 40 }))
    const before = JSON.stringify(points)
    for (const point of points) {
      const grouped = group(points, { selectedId: point.id })
      expect(grouped[0]?.anchor).toBe(point)
      expect(grouped.flatMap(g => g.members.map(p => p.id)).sort()).toEqual(points.map(p => p.id).sort())
      for (const cluster of grouped) expect(cluster.members).toContain(cluster.anchor)
    }
    expect(JSON.stringify(points)).toBe(before)
  })
})
