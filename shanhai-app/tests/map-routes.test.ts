import { describe, expect, it } from 'vitest'
import { buildMemoryRoutes } from '../src/map/routes'
import type { Place, VisitSummary } from '../src/domain/models'

const place = (id: string, regionId = 'lijiang', longitude = 100, latitude = 27): Place => ({
  id, name: id, aliases: [], mapId: 'yunnan', regionId, regionName: regionId, city: regionId,
  category: 'landmark', iconKey: 'village', coordinates: [longitude, latitude], coordinateSystem: 'WGS84',
  coordinateSource: { type: 'test' }, anchorNote: '', text: '', highlights: [], priority: 1,
})
const visit = (id: string, placeId: string, date: string, createdAt: number): VisitSummary => ({
  id, createdAt, placeId, date, note: '', photos: [], coverId: null,
})

describe('buildMemoryRoutes', () => {
  it('connects distinct remembered places in earliest visit order within a region', () => {
    const places = [place('old', 'lijiang', 100, 27), place('new', 'lijiang', 101, 28)]
    const index = new Map([
      ['new', [visit('v-new', 'new', '2026-05-02', 2)]],
      ['old', [visit('v-old', 'old', '2026-05-01', 1)]],
    ])
    expect(buildMemoryRoutes(places, index)).toEqual([{
      regionId: 'lijiang',
      placeIds: ['old', 'new'],
      coordinates: [[100, 27], [101, 28]],
    }])
  })

  it('does not connect a single memory or memories from different regions', () => {
    const places = [place('one', 'lijiang'), place('two', 'dali', 101, 28)]
    const index = new Map([
      ['one', [visit('v-one', 'one', '2026-05-01', 1)]],
      ['two', [visit('v-two', 'two', '2026-05-02', 2)]],
    ])
    expect(buildMemoryRoutes(places, index)).toEqual([])
  })

  it('deduplicates multiple visits to the same place using the earliest one', () => {
    const places = [place('one'), place('two', 'lijiang', 101, 28)]
    const index = new Map([
      ['one', [
        visit('v-late', 'one', '2026-05-03', 3),
        visit('v-early', 'one', '2026-05-01', 1),
      ]],
      ['two', [visit('v-two', 'two', '2026-05-02', 2)]],
    ])
    expect(buildMemoryRoutes(places, index)[0]?.placeIds).toEqual(['one', 'two'])
  })
})
