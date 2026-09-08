import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBObjectStore as FakeObjectStore } from 'fake-indexeddb'
import { createHash, randomUUID, webcrypto } from 'node:crypto'
import { createRemoteServices, getSession, accountDatabaseName } from '../src/remote'
import type { RemoteBundle, RemoteSession } from '../src/remote'
import { AccountStore } from '../src/remote/store'
import type { Draft, Visit } from '../src/domain/models'

const origin = 'http://127.0.0.1:5192', alice = '11111111-1111-4111-8111-111111111111', bob = '22222222-2222-4222-8222-222222222222'
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
// Protocol fixture only: byte header exercises transport/hash logic, not native image decode.
const storedBytes = Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex')
const session = (id = alice): RemoteSession => ({ account: { id, status: 'active' }, csrfToken: 'a'.repeat(43), expiresAt: '2027-01-01T00:00:00Z' })
const visit = (photo = false): Visit => ({ id: 'visit-' + randomUUID(), createdAt: 1, placeId: 'yulong', date: '2026-09-01', note: '合成账号手记', photos: photo ? [{ id: 'photo-' + randomUUID(), name: 'sample.png', url: png }] : [], coverId: null })
const bundles: RemoteBundle[] = []
afterEach(async () => { await Promise.all(bundles.splice(0).map(bundle => bundle.dispose())); vi.useRealTimers() })
function server() {
  let active = alice, lost: string | null = null, rejectCapability = false, pause: (() => Promise<void>) | undefined
  const accounts = new Map<string, { sequence: number; commits: any[]; visits: Record<string, any>; places: Record<string, any>; photos: Record<string, any>; uploads: Record<string, any>; covers: Record<string, any>; receipts: Map<string, any> }>()
  const calls: { path: string; method: string; key: string | null; redirect?: RequestRedirect; body: any }[] = []
  const data = (owner = active) => {
    if (!accounts.has(owner)) accounts.set(owner, { sequence: 0, commits: [], visits: {}, places: {}, photos: {}, uploads: {}, covers: {}, receipts: new Map() })
    return accounts.get(owner)!
  }
  const commit = (changes: any[], owner = active) => { const state = data(owner); state.sequence++; state.commits.push(JSON.parse(JSON.stringify({ id: randomUUID(), sequence: String(state.sequence), changes }))) }
  const upsert = (entity: string, value: any) => ({ entity, id: value.id, version: value.version, operation: 'upsert', value })
  const transport = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)), path = url.pathname.replace('/api/v1', ''), method = init.method || 'GET', headers = new Headers(init.headers), owner = active, state = data(owner)
    const key = headers.get('Idempotency-Key'), body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body
    calls.push({ path, method, key, body, redirect: init.redirect })
    const response = (value: any, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'X-Shanhai-Account': owner } })
    const error = (status: number, code = 'NOT_FOUND') => response({ error: { code } }, status)
    const lose = (phase: string) => { if (lost === phase) { lost = null; throw new TypeError('synthetic response dropped after durable server action') } }
    if (path === '/capabilities') return response({ testIdentityOnly: true, validationVersion: 'national-test', catalogueVersion: 'catalogue-test' })
    if (path === '/session') return response(session(owner))
    if (headers.has('X-Shanhai-Account') && headers.get('X-Shanhai-Account') !== owner) return error(409, 'ACCOUNT_CHANGED')
    if (path.startsWith('/mutations/')) { const previous = state.receipts.get(decodeURIComponent(path.slice(11))); return previous ? response({ result: previous }) : error(404) }
    if (path === '/sync/changes') {
      if (pause) { const wait = pause; pause = undefined; await wait() }
      const after = Number(url.searchParams.get('cursor')?.split(':').at(-1) || 0)
      return response({ commits: state.commits.filter(row => Number(row.sequence) > after), nextCursor: owner + ':' + state.sequence, hasMore: false })
    }
    if (key && state.receipts.has(key)) return response(state.receipts.get(key), path === '/visits' || path === '/photos/uploads' || path === '/custom-places' ? 201 : 200)
    if (path === '/custom-places' && method === 'POST') {
      const value = { ...body, id: randomUUID(), version: '1' }; state.places[value.id] = value; commit([upsert('customPlace', value)], owner)
      const result = { customPlace: value }; state.receipts.set(key!, result); return response(result, 201)
    }
    if (path === '/photos/uploads' && method === 'POST') {
      const photoId = randomUUID(), uploadId = randomUUID()
      state.uploads[uploadId] = { uploadId, photoId, state: 'prepared', inputSha256: body.sha256, name: body.name }
      const result = { uploadId, photoId, state: 'prepared', upload: { url: origin + '/api/v1/uploads/' + uploadId + '/content?token=synthetic-only', headers: { 'Content-Type': body.contentType } } }
      state.receipts.set(key!, result); lose('prepare'); return response(result, 201)
    }
    const put = /^\/uploads\/([^/]+)\/content$/.exec(path)
    if (put && method === 'PUT') { const row = state.uploads[put[1]!]; if (rejectCapability) { rejectCapability = false; return error(403, 'CAPABILITY_REVOKED') } if (row.state !== 'prepared') return error(409, 'UPLOAD_ALREADY_USED'); row.state = 'uploaded'; lose('put'); return response({ state: 'uploaded' }) }
    const complete = /^\/photos\/uploads\/([^/]+)\/complete$/.exec(path)
    if (complete && method === 'POST') {
      const row = state.uploads[complete[1]!]
      if (!['uploaded', 'ready'].includes(row.state)) return error(409)
      row.state = 'ready'
      const photo = { id: row.photoId, name: row.name, inputSha256: row.inputSha256, storedSha256: hash(storedBytes), sha256: hash(storedBytes), bytes: storedBytes.length, state: 'ready', version: '2' }
      state.photos[photo.id] = photo; commit([upsert('photo', photo)], owner)
      const result = { photo }; state.receipts.set(key!, result); lose('complete'); return response(result)
    }
    const status = /^\/photos\/uploads\/([^/]+)$/.exec(path)
    if (status && method === 'GET') return state.uploads[status[1]!] ? response(state.uploads[status[1]!]) : error(404)
    if (status && method === 'DELETE') { const row = state.uploads[status[1]!]!; row.state = 'cancelled'; const result = { state: 'cancelled' }; state.receipts.set(key!, result); lose('cancel'); return response(result) }
    if (path === '/visits' && method === 'POST') {
      for (const item of body.photos) if (Object.values(state.visits).some(visit => visit.photos.some((photo: any) => photo.id === item.id))) return error(422, 'PHOTO_NOT_READY')
      const value = { ...body, id: randomUUID(), version: '1' }; state.visits[value.id] = value; commit([upsert('visit', value)], owner)
      const result = { visit: value }; state.receipts.set(key!, result); lose('visit'); return response(result, 201)
    }
    const resource = /^\/visits\/([^/]+)$/.exec(path)
    if (resource) {
      const value = state.visits[resource[1]!]; if (!value) return error(410, 'RESOURCE_DELETED')
      if (method === 'GET') return response({ visit: value })
      if (headers.get('If-Match') !== '"' + value.version + '"') return error(412, 'VERSION_CONFLICT')
      if (method === 'PATCH') { const next = { ...value, ...body, version: String(Number(value.version) + 1) }; state.visits[next.id] = next; commit([upsert('visit', next)], owner); const result = { visit: next }; state.receipts.set(key!, result); return response(result) }
      if (method === 'DELETE') {
        const changes = [{ entity: 'visit', id: value.id, version: String(Number(value.version) + 1), operation: 'delete' }]
        for (const photo of value.photos) { delete state.photos[photo.id]; changes.push({ entity: 'photo', id: photo.id, version: '3', operation: 'delete' }) }
        for (const cover of Object.values(state.covers)) if (cover.visitId === value.id) { delete state.covers[cover.id]; changes.push({ entity: 'mapCover', id: cover.id, version: '2', operation: 'delete' }) }
        delete state.visits[value.id]; commit(changes, owner); const result = { deleted: { id: value.id, version: '2' } }; state.receipts.set(key!, result); return response(result)
      }
    }
    const cover = /^\/map-covers\/([^/]+)$/.exec(path)
    if (cover && method === 'PUT') { const id = decodeURIComponent(cover[1]!); if ((state.covers[id] && !headers.has('If-Match')) || (!state.covers[id] && headers.get('If-None-Match') !== '*')) return error(428, 'VERSION_REQUIRED'); if (state.covers[id] && headers.get('If-Match') !== '"' + state.covers[id].version + '"') return error(412, 'VERSION_CONFLICT'); const value = { id, placeKey: id, ...body, version: String(Number(state.covers[id]?.version || 0) + 1) }; state.covers[id] = value; commit([upsert('mapCover', value)], owner); const result = { mapCover: value }; state.receipts.set(key!, result); return response(result) }
    const download = /^\/photos\/([^/]+)\/download-url$/.exec(path)
    if (download) return state.photos[download[1]!] ? response({ url: origin + '/api/v1/photos/' + download[1] + '/content?token=synthetic-only', mime: 'image/jpeg', bytes: storedBytes.length, sha256: hash(storedBytes) }) : error(404)
    if (/^\/photos\/[^/]+\/content$/.test(path)) return new Response(storedBytes, { headers: { 'Content-Type': 'image/jpeg' } })
    return error(404)
  }) as unknown as typeof fetch
  return { transport, calls, data, commit, upsert, switch(owner: string) { active = owner }, lose(phase: string) { lost = phase }, rejectCapabilityOnce() { rejectCapability = true }, pause(action: () => Promise<void>) { pause = action } }
}
function harness() {
  const remote = server(), indexedDB = new IDBFactory()
  const options = { origin, fetch: remote.transport, indexedDB, crypto: webcrypto as unknown as Crypto }
  const open = async (owner = alice) => { const bundle = await createRemoteServices(session(owner), options); bundles.push(bundle); return bundle }
  const inspect = (owner = alice) => new AccountStore(indexedDB, accountDatabaseName(owner), () => {})
  return { remote, options, indexedDB, open, inspect }
}

describe('remote repository: real fake-indexeddb transactions with a stateful protocol fixture', () => {
  it('never opens anonymous storage; account drafts CAS round-trip without mixing A/B', async () => {
    const h = harness(), spy = vi.spyOn(h.indexedDB, 'open'), a = await h.open()
    const value: Draft = { id: 'draft-one', visitId: 'visit-one', createdAt: 1, placeId: 'yulong', date: '2026-09-01', note: 'A的草稿', photos: [], coverId: null, updatedAt: 1 }
    const saved = await a.services.repository.saveDraft(value, { expectedVersion: null })
    await expect(a.services.repository.saveDraft(value, { expectedVersion: null })).rejects.toMatchObject({ code: 'draft-conflict' })
    await a.dispose(); const reopened = await h.open(); expect(await reopened.services.repository.loadDraft()).toEqual(saved)
    await reopened.dispose(); h.remote.switch(bob); const b = await h.open(bob); expect(await b.services.repository.loadDraft()).toBeNull()
    expect(spy.mock.calls.every(([name]) => name.startsWith('shanhai-account-v1-'))).toBe(true)
    expect(b.capabilities).toEqual({ backup: false, restore: false, undo: false })
    await expect(b.services.repository.load()).rejects.toMatchObject({ code: 'remote-capability-disabled' })
    await expect(b.services.exports.prepare()).rejects.toMatchObject({ code: 'remote-capability-disabled' })
  })
  it.each(['prepare', 'put', 'complete', 'visit'])('recovers %s response loss with durable original operation and no duplicate visit/photo', async phase => {
    const h = harness(), first = await h.open(), value = visit(true); value.coverId = value.photos[0]!.id
    h.remote.lose(phase)
    if (phase === 'put' || phase === 'visit') await first.services.repository.addVisit(value)
    else await expect(first.services.repository.addVisit(value)).rejects.toThrow()
    const entries = await h.inspect().all<any>('outbox'); expect(entries).toHaveLength(1)
    const operationId = entries[0].id
    await first.dispose(); const restarted = await h.open(); await restarted.retryPending()
    expect(Object.keys(h.remote.data().visits)).toHaveLength(1); expect(Object.keys(h.remote.data().uploads)).toHaveLength(1)
    const index = await restarted.services.repository.loadIndex(); expect(index.visits[0]!.id).toBe(value.id)
    expect(JSON.stringify(index)).not.toContain('data:image'); expect(JSON.stringify(index)).not.toContain('token=')
    const detail = await restarted.services.repository.readVisit(value.id)
    expect(detail!.photos[0]!.url).toBe('data:image/jpeg;base64,' + Buffer.from(storedBytes).toString('base64'))
    expect(detail!.photos[0]!.id).not.toBe(value.photos[0]!.id)
    const done = (await h.inspect().all<any>('outbox'))[0]; expect(done.id).toBe(operationId); expect(done.status).toBe('done'); expect(done.payload).toBeUndefined()
    expect(JSON.stringify(done)).not.toContain('token='); expect(JSON.stringify(done)).not.toContain('base64')
    expect(h.remote.calls.every(call => call.redirect === 'error')).toBe(true)
    expect(h.remote.calls.filter(call => call.path === '/visits' && call.method === 'POST').every(call => call.key === operationId + ':commit')).toBe(true)
  })
  it('keeps read-time CAS markers through editor draft normalization and rejects stale edits without overwriting', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit()
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!
    await repo.saveDraft({ id: 'draft-edit', visitId: value.id, createdAt: 1, placeId: value.placeId, date: value.date, note: '未保存新文字', photos: [], coverId: null, updatedAt: 1, originalVisit: JSON.parse(JSON.stringify(original)) }, { expectedVersion: null })
    const remoteRow = Object.values(h.remote.data().visits)[0]!; remoteRow.version = '2'; remoteRow.note = '另一端版本'; h.remote.commit([h.remote.upsert('visit', remoteRow)])
    await bundle.refresh(); const draft = await repo.loadDraft()
    expect((draft!.originalVisit as any).remoteVersion).toBe('1')
    await expect(repo.updateVisit({ ...original, note: '不能覆盖' }, { expectedVisit: draft!.originalVisit! })).rejects.toMatchObject({ code: 'stale' })
    expect(Object.values(h.remote.data().visits)[0]!.note).toBe('另一端版本')
    expect((await repo.loadDraft())!.note).toBe('未保存新文字')
    await repo.clearDraft(draft!.id, { expectedVersion: draft!.version! })
    expect((await h.inspect().all<any>('outbox')).some(row => row.status === 'discarded')).toBe(true)
  })
  it('only reconciles exact current committed payload; a historical same-payload receipt cannot swallow a new edit', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit()
    await repo.addVisit(value)
    expect(await repo.reconcilePendingVisit!(value)).toMatchObject({ id: value.id, note: value.note })
    const row = Object.values(h.remote.data().visits)[0]!; row.version = '2'; row.note = 'other device'; h.remote.commit([h.remote.upsert('visit', row)])
    await bundle.refresh(); expect(await repo.reconcilePendingVisit!(value)).toBeNull()
    expect(await repo.reconcilePendingVisit!({ ...value, note: 'never sent' })).toBeNull()
  })
  it('new copy uploads fresh photo ownership, while an unchanged edit reuses its own immutable photo', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!
    await repo.updateVisit({ ...original, note: 'same photo edit' }, { expectedVisit: original })
    expect(Object.keys(h.remote.data().uploads)).toHaveLength(1)
    const copied = { ...original, id: 'visit-' + randomUUID(), note: '另存新回忆' }
    await repo.addVisit(copied)
    expect(Object.keys(h.remote.data().uploads)).toHaveLength(2)
    const rows = Object.values(h.remote.data().visits); expect(rows[0]!.photos[0].id).not.toBe(rows[1]!.photos[0].id)
  })
  it('maps custom identities and applies visit/photo/map-cover deletion as one complete cached commit', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    value.customPlace = { id: 'custom-local', name: '成都合成地点', regionId: 'cn-51', coordinates: [104.0665, 30.5728] }; value.placeId = value.customPlace.id
    await repo.addVisit(value); const canonical = (await repo.reconcilePendingVisit!(value))!
    expect(canonical.placeId).toMatch(/^custom-[a-f0-9-]{36}$/); expect(canonical.id).toBe(value.id)
    await repo.setMapCover(canonical.placeId, { visitId: canonical.id, photoId: canonical.photos[0]!.id })
    expect((await repo.loadIndex()).covers).toHaveLength(1)
    await repo.deleteVisit(canonical.id, { expectedVisit: canonical })
    const cache = await h.inspect().cache(); expect(Object.keys(cache.visits)).toHaveLength(0); expect(Object.keys(cache.photos)).toHaveLength(0); expect(Object.keys(cache.covers)).toHaveLength(0)
    expect(h.remote.data().commits.at(-1).changes).toHaveLength(3)
  })
  it('rejects abandoning a draft with an unconfirmed operation, retaining exact bytes and retry path', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    const draft = await repo.saveDraft({ id: 'draft-pending', visitId: value.id, createdAt: 1, placeId: value.placeId, date: value.date, note: value.note, photos: value.photos, coverId: value.coverId, updatedAt: 1 }, { expectedVersion: null })
    h.remote.lose('prepare'); await expect(repo.addVisit(value)).rejects.toThrow()
    await expect(repo.clearDraft(draft.id, { expectedVersion: draft.version })).rejects.toMatchObject({ code: 'pending-conflict' })
    expect((await repo.loadDraft())!.photos[0]!.url).toBe(png)
    await bundle.retryPending(); await repo.clearDraft(draft.id, { expectedVersion: draft.version }); expect(await repo.loadDraft()).toBeNull()
  })
  it('drops late A responses after disposal and never writes them to the B database', async () => {
    const h = harness(), a = await h.open(); let release!: () => void
    h.remote.pause(() => new Promise<void>(resolve => { release = resolve }))
    const old = a.refresh(); await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await a.dispose(); h.remote.switch(bob); const b = await h.open(bob)
    release(); await expect(old).rejects.toMatchObject({ code: 'unauthorized' })
    expect((await h.inspect(bob).cache()).visits).toEqual({}); expect(b.state.accountId).toBe(bob)
  })
  it('binds private responses to the active account before parsing or caching another account data', async () => {
    const h = harness(), bundle = await h.open(); h.remote.switch(bob)
    await expect(bundle.refresh()).rejects.toMatchObject({ code: 'unauthorized' })
    expect(bundle.state.status).toBe('unauthorized'); expect((await h.inspect().cache()).sequence).toBe('0')
  })
  it('rolls back a malformed multi-entity commit and its cursor together', async () => {
    const h = harness(), store = h.inspect(), valid = { entity: 'visit', id: 'one', version: '1', operation: 'upsert', value: { id: 'one', version: '1' } }
    await expect(store.apply({ commits: [{ sequence: '1', changes: [valid, { entity: 'unexpected', id: 'two', version: '1', operation: 'delete' }] }], nextCursor: 'must-not-commit', hasMore: false }, null)).rejects.toMatchObject({ code: 'invalid-sync' })
    expect((await store.cache()).cursor).toBeNull(); expect((await store.cache()).visits).toEqual({})
  })
  it('session bootstrap is bounded and forbids redirects while carrying authentication data', async () => {
    vi.useFakeTimers()
    const transport = vi.fn((_url: RequestInfo | URL, options?: RequestInit) => new Promise<Response>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('timeout', 'AbortError'))))) as unknown as typeof fetch
    const request = getSession({ origin, fetch: transport }); const assertion = expect(request).rejects.toMatchObject({ code: 'remote-unavailable', friendlyMessage: expect.stringContaining('尚未确认') })
    await vi.advanceTimersByTimeAsync(20_001); await assertion
    expect(vi.mocked(transport).mock.calls[0]![1]!.redirect).toBe('error')
  })
  it('retries a failed database open and closes a blocked request that succeeds after its rejection', async () => {
    const factory = new IDBFactory(), original = factory.open.bind(factory), lateClose = vi.fn()
    let first: any
    vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      first = { result: { close: lateClose } }; queueMicrotask(() => first.onblocked(new Event('blocked')))
      return first as IDBOpenDBRequest
    }).mockImplementation(original)
    const store = new AccountStore(factory, accountDatabaseName(alice), () => {})
    await expect(store.cache()).rejects.toMatchObject({ code: 'db-blocked' })
    first.onsuccess(new Event('success')); expect(lateClose).toHaveBeenCalledTimes(1)
    expect((await store.cache()).sequence).toBe('0'); store.close()
  })
  it.each(['expired', 'revoked-session', 'cancel-response'])('safely rotates %s prepared upload with a new photo generation and the same final save operation', async reason => {
    const h = harness(), first = await h.open(), value = visit(true); value.coverId = value.photos[0]!.id
    h.remote.lose('prepare'); await expect(first.services.repository.addVisit(value)).rejects.toMatchObject({ friendlyMessage: expect.stringContaining('尚未确认') })
    const originalUpload = Object.values(h.remote.data().uploads)[0]!
    if (reason !== 'revoked-session') originalUpload.expiresAt = '2000-01-01T00:00:00Z'
    else h.remote.rejectCapabilityOnce()
    const originalOperation = (await h.inspect().all<any>('outbox'))[0].id
    await first.dispose(); let resumed = await h.open()
    if (reason === 'cancel-response') {
      h.remote.lose('cancel'); await expect(resumed.retryPending()).rejects.toMatchObject({ code: 'remote-unavailable' })
      expect((await h.inspect().all<any>('outbox'))[0].status).toBe('pending')
      await resumed.dispose(); resumed = await h.open()
    }
    await resumed.retryPending()
    const uploads = Object.values(h.remote.data().uploads)
    expect(uploads).toHaveLength(2); expect(originalUpload.state).toBe('cancelled'); expect(uploads[0]!.photoId).not.toBe(uploads[1]!.photoId)
    expect(Object.keys(h.remote.data().visits)).toHaveLength(1)
    expect(h.remote.calls.filter(call => call.path === '/visits' && call.method === 'POST').map(call => call.key)).toEqual([originalOperation + ':commit'])
    expect(resumed.state.pending).toBe(0)
  })
  it('a fresh explicit cover/delete decision can replace terminal CAS conflicts without silently upgrading old requests', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!
    const cover = { visitId: original.id, photoId: original.photos[0]!.id }
    await repo.setMapCover(original.placeId, cover)
    const remoteCover = Object.values(h.remote.data().covers)[0]!; remoteCover.version = '2'; h.remote.commit([h.remote.upsert('mapCover', remoteCover)])
    await expect(repo.setMapCover(original.placeId, cover)).rejects.toMatchObject({ code: 'stale' })
    expect(bundle.state.pending).toBe(1)
    await bundle.refresh(); await repo.setMapCover(original.placeId, cover)
    expect(Object.values(h.remote.data().covers)[0]!.version).toBe('3')
    const remoteVisit = Object.values(h.remote.data().visits)[0]!; remoteVisit.version = '2'; remoteVisit.note = 'another edit'; h.remote.commit([h.remote.upsert('visit', remoteVisit)])
    await expect(repo.deleteVisit(original.id, { expectedVisit: original })).rejects.toMatchObject({ code: 'stale' })
    await bundle.refresh(); const fresh = (await repo.readVisit(original.id))!
    await repo.deleteVisit(fresh.id, { expectedVisit: fresh })
    expect(bundle.state.pending).toBe(0)
    expect((await h.inspect().all<any>('outbox')).filter(row => row.status === 'discarded')).toHaveLength(2)
  })
  it.each(['absent-to-present', 'present-to-absent'])('recovers actual backend 428 for a %s cover race and never replays an ancient absence receipt', async direction => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!, reference = { visitId: original.id, photoId: original.photos[0]!.id }
    const remoteVisit = Object.values(h.remote.data().visits)[0]!, id = 'public:yulong'
    if (direction === 'present-to-absent') {
      await repo.setMapCover(original.placeId, reference)
      delete h.remote.data().covers[id]; h.remote.commit([{ entity: 'mapCover', id, version: '2', operation: 'delete' }])
    } else {
      const cover = { id, placeKey: id, visitId: remoteVisit.id, photoId: reference.photoId, version: '1' }
      h.remote.data().covers[id] = cover; h.remote.commit([h.remote.upsert('mapCover', cover)])
    }
    await expect(repo.setMapCover(original.placeId, reference)).rejects.toMatchObject({ status: 428 })
    expect(bundle.state.pending).toBe(1)
    await bundle.refresh(); await repo.setMapCover(original.placeId, reference)
    expect((await repo.loadIndex()).covers).toHaveLength(1); expect(bundle.state.pending).toBe(0)
    expect((await h.inspect().all<any>('outbox')).filter(row => row.status === 'discarded')).toHaveLength(1)
  })
  it('does not report a historical create receipt as a new successful save after the visit was deleted', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit()
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!
    await repo.deleteVisit(value.id, { expectedVisit: original })
    await expect(repo.addVisit(value)).rejects.toMatchObject({ code: 'missing' })
    expect((await repo.loadIndex()).visits).toHaveLength(0)
  })
  it('allows a fresh explicit absence decision after a create/delete ABA without upgrading the old 428 operation', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!, reference = { visitId: original.id, photoId: original.photos[0]!.id }
    const remoteVisit = Object.values(h.remote.data().visits)[0]!, id = 'public:yulong'
    const createdElsewhere = { id, placeKey: id, visitId: remoteVisit.id, photoId: reference.photoId, version: '1' }
    h.remote.data().covers[id] = createdElsewhere; h.remote.commit([h.remote.upsert('mapCover', createdElsewhere)])
    await expect(repo.setMapCover(original.placeId, reference)).rejects.toMatchObject({ status: 428 })
    const failed = (await h.inspect().all<any>('outbox')).find(row => row.kind === 'cover')!
    expect(failed.status).toBe('conflict'); expect(failed.expected.version).toBeNull()
    const attemptsBeforeRefresh = h.remote.calls.filter(call => call.path.startsWith('/map-covers/') && call.method === 'PUT').length
    delete h.remote.data().covers[id]; h.remote.commit([{ entity: 'mapCover', id, version: '2', operation: 'delete' }])
    await bundle.refresh()
    expect(h.remote.calls.filter(call => call.path.startsWith('/map-covers/') && call.method === 'PUT')).toHaveLength(attemptsBeforeRefresh)
    expect((await h.inspect().all<any>('outbox')).find(row => row.id === failed.id)!.status).toBe('conflict')
    await repo.setMapCover(original.placeId, reference)
    const operations = (await h.inspect().all<any>('outbox')).filter(row => row.kind === 'cover')
    expect(operations).toHaveLength(2)
    expect(operations.find(row => row.id === failed.id)!.status).toBe('discarded')
    const replacement = operations.find(row => row.id !== failed.id)!
    expect(replacement.status).toBe('done')
    expect(h.remote.calls.filter(call => call.path.startsWith('/map-covers/') && call.method === 'PUT').map(call => call.key)).toEqual([failed.id + ':commit', replacement.id + ':commit'])
    expect((await repo.loadIndex()).covers).toHaveLength(1); expect(bundle.state.pending).toBe(0)
  })
  it('archives the same draft old terminal conflict when saving a new visit identity after the original is deleted', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    await repo.addVisit(value); const original = (await repo.readVisit(value.id))!
    const draft = await repo.saveDraft({ id: 'draft-same-slot-copy', visitId: original.id, createdAt: original.createdAt, placeId: original.placeId,
      date: original.date, note: '保留本页文字并另存', photos: original.photos, coverId: original.coverId, updatedAt: 1, originalVisit: original }, { expectedVersion: null })
    const remoteVisit = Object.values(h.remote.data().visits)[0]!
    remoteVisit.version = '2'; remoteVisit.note = '另一页已提交版本二'; h.remote.commit([h.remote.upsert('visit', remoteVisit)])
    await expect(repo.updateVisit({ ...original, note: draft.note }, { expectedVisit: original })).rejects.toMatchObject({ code: 'stale' })
    const failed = (await h.inspect().all<any>('outbox')).find(row => row.kind === 'update')!
    expect(failed.status).toBe('conflict'); expect(failed.target).toBe(original.id)

    // The other page deletes the original, including its owned photo; this tab
    // retains the already loaded dataURL in its saved draft for explicit copying.
    delete h.remote.data().visits[remoteVisit.id]
    const deletes = [{ entity: 'visit', id: remoteVisit.id, version: '3', operation: 'delete' }]
    for (const photo of remoteVisit.photos) { delete h.remote.data().photos[photo.id]; deletes.push({ entity: 'photo', id: photo.id, version: '3', operation: 'delete' }) }
    h.remote.commit(deletes); await bundle.refresh()

    // Match MemoryEditor.saveCopy: same draft.id, new visitId, no originalVisit.
    const copyId = 'visit-' + randomUUID(), copyDraft = { ...draft, visitId: copyId, createdAt: Date.now(), updatedAt: Date.now() }
    delete copyDraft.originalVisit
    const savedCopyDraft = await repo.saveDraft(copyDraft, { expectedVersion: draft.version })
    const archived = (await h.inspect().all<any>('outbox')).find(row => row.id === failed.id)!
    expect(archived.status).toBe('discarded'); expect(archived.payload).toBeUndefined(); expect(archived.expected).toBeUndefined()
    expect(savedCopyDraft.photos[0]!.url).toBe(draft.photos[0]!.url)
    const copied: Visit = { id: copyId, createdAt: savedCopyDraft.createdAt, placeId: savedCopyDraft.placeId, date: savedCopyDraft.date,
      note: savedCopyDraft.note, photos: savedCopyDraft.photos, coverId: savedCopyDraft.coverId }
    await repo.addVisit(copied)
    expect(await repo.clearDraft(savedCopyDraft.id, { expectedVersion: savedCopyDraft.version })).toBe(true)
    expect(await repo.loadDraft()).toBeNull()
    expect((await repo.loadIndex()).visits.map(row => row.id)).toEqual([copyId])
    expect((await h.inspect().all<any>('outbox')).find(row => row.id === failed.id)!.status).toBe('discarded')
    expect(bundle.state.pending).toBe(0)
    expect(Object.values(h.remote.data().visits)[0]!.photos[0].id).not.toBe(original.photos[0]!.id)
    const writes = () => h.remote.calls.filter(call => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(call.method)).length
    const beforeRetry = writes(); await bundle.retryPending(); expect(writes()).toBe(beforeRetry)
    await bundle.dispose(); const reopened = await h.open()
    expect(reopened.state.pending).toBe(0); expect(reopened.state.status).toBe('ready')
    expect(await reopened.services.repository.loadDraft()).toBeNull()
  })
  it('refuses changing the same draft identity while an old operation is still unconfirmed, preserving every byte and key', async () => {
    const h = harness(), bundle = await h.open(), repo = bundle.services.repository, value = visit(true); value.coverId = value.photos[0]!.id
    const draft = await repo.saveDraft({ id: 'draft-unknown-copy', visitId: value.id, createdAt: 1, placeId: value.placeId, date: value.date,
      note: value.note, photos: value.photos, coverId: value.coverId, updatedAt: 1 }, { expectedVersion: null })
    h.remote.lose('prepare'); await expect(repo.addVisit(value)).rejects.toMatchObject({ code: 'remote-unavailable' })
    const before = await h.inspect().all<any>('outbox'); expect(before[0].status).toBe('pending')
    await expect(repo.saveDraft({ ...draft, visitId: 'visit-' + randomUUID() }, { expectedVersion: draft.version })).rejects.toMatchObject({ code: 'pending-conflict' })
    expect(await repo.loadDraft()).toEqual(draft)
    expect(await h.inspect().all<any>('outbox')).toEqual(before)
    expect(before[0].payload.photos[0].url).toBe(png)
  })
  it('archives only the previous target on a CAS-valid same-draft identity change, never on normal edits, wrong CAS, or another draft', async () => {
    const h = harness(), store = h.inspect(), draft: Draft = { id: 'draft-scope', visitId: 'visit-old', createdAt: 1, placeId: 'yulong', date: '2026-09-01', note: 'keep', photos: [], coverId: null, updatedAt: 1 }
    const saved = await store.draftWrite(draft, null)
    const failed = { id: 'old-conflict', kind: 'update', target: 'visit-old', status: 'conflict', digest: 'old', createdAt: 1, payload: { note: 'old rejected input' }, expected: { version: '1' }, steps: {} }
    const otherConflict = { ...failed, id: 'other-conflict', target: 'visit-other', digest: 'other' }
    const otherPending = { ...otherConflict, id: 'other-pending', target: 'visit-pending', status: 'pending' }
    await store.write('outbox', failed.id, failed); await store.write('outbox', otherConflict.id, otherConflict); await store.write('outbox', otherPending.id, otherPending)
    const before = await store.all<any>('outbox')
    await expect(store.draftWrite({ ...saved, visitId: 'visit-copy' }, '0')).rejects.toMatchObject({ code: 'draft-conflict' })
    expect(await store.all('outbox')).toEqual(before); expect(await store.read('draft', 'current')).toEqual(saved)
    const edited = await store.draftWrite({ ...saved, note: 'ordinary same-identity edit' }, saved.version)
    expect(await store.all('outbox')).toEqual(before)
    const copied = await store.draftWrite({ ...edited, visitId: 'visit-copy' }, edited.version)
    const after = await store.all<any>('outbox')
    expect(after.find(row => row.id === failed.id)).toMatchObject({ status: 'discarded' })
    expect(after.find(row => row.id === otherConflict.id)).toEqual(otherConflict)
    expect(after.find(row => row.id === otherPending.id)).toEqual(otherPending)
    // Even with a valid slot version, replacing a different draft identity is
    // not the same saveCopy decision and must not archive that target's conflict.
    const currentConflict = { ...failed, id: 'copy-conflict', target: copied.visitId }
    await store.write('outbox', currentConflict.id, currentConflict)
    await store.draftWrite({ ...copied, id: 'unrelated-draft', visitId: 'visit-unrelated' }, copied.version)
    expect((await store.all<any>('outbox')).find(row => row.id === currentConflict.id)).toEqual(currentConflict)
  })
  it('rolls back conflict archival if persisting the replacement draft fails in the same transaction', async () => {
    const h = harness(), store = h.inspect(), draft: Draft = { id: 'draft-atomic-copy', visitId: 'visit-old', createdAt: 1, placeId: 'yulong', date: '2026-09-01', note: 'keep all content', photos: [], coverId: null, updatedAt: 1 }
    const saved = await store.draftWrite(draft, null)
    const failed = { id: 'failed-update', kind: 'update', target: draft.visitId, status: 'conflict', digest: 'old', createdAt: 1, payload: { note: 'retain after rollback' }, expected: { version: '1' }, steps: {} }
    await store.write('outbox', failed.id, failed)
    const originalPut = FakeObjectStore.prototype.put
    const put = vi.spyOn(FakeObjectStore.prototype, 'put').mockImplementation(function(this: IDBObjectStore, value: any, key?: IDBValidKey) {
      if (this.name === 'draft' && value.visitId === 'visit-copy') throw new DOMException('synthetic quota failure', 'QuotaExceededError')
      return originalPut.call(this, value, key)
    })
    try { await expect(store.draftWrite({ ...saved, visitId: 'visit-copy' }, saved.version)).rejects.toMatchObject({ name: 'QuotaExceededError' }) }
    finally { put.mockRestore() }
    expect(await store.read('draft', 'current')).toEqual(saved)
    expect(await store.all('outbox')).toEqual([failed])
  })
})
