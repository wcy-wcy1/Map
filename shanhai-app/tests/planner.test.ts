import { describe, expect, it } from 'vitest'
import { orderPlacesByNearest } from '../src/map/planner'
import type { Place } from '../src/domain/models'

const place = (id: string, longitude: number, latitude = 25): Place => ({
  id, name: id, aliases: [], mapId: 'yunnan', regionId: 'test', regionName: '测试市', city: '测试市',
  category: 'landmark', iconKey: 'village', coordinates: [longitude, latitude], coordinateSystem: 'WGS84',
  coordinateSource: { type: 'test' }, anchorNote: '', text: '', highlights: [], priority: 1,
})

describe('orderPlacesByNearest', () => {
  it('keeps the first selected place as the start and orders the rest by proximity', () => {
    expect(orderPlacesByNearest([place('start', 100), place('far', 104), place('near', 101)]).map(row => row.id))
      .toEqual(['start', 'near', 'far'])
  })

  it('handles an empty plan', () => {
    expect(orderPlacesByNearest([])).toEqual([])
  })
})
