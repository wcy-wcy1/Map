import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { randomUUID, createHash } from 'node:crypto'
import path from 'node:path'
import http from 'node:http'
import pg from 'pg'
import sharp from 'sharp'
import { createApp } from '../dist/app.js'
import { migrate } from '../dist/migrate.js'
import { validateConfig } from '../dist/config.js'
import { Catalogue, within } from '../dist/catalogue.js'

const origin = 'http://127.0.0.1:5191'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
let app, config, db, alice, alice2, bob, capabilities, source, place, savedPhoto, savedVisit
const identity = () => randomUUID()
async function call(who, method, route, body, extra = {}, key = identity()) {
  const headers = { Origin: origin, ...(who ? { Cookie: who.cookie, 'X-CSRF-Token': who.csrf } : {}), ...extra }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['Idempotency-Key'] = key
  for (const [name, value] of Object.entries(extra)) if (value === null) delete headers[name]
  const response = await fetch(origin + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : {} }
}
const expect = (result, status, code) => {
  assert.equal(result.status, status, JSON.stringify(result.body))
  if (code) assert.equal(result.body.error?.code, code)
  return result.body
}
async function login(subject) {
  const result = await call(null, 'POST', '/api/v1/testing/login', { subject, secret: config.testAuthSecret })
  const value = expect(result, 200)
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
  return { cookie: result.headers.get('set-cookie').split(';')[0], csrf: value.csrfToken, id: value.account.id }
}
const visitBody = (photo = null, custom = place.id) => ({ clientId: identity(), clientCreatedAt: Date.now(), place: { kind: 'custom', id: custom }, date: '2026-09-01', note: '合成测试：茶香与细雨。', photos: photo ? [{ id: photo, position: 0 }] : [], coverPhotoId: photo })
async function prepare(who = alice, bytes = source, mime = 'image/jpeg', digest = hash(bytes), clientPhotoId = identity()) {
  return expect(await call(who, 'POST', '/api/v1/photos/uploads', { clientPhotoId, name: '合成照片.jpg', contentType: mime, bytes: bytes.length, sha256: digest }), 201)
}
async function upload(prepared, bytes = source, headers = prepared.upload.headers) {
  const response = await fetch(prepared.upload.url, { method: 'PUT', headers, body: bytes })
  const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : {} }
}
async function ready(who = alice, bytes = source, mime = 'image/jpeg') {
  const prepared = await prepare(who, bytes, mime)
  expect(await upload(prepared, bytes), 200)
  const photo = expect(await call(who, 'POST', `/api/v1/photos/uploads/${prepared.uploadId}/complete`, {}), 200).photo
  return { ...prepared, photo }
}

before(async () => {
  const runtime = JSON.parse(await readFile(new URL('../.local/runtime.json', import.meta.url), 'utf8'))
  const databaseUrl = runtime.testDatabaseUrl
  // Never reset or truncate the database. Each test creates new synthetic client identities.
  assert.equal(new URL(databaseUrl).pathname, '/shanhai_api_test')
  await migrate(databaseUrl)
  db = new pg.Client({ connectionString: databaseUrl }); await db.connect()
  const storageRoot = path.resolve('.local/api-test-objects')
  config = { databaseUrl, storageRoot, origin, port: 5191, testAuthEnabled: true, testAuthSecret: runtime.testAuthSecret }
  source = await sharp({ create: { width: 80, height: 48, channels: 3, background: '#658568' } }).jpeg().withExif({ IFD0: { Artist: 'synthetic private EXIF', ImageDescription: 'never publish metadata' } }).toBuffer()
  app = await createApp(config, instance => instance.use('/qa-test-only', (_req, res) => res.json({ synthetic: true })))
  await app.listen(config.port, '127.0.0.1')
  alice = await login('alice'); alice2 = await login('alice'); bob = await login('bob')
  capabilities = expect(await call(null, 'GET', '/api/v1/capabilities'), 200)
})
after(async () => { if (app) await app.close(); if (db) await db.end() })

test('explicit test mode, exact loopback origin, real PostgreSQL and controlled catalogue', async () => {
  assert.throws(() => validateConfig({ ...config, testAuthEnabled: false }))
  assert.throws(() => validateConfig({ ...config, origin: 'http://0.0.0.0:5191' }))
  assert.throws(() => validateConfig({ ...config, testAuthSecret: 'short' }))
  const server = (await db.query('SELECT version() AS version,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser')).rows[0]
  assert.match(server.version, /PostgreSQL 17\./); assert.equal(server.superuser, false)
  assert.deepEqual([capabilities.provinces, capabilities.regions, capabilities.publicPlaces], [34, 49, 43])
  assert.equal(capabilities.completeNationalCatalogue, false)
  const catalogue = new Catalogue(); await catalogue.load()
  assert.ok(catalogue.places.has('yulong')); assert.equal(catalogue.regions.get('lijiang'), 'yunnan')
  const polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[3, 3], [5, 3], [5, 5], [3, 5], [3, 3]]] }
  assert.equal(within([0, 5], polygon), true); assert.equal(within([3, 4], polygon), false)
})
test('security headers, missing auth, origin, host, CSRF, unknown fields and private paths', async () => {
  expect(await call(null, 'GET', '/api/v1/session'), 401)
  expect(await call(null, 'POST', '/api/v1/testing/login', { subject: 'alice', secret: 'wrong' }), 401)
  const wrongHost = await new Promise((resolve, reject) => {
    const request = http.get(origin + '/api/v1/session', { headers: { Host: 'attacker.example', Cookie: alice.cookie } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)) }); request.on('error', reject)
  })
  assert.equal(wrongHost, 403)
  expect(await call(alice, 'POST', '/api/v1/custom-places', {}, { Origin: 'https://attacker.example' }), 403)
  expect(await call(alice, 'POST', '/api/v1/custom-places', {}, { 'X-CSRF-Token': null }), 403)
  expect(await call(alice, 'POST', '/api/v1/custom-places', { userId: bob.id }), 400, 'INVALID_FIELD')
  const blocked = await call(null, 'GET', '/src/app.ts'); expect(blocked, 404)
  assert.equal(blocked.headers.get('x-frame-options'), 'DENY'); assert.equal(blocked.headers.get('x-content-type-options'), 'nosniff')
  assert.match(blocked.headers.get('cache-control'), /no-store/)
  expect(await call(alice, 'POST', '/api/v1/custom-places', { note: 'x'.repeat(65_536) }), 413)
  expect(await call(null, 'GET', '/qa-test-only'), 200)
  expect(await call(alice, 'GET', '/api/v1/visits/------------------------------------'), 404)
  assert.equal((await call(alice, 'GET', '/api/v1/session')).headers.get('x-shanhai-account'), alice.id)
  expect(await call(alice, 'GET', '/api/v1/visits', undefined, { 'X-Shanhai-Account': bob.id }), 409, 'ACCOUNT_CHANGED')
})
test('custom points derive provinces, preserve old Yunnan identities and reject foreign access', async () => {
  const body = { clientId: identity(), name: '成都合成茶馆', regionId: 'cn-51', coordinates: [104.0665, 30.5728], validationVersion: capabilities.validationVersion }
  expect(await call(alice, 'POST', '/api/v1/custom-places', { ...body, validationVersion: 'old' }), 422)
  expect(await call(alice, 'POST', '/api/v1/custom-places', { ...body, coordinates: [100.233, 26.872] }), 422)
  place = expect(await call(alice, 'POST', '/api/v1/custom-places', body), 201).customPlace
  assert.equal(place.regionId, 'cn-51'); assert.equal(place.provinceId, undefined)
  expect(await call(bob, 'GET', `/api/v1/custom-places/${place.id}`), 404)
  expect(await call(alice, 'POST', '/api/v1/custom-places', { ...body, clientId: identity(), regionId: 'lijiang', coordinates: [100.233, 26.872] }), 201)
})
test('immutable upload generation, owner checks, actual sharp decode and metadata receipt', async () => {
  savedPhoto = await prepare()
  expect(await call(bob, 'GET', `/api/v1/photos/uploads/${savedPhoto.uploadId}`), 404)
  expect(await call(bob, 'POST', `/api/v1/photos/uploads/${savedPhoto.uploadId}/complete`, {}), 404)
  expect(await call(alice, 'POST', '/api/v1/visits', visitBody(savedPhoto.photoId)), 422)
  expect(await upload(savedPhoto, source, { 'Content-Type': 'image/png' }), 415)
  expect(await upload(savedPhoto), 200)
  expect(await upload(savedPhoto), 409, 'UPLOAD_ALREADY_USED')
  const key = identity(), route = `/api/v1/photos/uploads/${savedPhoto.uploadId}/complete`
  const result = expect(await call(alice, 'POST', route, {}, {}, key), 200)
  assert.equal(result.photo.inputSha256, hash(source)); assert.match(result.photo.storedSha256, /^[a-f0-9]{64}$/)
  assert.equal(expect(await call(alice, 'POST', route, {}, {}, key), 200).receipt.replayed, true)
  expect(await call(alice, 'POST', `/api/v1/photos/${savedPhoto.photoId}/download-url`, {}), 404)
})
test('save and receipts are atomic, idempotent and account-scoped', async () => {
  const body = visitBody(savedPhoto.photoId), key = identity()
  const result = await call(alice, 'POST', '/api/v1/visits', body, {}, key)
  savedVisit = expect(result, 201).visit; assert.equal(result.headers.get('etag'), '"1"')
  const count = (await db.query('SELECT count(*) FROM sync_commits WHERE owner=$1', [alice.id])).rows[0].count
  const replay = expect(await call(alice2, 'POST', '/api/v1/visits', body, {}, key), 201)
  assert.equal(replay.visit.id, savedVisit.id); assert.equal(replay.receipt.replayed, true)
  assert.equal((await db.query('SELECT count(*) FROM sync_commits WHERE owner=$1', [alice.id])).rows[0].count, count)
  expect(await call(alice, 'POST', '/api/v1/visits', { ...body, note: 'different' }, {}, key), 409)
  expect(await call(bob, 'GET', `/api/v1/mutations/${key}`), 404)
  const receipt = expect(await call(alice, 'GET', `/api/v1/mutations/${key}`), 200)
  assert.doesNotMatch(JSON.stringify(receipt), /token=|data:image|object_key/)
  assert.deepEqual(expect(await call(alice2, 'GET', `/api/v1/visits/${savedVisit.id}`), 200).visit, savedVisit)
  expect(await call(bob, 'GET', `/api/v1/visits/${savedVisit.id}`), 404)
  expect(await call(bob, 'POST', '/api/v1/visits', visitBody(savedPhoto.photoId)), 404)
})
test('signed private read is decodable metadata-free JPEG; logout revokes only that session', async () => {
  expect(await call(bob, 'POST', `/api/v1/photos/${savedPhoto.photoId}/download-url`, {}), 404)
  const grant = expect(await call(alice2, 'POST', `/api/v1/photos/${savedPhoto.photoId}/download-url`, {}), 200)
  const response = await fetch(grant.url), bytes = Buffer.from(await response.arrayBuffer())
  assert.equal(response.status, 200); assert.equal(hash(bytes), grant.sha256)
  assert.ok((await sharp(source).metadata()).exif)
  const metadata = await sharp(bytes).metadata(); assert.equal(metadata.exif, undefined); assert.equal(metadata.orientation, undefined)
  assert.equal(metadata.format, 'jpeg'); await sharp(bytes).raw().toBuffer()
  expect(await call(alice2, 'POST', '/api/v1/auth/logout', {}), 204)
  assert.equal((await fetch(grant.url)).status, 403)
  expect(await call(alice2, 'GET', '/api/v1/session'), 401)
  expect(await call(alice, 'GET', `/api/v1/visits/${savedVisit.id}`), 200)
  alice2 = await login('alice')
})
test('map cover association plus concurrent CAS has exactly one winner', async () => {
  expect(await call(alice, 'PUT', '/api/v1/map-covers/public%3Ayulong', { visitId: savedVisit.id, photoId: savedPhoto.photoId }, { 'If-None-Match': '*' }), 422)
  const key = encodeURIComponent(`custom:${place.id}`)
  expect(await call(alice, 'PUT', `/api/v1/map-covers/${key}`, { visitId: savedVisit.id, photoId: savedPhoto.photoId }, { 'If-None-Match': '*' }), 200)
  expect(await call(alice, 'PATCH', `/api/v1/visits/${savedVisit.id}`, { note: 'missing CAS' }), 428)
  const results = await Promise.all([alice, alice2].map((who, i) => call(who, 'PATCH', `/api/v1/visits/${savedVisit.id}`, { note: `合成编辑 ${i}` }, { 'If-Match': '"1"' })))
  assert.deepEqual(results.map(result => result.status).sort(), [200, 412])
  savedVisit = results.find(result => result.status === 200).body.visit
  assert.equal(savedVisit.version, '2')
  expect(await call(alice, 'DELETE', `/api/v1/custom-places/${place.id}`, {}, { 'If-Match': '"1"' }), 409)
})
test('durable sessions, photos, records and signing survive closing and rebuilding the Nest app', async () => {
  await app.close(); app = await createApp(config); await app.listen(config.port, '127.0.0.1')
  expect(await call(alice, 'GET', '/api/v1/session'), 200)
  expect(await call(alice, 'GET', `/api/v1/visits/${savedVisit.id}`), 200)
  const grant = expect(await call(alice, 'POST', `/api/v1/photos/${savedPhoto.photoId}/download-url`, {}), 200)
  assert.equal((await fetch(grant.url)).status, 200)
  const hashes = (await db.query('SELECT token_hash,csrf_hash FROM sessions WHERE owner=$1', [alice.id])).rows
  assert.ok(hashes.every(row => /^[a-f0-9]{64}$/.test(row.token_hash)))
  assert.ok(!JSON.stringify(hashes).includes(alice.cookie.split('=')[1]))
})
test('commit cursors preserve history, never split atomic deletion, and deleted client IDs never resurrect', async () => {
  let initial = expect(await call(alice, 'GET', '/api/v1/sync/changes?limit=100'), 200)
  while (initial.hasMore) initial = expect(await call(alice, 'GET', '/api/v1/sync/changes?limit=100&cursor=' + encodeURIComponent(initial.nextCursor)), 200)
  const cursor = initial.nextCursor
  expect(await call(bob, 'GET', '/api/v1/sync/changes?cursor=' + encodeURIComponent(cursor)), 400)
  expect(await call(alice, 'GET', '/api/v1/sync/changes?cursor=' + encodeURIComponent(cursor + 'x')), 403)
  const key = identity(), route = `/api/v1/visits/${savedVisit.id}`
  const body = { ...savedVisit }; delete body.id; delete body.version
  expect(await call(alice, 'DELETE', route, {}, { 'If-Match': '"2"' }, key), 200)
  const deltaRoute = '/api/v1/sync/changes?limit=1&cursor=' + encodeURIComponent(cursor)
  const delta = expect(await call(alice2, 'GET', deltaRoute), 200)
  assert.equal(delta.commits.length, 1)
  assert.deepEqual(delta.commits[0].changes.map(change => change.entity).sort(), ['mapCover', 'photo', 'visit'])
  assert.ok(delta.commits[0].changes.every(change => change.operation === 'delete' && !change.value))
  assert.deepEqual(expect(await call(alice2, 'GET', deltaRoute), 200), delta)
  assert.equal(expect(await call(alice, 'DELETE', route, {}, { 'If-Match': '"2"' }, key), 200).receipt.replayed, true)
  expect(await call(alice, 'POST', '/api/v1/visits', body), 410)
  expect(await call(alice, 'GET', route), 410)
})
test('bad bytes, digest, MIME and cancelled upload cannot become ready', async () => {
  const forged = await prepare(alice, Buffer.from('not an image'))
  expect(await upload(forged, Buffer.from('not an image')), 200)
  expect(await call(alice, 'POST', `/api/v1/photos/uploads/${forged.uploadId}/complete`, {}), 422, 'IMAGE_DECODE_FAILED')
  const mismatch = await prepare(alice, source, 'image/jpeg', '0'.repeat(64))
  expect(await upload(mismatch), 422, 'UPLOAD_MISMATCH')
  const mime = await prepare(alice, source, 'image/png')
  expect(await upload(mime), 200)
  expect(await call(alice, 'POST', `/api/v1/photos/uploads/${mime.uploadId}/complete`, {}), 422)
  const cancel = await prepare()
  expect(await call(alice, 'DELETE', `/api/v1/photos/uploads/${cancel.uploadId}`, {}), 200)
  expect(await upload(cancel), 409)
  const expired = await prepare()
  await db.query("UPDATE uploads SET expires_at=now()-interval '1 second' WHERE id=$1", [expired.uploadId])
  assert.equal((await upload(expired)).status, 403)
})
test('cleanup failure after physical delete cannot roll back retirement or make missing bytes attachable', async () => {
  expect(await call(alice, 'POST', '/api/v1/cleanup/retry', {}), 200)
  const candidate = await ready()
  const task = (await db.query("UPDATE cleanup_tasks SET due_at=now() WHERE photo_id=$1 AND kind='photo' RETURNING id,object_key", [candidate.photo.id])).rows[0]
  await stat(path.join(config.storageRoot, task.object_key))
  const services = app.get('SERVICES'), pool = services.db.pool, originalConnect = pool.connect.bind(pool)
  let injected = false
  pool.connect = async (...args) => {
    if (typeof args[0] === 'function') return originalConnect(...args)
    const client = await originalConnect(...args), originalQuery = client.query.bind(client), originalRelease = client.release.bind(client)
    let deletingTarget = false
    client.query = (...queryArgs) => {
      const sql = queryArgs[0]
      if (typeof sql === 'string' && sql.includes("SET state='done'") && queryArgs[1]?.[0] === task.id) deletingTarget = true
      if (sql === 'COMMIT' && deletingTarget && !injected) { injected = true; return Promise.reject(new Error('synthetic failure before delete acknowledgement commit')) }
      return originalQuery(...queryArgs)
    }
    client.release = (...releaseArgs) => { client.query = originalQuery; client.release = originalRelease; return originalRelease(...releaseArgs) }
    return client
  }
  try {
    const result = expect(await call(alice, 'POST', '/api/v1/cleanup/retry', {}), 200)
    assert.equal(result.cleanup.failed, 1); assert.equal(injected, true)
  } finally { pool.connect = originalConnect }
  await assert.rejects(stat(path.join(config.storageRoot, task.object_key)), { code: 'ENOENT' })
  assert.equal((await db.query('SELECT state FROM photos WHERE id=$1', [candidate.photo.id])).rows[0].state, 'deleted')
  assert.equal((await db.query('SELECT state FROM cleanup_tasks WHERE id=$1', [task.id])).rows[0].state, 'pending')
  expect(await call(alice, 'POST', '/api/v1/visits', visitBody(candidate.photo.id)), 422)
  const retried = expect(await call(alice, 'POST', '/api/v1/cleanup/retry', {}), 200)
  assert.ok(retried.cleanup.done >= 1)
})
test('transient staging read failure keeps uploaded state and the same completion key can retry', async () => {
  const candidate = await prepare(); expect(await upload(candidate), 200)
  const photos = app.get('SERVICES').photos, storage = photos.storage, originalRead = storage.read.bind(storage), key = identity()
  storage.read = async () => { throw Object.assign(new Error('synthetic temporary I/O failure'), { code: 'EBUSY' }) }
  try { expect(await call(alice, 'POST', `/api/v1/photos/uploads/${candidate.uploadId}/complete`, {}, {}, key), 503, 'OBJECT_READ_UNAVAILABLE') }
  finally { storage.read = originalRead }
  assert.equal(expect(await call(alice, 'GET', `/api/v1/photos/uploads/${candidate.uploadId}`), 200).state, 'uploaded')
  assert.equal((await db.query('SELECT count(*) FROM mutation_receipts WHERE owner=$1 AND operation_id=$2', [alice.id, key])).rows[0].count, '0')
  const completed = expect(await call(alice, 'POST', `/api/v1/photos/uploads/${candidate.uploadId}/complete`, {}, {}, key), 200)
  assert.equal(completed.photo.state, 'ready'); assert.equal(completed.receipt.replayed, false)
})
test('cleanup never removes referenced photos and releases both cancelled-object reservations', async () => {
  const candidate = await ready()
  const visit = expect(await call(alice, 'POST', '/api/v1/visits', visitBody(candidate.photo.id)), 201).visit
  await db.query('UPDATE cleanup_tasks SET due_at=now() WHERE photo_id=$1', [candidate.photo.id])
  expect(await call(alice, 'POST', '/api/v1/cleanup/retry', {}), 200)
  const grant = expect(await call(alice, 'POST', `/api/v1/photos/${candidate.photo.id}/download-url`, {}), 200)
  assert.equal((await fetch(grant.url)).status, 200)
  expect(await call(alice, 'DELETE', `/api/v1/photos/uploads/${candidate.uploadId}`, {}), 409)
  expect(await call(alice, 'DELETE', `/api/v1/visits/${visit.id}`, {}, { 'If-Match': '"1"' }), 200)
  expect(await call(alice, 'POST', '/api/v1/cleanup/retry', {}), 200)
  assert.equal((await db.query("SELECT count(*) FROM cleanup_tasks WHERE photo_id=$1 AND state='pending'", [candidate.photo.id])).rows[0].count, '0')
})
test('actual expanded JPEG output is charged before write, and cancelled pending objects still consume quota', async () => {
  const pixels = Buffer.alloc(2400 * 2400 * 3)
  for (let y = 0; y < 2400; y++) for (let x = 0; x < 2400; x++) pixels.fill((x + y) % 2 ? 255 : 0, (y * 2400 + x) * 3, (y * 2400 + x) * 3 + 3)
  const png = await sharp(pixels, { raw: { width: 2400, height: 2400, channels: 3 } }).png().toBuffer()
  const candidate = await prepare(bob, png, 'image/png'); expect(await upload(candidate, png), 200)
  const reservations = []
  const currentBytes = Number((await db.query("SELECT coalesce(sum((p.data->>'expectedBytes')::bigint+coalesce((p.data->>'bytes')::bigint,0)),0) AS bytes FROM photos p WHERE p.owner=$1 AND (p.deleted_at IS NULL OR EXISTS(SELECT 1 FROM cleanup_tasks t WHERE t.photo_id=p.id AND t.state='pending'))", [bob.id])).rows[0].bytes)
  let remaining = 100 * 1024 * 1024 - currentBytes - 700_000
  assert.ok(remaining > 0, 'Synthetic quota fixture requires free space; cancel its prior unused test photos if exhausted')
  while (remaining > 0) {
    const bytes = Math.min(remaining, 10 * 1024 * 1024); remaining -= bytes
    const prepared = expect(await call(bob, 'POST', '/api/v1/photos/uploads', { clientPhotoId: identity(), name: 'reserved.jpg', contentType: 'image/jpeg', bytes, sha256: '0'.repeat(64) }), 201)
    reservations.push(prepared)
  }
  expect(await call(bob, 'POST', `/api/v1/photos/uploads/${candidate.uploadId}/complete`, {}), 413, 'PHOTO_QUOTA')
  const photo = (await db.query('SELECT object_key,state FROM photos WHERE id=$1', [candidate.photoId])).rows[0]
  assert.equal(photo.state, 'uploaded'); await assert.rejects(stat(path.join(config.storageRoot, photo.object_key)), { code: 'ENOENT' })
  for (const reserved of reservations) expect(await call(bob, 'DELETE', `/api/v1/photos/uploads/${reserved.uploadId}`, {}), 200)
  expect(await call(bob, 'POST', '/api/v1/photos/uploads', { clientPhotoId: identity(), name: 'still-reserved.jpg', contentType: 'image/jpeg', bytes: 2 * 1024 * 1024, sha256: '0'.repeat(64) }), 413)
  expect(await call(bob, 'POST', '/api/v1/cleanup/retry', {}), 200)
  expect(await call(bob, 'POST', `/api/v1/photos/uploads/${candidate.uploadId}/complete`, {}), 200)
})
