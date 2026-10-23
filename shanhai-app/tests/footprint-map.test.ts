import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { Component } from 'vue'
import type { Geography, Place, VisitSummary } from '../src/domain/models'
import { PHOTO_LOADER_KEY, type PhotoLoader } from '../src/services/photo-loader'

// Actual Leaflet + Vue, with jsdom's missing layout/media/observer APIs supplied.
// Real touch/visual verification still belongs to the browser/device gate.
let FootprintMap: Component
let reduceMotion = false
const wrappers: VueWrapper[] = []
const observers: TestResizeObserver[] = []
const mediaListeners = new Set<EventListenerOrEventListenerObject>()
const photoObservers = new Map<Element, { callback: IntersectionObserverCallback; disconnected: boolean }>()
class TestPhotoObserver {
  state: { callback: IntersectionObserverCallback; disconnected: boolean }
  constructor(callback: IntersectionObserverCallback) { this.state = { callback, disconnected: false } }
  observe(target: Element) { photoObservers.set(target, this.state) }
  disconnect() { this.state.disconnected = true }
}
class TestResizeObserver {
  disconnected = false
  constructor(_callback: ResizeObserverCallback) { observers.push(this) }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true }
}
const place = (id: string, lng: number, lat = 25): Place => ({
  id, name: id, coordinates: [lng, lat], aliases: [], regionId: 'test', regionName: '测试市', city: '测试市',
  category: '自然', iconKey: 'snow-mountain', coordinateSystem: 'WGS84', coordinateSource: { type: 'test' },
  anchorNote: '', text: '', highlights: [], priority: 1,
})
const geography: Geography = {
  type: 'FeatureCollection', features: [{
    type: 'Feature', properties: { kind: 'province', name: '测试省' },
    geometry: { type: 'Polygon', coordinates: [[[98, 22], [106, 22], [106, 29], [98, 29], [98, 22]]] },
  }],
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30))
const props = (places: Place[]) => ({ places, geography, regions: [], visitedIds: [], selectedId: null })
function render(places: Place[], overrides: Record<string, unknown> = {}, loader?: PhotoLoader) {
  const wrapper = mount(FootprintMap, { props: { ...props(places), ...overrides }, attachTo: document.body,
    global: { provide: loader ? { [PHOTO_LOADER_KEY as symbol]: loader } : {} } })
  wrappers.push(wrapper)
  return wrapper
}

beforeAll(async () => {
  Object.defineProperty(SVGSVGElement.prototype, 'createSVGRect', { configurable: true, value: () => ({}) })
  vi.stubGlobal('ResizeObserver', TestResizeObserver)
  vi.stubGlobal('IntersectionObserver', TestPhotoObserver)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion') && reduceMotion, media: query, onchange: null,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => mediaListeners.delete(listener),
    addListener() {}, removeListener() {}, dispatchEvent: () => true,
  }))
  FootprintMap = (await import('../src/components/FootprintMap.vue')).default
})
beforeEach(() => {
  reduceMotion = false
  photoObservers.clear()
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
})
afterEach(() => {
  wrappers.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.replaceChildren()
})
afterAll(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(SVGSVGElement.prototype, 'createSVGRect')
})

describe('FootprintMap actual Leaflet lifecycle', () => {
  it('renders native coordinate-anchored buttons and license links without inventing photos for an unvisited place', async () => {
    const wrapper = render([place('雪山', 100)])
    await settle()
    const marker = wrapper.get<HTMLButtonElement>('[data-map-place="雪山"]')
    expect(marker.attributes('data-longitude')).toBe('100')
    expect(marker.attributes('data-latitude')).toBe('25')
    expect(marker.find('svg').exists()).toBe(true)
    expect(wrapper.findAll('.leaflet-tile,.yn-pin img')).toHaveLength(0)
    expect(wrapper.get('.leaflet-control-attribution a').attributes('href')).toBe('https://www.openstreetmap.org/copyright')
    expect(wrapper.find('.leaflet-control-scale').exists()).toBe(true)
    await marker.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['雪山']])
  })
  const summary = (id: string): VisitSummary => ({ id: `visit-${id}`, placeId: id, createdAt: 1,
    date: '2025-01-01', note: '雪山日出', photos: [{ id: 'first', name: '一.jpg' }, { id: 'second', name: '二.jpg' }], coverId: 'first' })
  const photoOptions = (id: string) => ({ recordIndex: new Map([[id, [summary(id)]]]),
    covers: [{ placeId: id, visitId: `visit-${id}`, photoId: 'second' }], revision: 3, visitedIds: [id] })
  function visiblePhotos() {
    for (const [target, observer] of photoObservers) if (!observer.disconnected) {
      observer.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  }
  function photoLoader() { return { load: vi.fn(async (_visit, id) => ({ id, name: '二.jpg', url: 'data:image/jpeg;base64,AA==' })), clear: vi.fn(), close: vi.fn() } satisfies PhotoLoader }
  it('displays the selected cover beside its landmark and clicking the paper enters the same place', async () => {
    const loader = photoLoader(), wrapper = render([place('雪山', 100)], { ...photoOptions('雪山'), selectedId: '雪山' }, loader)
    await settle()
    const marker = wrapper.get<HTMLButtonElement>('[data-map-place="雪山"]'), cover = marker.get<HTMLElement>('.yn-map-photo')
    expect(marker.attributes('data-cover')).toBe('shown')
    expect(cover.attributes('data-photo-id')).toBe('second')
    expect(Number.parseFloat(cover.element.style.width)).toBeLessThanOrEqual(48)
    expect(Number.parseFloat(cover.element.style.left)).toBeGreaterThanOrEqual(Number.parseFloat(marker.element.style.width) + 4)
    expect(marker.attributes('data-longitude')).toBe('100')
    expect(loader.load).not.toHaveBeenCalled(); visiblePhotos(); await settle()
    expect(loader.load).toHaveBeenCalledExactlyOnceWith('visit-雪山', 'second', 3, expect.any(AbortSignal))
    expect(marker.find('svg').exists()).toBe(true); expect(cover.find('img').exists()).toBe(true)
    await cover.trigger('click'); expect(wrapper.emitted('select')).toEqual([['雪山']])
    expect(wrapper.findAll('.leaflet-tile')).toHaveLength(0)
  })
  it('keeps map covers hidden in overview until a place is selected or the map is readable', async () => {
    const loader = photoLoader(), wrapper = render([place('a', 100)], photoOptions('a'), loader)
    await settle()
    expect(wrapper.get('[data-map-place="a"]').attributes('data-cover')).toBe('none')
    expect(wrapper.find('.yn-map-photo').exists()).toBe(false)
    visiblePhotos(); await settle()
    expect(loader.load).not.toHaveBeenCalled()
    await wrapper.setProps({ selectedId: 'a' }); await settle()
    expect(wrapper.get('[data-map-place="a"]').attributes('data-cover')).toBe('shown')
  })
  it('releases old photos on revision/filter/picker changes and never reloads hidden/picker covers', async () => {
    const loader = photoLoader(), wrapper = render([place('a', 100)], { ...photoOptions('a'), selectedId: 'a' }, loader)
    await settle(); visiblePhotos(); await settle()
    const oldImage = wrapper.get('.yn-map-photo img').element
    await wrapper.setProps({ revision: 4, covers: [{ placeId: 'a', visitId: 'visit-a', photoId: 'first' }] })
    await settle(); expect(oldImage.getAttribute('src')).toBeNull()
    visiblePhotos(); await settle()
    expect(loader.load).toHaveBeenLastCalledWith('visit-a', 'first', 4, expect.any(AbortSignal))
    await wrapper.setProps({ pickingLocation: true }); await settle()
    expect(wrapper.find('.yn-map-photo').exists()).toBe(false)
    visiblePhotos(); expect(loader.load).toHaveBeenCalledTimes(2)
    await wrapper.setProps({ places: [] }); await settle()
    expect([...photoObservers.values()].every(observer => observer.disconnected)).toBe(true)
    expect(loader.clear).not.toHaveBeenCalled(); expect(loader.close).not.toHaveBeenCalled()
  })
  it('retains marker, decoded image and focus on selection/layout changes while revision changes invalidate the photo', async () => {
    const loader = photoLoader(), wrapper = render([place('a', 100)], { ...photoOptions('a'), selectedId: 'a' }, loader)
    await settle(); visiblePhotos(); await settle()
    const button = wrapper.get<HTMLButtonElement>('[data-map-place="a"]').element
    const image = wrapper.get('.yn-map-photo img').element
    button.focus()
    await wrapper.setProps({ visitedIds: ['a'], query: '雪山', regions: [] }); await settle()
    visiblePhotos(); await settle()
    expect(wrapper.get('[data-map-place="a"]').element).toBe(button)
    expect(wrapper.get('.yn-map-photo img').element).toBe(image)
    expect(loader.load).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(button)
    ;(wrapper.vm as unknown as { fitPlaces(places: Place[]): void }).fitPlaces([place('a', 100)])
    await settle(); visiblePhotos(); await settle()
    expect(wrapper.get('[data-map-place="a"]').element).toBe(button)
    expect(wrapper.get('.yn-map-photo img').element).toBe(image)
    expect(loader.load).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ revision: 4 }); await settle()
    expect(image.getAttribute('src')).toBeNull()
    visiblePhotos(); await settle()
    expect(loader.load).toHaveBeenCalledTimes(2)
  })
  it('retains a planned route path when only selection changes', async () => {
    const wrapper = render([place('a', 100), place('b', 101)], { plannedRouteIds: ['a', 'b'] })
    await settle()
    const route = wrapper.get('.yn-planned-route').element
    await wrapper.setProps({ selectedId: 'a' }); await settle()
    expect(wrapper.get('.yn-planned-route').element).toBe(route)
  })
  it('keeps cluster counts as places and never borrows a hidden member photo for the wrong landmark', async () => {
    const loader = photoLoader(), wrapper = render([place('a', 100), place('b', 100.01)], photoOptions('b'), loader)
    await settle()
    expect(wrapper.get('.yn-cluster-count').text()).toBe('2 处')
    expect(wrapper.find('.yn-map-photo').exists()).toBe(false)
    await wrapper.setProps({ selectedId: 'b' }); await settle()
    expect(wrapper.get('[data-map-place="b"] .yn-map-photo').attributes('data-photo-id')).toBe('second')
    await wrapper.get('.yn-map-photo').trigger('click')
    expect(wrapper.emitted('cluster')).toEqual([[['b', 'a']]])
    expect(wrapper.emitted('select')).toBeUndefined()
  })
  it('keeps a failed cover landmark clickable and releases map image observers on unmount', async () => {
    const loader = photoLoader(); loader.load.mockRejectedValue(new Error('stale'))
    const wrapper = render([place('a', 100)], { ...photoOptions('a'), selectedId: 'a' }, loader)
    await settle(); visiblePhotos(); await settle()
    expect(wrapper.get('.yn-map-photo').attributes('data-state')).toBe('error')
    await wrapper.get('[data-map-place="a"]').trigger('click'); expect(wrapper.emitted('select')).toEqual([['a']])
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect([...photoObservers.values()].every(observer => observer.disconnected)).toBe(true)
  })
  it('expands a nearby group and emits member IDs, then uses picker mode without opening details', async () => {
    const wrapper = render([place('a', 100), place('b', 100.01)])
    await settle()
    const marker = wrapper.get('[data-map-place]')
    expect(marker.attributes('data-members')).toBe('a,b')
    await marker.trigger('click')
    expect(wrapper.emitted('cluster')).toEqual([[['a', 'b']]])
    await wrapper.setProps({ pickingLocation: true })
    await settle()
    await wrapper.get('[data-map-place="a"]').trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[[100, 25]]])
    expect(wrapper.emitted('select')).toBeUndefined()
  })
  it('shows coincident members through the list without repeatedly zooming or replacing their button', async () => {
    const wrapper = render([place('a', 100), place('b', 100)])
    await settle()
    const button = wrapper.get('[data-map-place="a"]'), before = wrapper.get('#yn-map').attributes('data-zoom')
    await button.trigger('click'); await settle()
    await button.trigger('click'); await settle()
    expect(wrapper.get('#yn-map').attributes('data-zoom')).toBe(before)
    expect(wrapper.get('[data-map-place="a"]').element).toBe(button.element)
    expect(wrapper.emitted('cluster')).toEqual([[['a', 'b']], [['a', 'b']]])
  })
  it('drills into a near group by at most two zoom levels while retaining a visible selected name', async () => {
    const wrapper = render([place('a', 100), place('b', 100.0001)], { selectedId: 'a' })
    await settle()
    expect(wrapper.get('[data-map-place="a"]').attributes('data-label')).toBe('true')
    const before = Number(wrapper.get('#yn-map').attributes('data-zoom'))
    await wrapper.get('[data-map-place="a"]').trigger('click'); await settle()
    expect(Number(wrapper.get('#yn-map').attributes('data-zoom')) - before).toBeLessThanOrEqual(2)
    expect(wrapper.get('.yn-pin-label').text()).toBe('a')
  })
  it('updates visited state, keeps keyboard focus when a marker is regrouped, and resets through parent state', async () => {
    const wrapper = render([place('a', 100), place('b', 100.01)])
    await settle()
    wrapper.get<HTMLButtonElement>('[data-map-place="a"]').element.focus()
    await wrapper.setProps({ selectedId: 'b', visitedIds: ['b'] })
    await settle()
    expect(document.activeElement?.getAttribute('data-map-place')).toBe('b')
    expect(wrapper.get('[data-map-place="b"]').attributes('data-visited')).toBe('true')
    await wrapper.get('.yn-fit').trigger('click')
    expect(wrapper.emitted('reset')).toEqual([[]])
    await wrapper.setProps({ places: [] })
    await settle()
    expect(wrapper.get('.yn-map-summary').text()).toContain('可添加我的地点')
    expect(document.activeElement?.id).toBe('yn-map')
  })
  it('shows names for a small provincial selection and does not zoom an already visible place', async () => {
    const mountain = place('玉龙雪山', 100)
    const wrapper = render([mountain])
    await settle()
    expect(wrapper.get('[data-map-place="玉龙雪山"]').attributes('data-label')).toBe('true')
    const before = wrapper.get('#yn-map').attributes()
    const button = wrapper.get('[data-map-place="玉龙雪山"]').element
    ;(wrapper.vm as unknown as { selectPlace(place: Place): void }).selectPlace(mountain)
    await settle()
    expect(wrapper.get('[data-map-place="玉龙雪山"]').attributes('data-label')).toBe('true')
    expect(wrapper.get('.yn-pin-label').text()).toBe('玉龙雪山')
    expect(wrapper.get('#yn-map').attributes('data-zoom')).toBe(before['data-zoom'])
    expect(wrapper.get('#yn-map').attributes('data-center-lng')).toBe(before['data-center-lng'])
    expect(wrapper.get('[data-map-place="玉龙雪山"]').element).toBe(button)
  })
  it('moves an obscured selection above the bottom sheet without zooming and respects reduced motion', async () => {
    reduceMotion = true
    const wrapper = render([place('a', 100)], { selectedId: 'a' })
    await settle()
    const before = wrapper.get('#yn-map').attributes()
    await wrapper.setProps({ bottomInset: 280 }); await settle()
    expect(wrapper.get('#yn-map').attributes('data-zoom')).toBe(before['data-zoom'])
    expect(wrapper.get('#yn-map').attributes('data-center-lat')).not.toBe(before['data-center-lat'])
    const after = wrapper.get('#yn-map').attributes('data-center-lat')
    await wrapper.setProps({ bottomInset: 0 }); await settle()
    expect(wrapper.get('#yn-map').attributes('data-center-lat')).toBe(after)
  })
  it('opens the visible memory route as a journey from the map summary', async () => {
    const visits = new Map([
      ['a', [summary('a')]],
      ['b', [{ ...summary('b'), date: '2025-01-02', createdAt: 2 }]],
    ])
    const wrapper = render([place('a', 100), place('b', 101)], { recordIndex: visits, visitedIds: ['a', 'b'] })
    await settle()
    for (let index = 0; index < 5 && !wrapper.find('.yn-route-summary').exists(); index++) {
      await wrapper.get('.yn-zoom-in').trigger('click')
      await settle()
    }
    await wrapper.get('.yn-route-summary').trigger('click')
    expect(wrapper.emitted('journey')).toEqual([[['a', 'b']]])
  })
  it('draws a planned route separately from remembered routes', async () => {
    const wrapper = render([place('a', 100), place('b', 101)], { plannedRouteIds: ['a', 'b'] })
    await settle()
    for (let index = 0; index < 5 && !wrapper.find('.yn-planned-summary').exists(); index++) {
      await wrapper.get('.yn-zoom-in').trigger('click')
      await settle()
    }
    expect(wrapper.find('.yn-planned-summary').text()).toContain('计划路线')
    expect(wrapper.find('.yn-memory-route').exists()).toBe(false)
    expect(wrapper.find('.yn-planned-route').exists()).toBe(true)
    await wrapper.get('.yn-planned-summary').trigger('click')
    expect(wrapper.emitted('journey')).toEqual([[['a', 'b']]])
  })
  it('releases observers, media listeners, and the Leaflet container on unmount', async () => {
    const wrapper = render([place('a', 100)])
    await settle()
    const element = wrapper.get('#yn-map').element as HTMLElement & { _leaflet_id?: number }
    expect(element._leaflet_id).toBeDefined()
    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(element._leaflet_id).toBeUndefined()
    expect(mediaListeners.size).toBe(0)
    expect(observers.every(observer => observer.disconnected)).toBe(true)
    const again = render([place('a', 100)])
    await settle()
    expect(again.find('[data-map-place="a"]').exists()).toBe(true)
  })
  const provinceFeature = (id: string, west: number, south: number, east: number, north: number): Geography['features'][number] => ({
    type: 'Feature', properties: { kind: 'province', provinceId: id, name: id },
    geometry: { type: 'Polygon', coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] },
  })
  const national: Geography = { type: 'FeatureCollection', features: [
    provinceFeature('cn-65', 74, 36, 96, 49), provinceFeature('yunnan', 98, 22, 106, 29),
    provinceFeature('cn-51', 98, 29, 109, 34), provinceFeature('cn-23', 122, 44, 134, 54),
  ] }
  it('fits nationwide below the previous zoom floor, fills province paths, and emits province choice without selecting a place', async () => {
    const wrapper = render([], { geography: national, provinceId: '', areaLabel: '全国' })
    await settle()
    expect(Number(wrapper.get('#yn-map').attributes('data-zoom'))).toBeLessThan(5)
    expect(wrapper.findAll('.yn-region-label').length).toBeGreaterThan(1)
    expect(wrapper.get('#yn-map').attributes('aria-label')).toContain('全国')
    const province = wrapper.get('[data-province-id="cn-51"]')
    expect(province.attributes('fill')).toBe('var(--yn-forest)')
    expect(Number(province.attributes('fill-opacity'))).toBeGreaterThan(0)
    await province.trigger('click')
    expect(wrapper.emitted('province')).toEqual([['cn-51']])
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.findAll('.leaflet-control-attribution a').map(link => link.attributes('href'))).toContain('https://www.geoboundaries.org/')
    expect(wrapper.get('.yn-fit').attributes('aria-label')).toBe('回到全国总览')
  })
  it('fits the newly selected province and keeps later detail updates from resetting user zoom', async () => {
    const wrapper = render([], { geography: national, provinceId: '', areaLabel: '全国' })
    await settle()
    const sichuan: Geography = { type: 'FeatureCollection', features: [provinceFeature('cn-51', 98, 29, 109, 34)] }
    await wrapper.setProps({ geography: sichuan, provinceId: 'cn-51', areaLabel: '四川' })
    await settle()
    expect(Number(wrapper.get('#yn-map').attributes('data-center-lat'))).toBeGreaterThan(30)
    expect(Number(wrapper.get('#yn-map').attributes('data-center-lng'))).toBeCloseTo(103.5, 0)
    await wrapper.get('.yn-zoom-in').trigger('click'); await settle()
    const userZoom = wrapper.get('#yn-map').attributes('data-zoom')
    await wrapper.setProps({ geography: { ...sichuan, features: [...sichuan.features] } }); await settle()
    expect(wrapper.get('#yn-map').attributes('data-zoom')).toBe(userZoom)
    expect(wrapper.find('[data-province-id]').exists()).toBe(false)
    await wrapper.setProps({ geography: national, provinceId: '', areaLabel: '全国' })
    await settle()
    expect(Number(wrapper.get('#yn-map').attributes('data-zoom'))).toBeLessThan(5)
    expect(wrapper.find('[data-province-id="cn-51"]').exists()).toBe(true)
  })
  it('restores each province viewport when returning and preserves labels on unrelated updates', async () => {
    const wrapper = render([], { geography: national, provinceId: '', areaLabel: '全国' })
    await settle()
    const nationalZoom = wrapper.get('#yn-map').attributes('data-zoom')
    const sichuan: Geography = { type: 'FeatureCollection', features: [provinceFeature('cn-51', 98, 29, 109, 34)] }
    await wrapper.setProps({ geography: sichuan, provinceId: 'cn-51' }); await settle()
    await wrapper.get('.yn-zoom-in').trigger('click'); await settle()
    const provincialZoom = wrapper.get('#yn-map').attributes('data-zoom')
    await wrapper.setProps({ geography: national, provinceId: '' }); await settle()
    expect(wrapper.get('#yn-map').attributes('data-zoom')).toBe(nationalZoom)
    const label = wrapper.get('[data-region-label="cn-65"]').element
    await wrapper.setProps({ visitedIds: ['test'] }); await settle()
    expect(wrapper.get('[data-region-label="cn-65"]').element).toBe(label)
    await wrapper.setProps({ geography: sichuan, provinceId: 'cn-51' }); await settle()
    expect(wrapper.get('#yn-map').attributes('data-zoom')).toBe(provincialZoom)
  })
  it('uses the last scope after ten rapid switches', async () => {
    const wrapper = render([], { geography: national, provinceId: '' })
    await settle()
    for (let i = 0; i < 10; i++) {
      const id = `scope-${i}`
      await wrapper.setProps({ provinceId: id, geography: { type: 'FeatureCollection', features: [provinceFeature(id, 100 + i, 29, 102 + i, 31)] } })
    }
    await settle()
    expect(wrapper.get('#yn-map').attributes('data-province')).toBe('scope-9')
    expect(Number(wrapper.get('#yn-map').attributes('data-center-lng'))).toBeCloseTo(110, 0)
  })
  it('hides a province label that overlaps its representative while keeping province navigation available', async () => {
    const yunnanMemory = { ...place('玉龙雪山', 100, 26), mapId: 'yunnan' }
    const wrapper = render([yunnanMemory], { geography: national, provinceId: '', areaLabel: '全国' })
    await settle()
    const labels = wrapper.findAll('.yn-region-label')
    expect(labels.length).toBeGreaterThan(1)
    expect(labels.some(label => label.attributes('data-region-label') === 'yunnan')).toBe(false)
    expect(wrapper.get('[data-map-place="玉龙雪山"]').attributes('aria-label')).toContain('玉龙雪山')
    await wrapper.get('[data-province-id="yunnan"]').trigger('click')
    expect(wrapper.emitted('province')).toEqual([['yunnan']])
  })
  it('budgets only in-viewport national representatives so offscreen provinces cannot hide nearby places', async () => {
    const offscreen = Array.from({ length: 20 }, (_, i) => ({ ...place(`a${i}`, 74 + i / 100, 45), mapId: `far${i}` }))
    const nearby = { ...place('z-nearby', 102, 25), mapId: 'nearby' }
    const wrapper = render([...offscreen, nearby], { provinceId: '', geography })
    await settle()
    expect(wrapper.find('[data-map-place="z-nearby"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-map-place]')).toHaveLength(1)
  })
  it('uses an unobscured national representative when fixed map controls cover another candidate', async () => {
    // jsdom's no-3D Leaflet path snaps to zoom 3; this projects behind the
    // top-right controls while remaining inside the padded viewport.
    const hidden = { ...place('control-hidden', 170, 53), mapId: 'controls' }
    const clear = { ...place('clear', 100, 25), mapId: 'clear' }
    const wrapper = render([hidden, clear], { provinceId: '', geography: national })
    await settle()
    expect(wrapper.find('[data-map-place="control-hidden"]').exists()).toBe(false)
    expect(wrapper.find('[data-map-place="clear"]').exists()).toBe(true)
    await wrapper.setProps({ selectedId: hidden.id }); await settle()
    expect(wrapper.find('[data-map-place="control-hidden"]').exists()).toBe(true)
    await wrapper.setProps({ selectedId: null, visitedIds: [hidden.id] }); await settle()
    expect(wrapper.find('[data-map-place="control-hidden"]').exists()).toBe(true)
  })
  it('handles 1000 synthetic personal points with bounded visible groups and retained update nodes', async () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ ...place(`custom-${i}`, 99 + (i % 40) * .12, 23 + Math.floor(i / 40) * .12), isCustom: true }))
    const start = performance.now()
    const wrapper = render(points)
    await settle()
    const mountedMs = performance.now() - start
    const pins = wrapper.findAll('[data-map-place]')
    expect(pins.length).toBeGreaterThan(0)
    expect(pins.length).toBeLessThan(100)
    const initial = new Set(pins.map(pin => pin.element))
    const updateStart = performance.now()
    await wrapper.setProps({ visitedIds: ['custom-1'] }); await settle()
    const updated = wrapper.findAll('[data-map-place]')
    const retained = updated.filter(pin => initial.has(pin.element)).length
    expect(retained).toBe(updated.length)
    console.info('MAP_COMPONENT_STRESS', JSON.stringify({ environment: 'jsdom actual Leaflet, 800x500, no photos; times include 30ms settle', points: 1000, mountedMs: Math.round(mountedMs), updateMs: Math.round(performance.now() - updateStart), visibleGroups: updated.length, retained }))
  })
  it('hides province labels that would collide at the current national zoom', async () => {
    const crowded: Geography = { type: 'FeatureCollection', features: [
      provinceFeature('a', 100, 25, 103, 28),
      provinceFeature('b', 100.2, 25.2, 103.2, 28.2),
      provinceFeature('c', 100.4, 25.4, 103.4, 28.4),
    ] }
    const wrapper = render([], { geography: crowded, provinceId: '', areaLabel: '全国' })
    await settle()
    expect(wrapper.findAll('.yn-region-label').length).toBeLessThan(crowded.features.length)
  })
  it('anchors a province label to the visual center of an irregular outline', async () => {
    const irregular: Geography = { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { kind: 'province', provinceId: 'irregular', name: '不规则省份' },
      geometry: { type: 'Polygon', coordinates: [[[100, 25], [104, 25], [104, 26], [101, 26], [101, 29], [100, 29], [100, 25]]] },
    }] }
    const wrapper = render([], { geography: irregular, provinceId: '', areaLabel: '全国' })
    await settle()
    const label = wrapper.get('[data-region-label="irregular"]')
    expect(Number(label.attributes('data-label-longitude'))).toBeCloseTo(101.36, 1)
    expect(Number(label.attributes('data-label-latitude'))).toBeCloseTo(26.36, 1)
  })
  it('does not bubble national marker clicks into province navigation, and picks on a province only once', async () => {
    const wrapper = render([place('成都', 104.07, 30.67)], { geography: national, provinceId: '', areaLabel: '全国' })
    await settle()
    await wrapper.get('[data-map-place="成都"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['成都']])
    expect(wrapper.emitted('province')).toBeUndefined()
    await wrapper.setProps({ pickingLocation: true }); await settle()
    await wrapper.get('[data-province-id="cn-51"]').trigger('click')
    expect(wrapper.emitted('pick')).toHaveLength(1)
    expect(wrapper.emitted('province')).toBeUndefined()
  })
})
