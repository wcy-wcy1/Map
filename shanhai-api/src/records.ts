import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import { Database, type Actor, type Change, type Client, type Result } from './db.js'
import { Catalogue, CATALOGUE_VERSION } from './catalogue.js'
import { canonical, hash, Signer } from './crypto.js'
import { fail, fields, string, version } from './errors.js'
export const resource = (row: any) => ({ ...row.data, id: row.id, version: String(row.version) })
export async function owned(client: Client | Database['pool'], table: 'visits' | 'photos' | 'custom_places' | 'uploads', owner: string, id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) fail(404, 'NOT_FOUND', 'Not found')
  const row = (await client.query(`SELECT * FROM ${table} WHERE owner=$1 AND id=$2`, [owner, id])).rows[0]
  if (!row) fail(404, 'NOT_FOUND', 'Not found')
  return row
}
const current = (row: any) => { if (row.deleted_at) fail(410, 'RESOURCE_DELETED', 'This resource has been deleted'); return row }
const match = (row: any, expected: string) => { if (String(row.version) !== expected) fail(412, 'VERSION_CONFLICT', 'This resource has changed', { currentVersion: String(row.version) }) }
export const mutationFingerprint = (req: Request) => ({ method: req.method, path: req.path, body: req.body || {}, ifMatch: req.get('If-Match') || null, ifNoneMatch: req.get('If-None-Match') || null })
const upsert = (entity: string, value: any): Change => ({ entity, id: value.id, version: value.version, operation: 'upsert', value })
export class Records {
  constructor(private db: Database, private catalogue: Catalogue, private signer: Signer) {}
  mutate(actor: Actor, req: Request, work: (client: Client, changes: Change[]) => Promise<Result>) { return this.db.mutate(actor, req.get('Idempotency-Key'), mutationFingerprint(req), work) }
  async customCreate(actor: Actor, req: Request) {
    const value = this.catalogue.custom(req.body)
    return this.mutate(actor, req, async (client, changes) => {
      const old = (await client.query('SELECT * FROM custom_places WHERE owner=$1 AND client_id=$2', [actor.owner, value.clientId])).rows[0]
      if (old) { current(old); if (old.input_hash !== hash(canonical(value))) fail(409, 'CLIENT_ID_CONFLICT', 'The client identity is already assigned'); return { status: 200, body: { customPlace: resource(old) } } }
      const row = (await client.query('INSERT INTO custom_places(id,owner,client_id,input_hash,data) VALUES($1,$2,$3,$4,$5) RETURNING *', [randomUUID(), actor.owner, value.clientId, hash(canonical(value)), JSON.stringify(value)])).rows[0]
      const customPlace = resource(row); changes.push(upsert('customPlace', customPlace)); return { status: 201, body: { customPlace } }
    })
  }
  async get(actor: Actor, table: 'visits' | 'custom_places', id: string) { return resource(current(await owned(this.db.pool, table, actor.owner, id))) }
  private async visitValue(client: Client, actor: Actor, input: unknown, visitId: string) {
    const value = fields(input, ['clientId', 'clientCreatedAt', 'place', 'date', 'note', 'photos', 'coverPhotoId'])
    const clientId = string(value.clientId, 'clientId'), place = fields(value.place, ['kind', 'id', 'catalogueVersion'])
    const placeId = string(place.id, 'place.id')
    if (place.kind === 'public') {
      if (!this.catalogue.places.has(placeId)) fail(422, 'VALIDATION_FAILED', 'Unknown public place identity')
      if (place.catalogueVersion !== CATALOGUE_VERSION) fail(422, 'CATALOGUE_VERSION_UNSUPPORTED', 'Use the published catalogue version')
    } else if (place.kind === 'custom') { fields(place, ['kind', 'id']); current(await owned(client, 'custom_places', actor.owner, placeId)) }
    else fail(422, 'VALIDATION_FAILED', 'Invalid place kind')
    if (!Number.isSafeInteger(value.clientCreatedAt) || Number(value.clientCreatedAt) < 0) fail(422, 'VALIDATION_FAILED', 'Invalid clientCreatedAt')
    const date = string(value.date, 'date', 10)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date > today) fail(422, 'VALIDATION_FAILED', 'Invalid travel date')
    if (typeof value.note !== 'string' || value.note.length > 2000 || value.note.includes('\0')) fail(422, 'VALIDATION_FAILED', 'Invalid note')
    if (!Array.isArray(value.photos) || value.photos.length > 9) fail(422, 'VALIDATION_FAILED', 'At most nine photos are allowed')
    const photoIds = new Set<string>(), photos = []
    for (const [position, inputPhoto] of value.photos.entries()) {
      const photo = fields(inputPhoto, ['id', 'position']), id = string(photo.id, 'photo id')
      if (photo.position !== position || photoIds.has(id)) fail(422, 'VALIDATION_FAILED', 'Photo order must be contiguous and unique')
      const stored = await owned(client, 'photos', actor.owner, id)
      if (stored.state !== 'ready' || (stored.visit_id && stored.visit_id !== visitId)) fail(422, 'PHOTO_NOT_READY', 'Photo is unavailable or belongs to another memory')
      photoIds.add(id); photos.push({ id, position })
    }
    if (!value.note.trim() && !photos.length) fail(422, 'VALIDATION_FAILED', 'A note or a photo is required')
    if ((photos.length && !photoIds.has(String(value.coverPhotoId))) || (!photos.length && value.coverPhotoId !== null)) fail(422, 'VALIDATION_FAILED', 'The memory cover must belong to its photos')
    return { clientId, clientCreatedAt: value.clientCreatedAt, place, date, note: value.note.trim(), photos, coverPhotoId: value.coverPhotoId }
  }
  private async retirePhotos(client: Client, actor: Actor, ids: string[], changes: Change[]) {
    for (const id of ids) {
      const row = (await client.query("UPDATE photos SET state='deleted',deleted_at=now(),version=version+1,visit_id=NULL WHERE owner=$1 AND id=$2 AND deleted_at IS NULL RETURNING *", [actor.owner, id])).rows[0]
      if (!row) continue
      await client.query("UPDATE cleanup_tasks SET due_at=now(),state='pending' WHERE owner=$1 AND photo_id=$2", [actor.owner, id])
      changes.push({ entity: 'photo', id, version: String(row.version), operation: 'delete', deletedAt: row.deleted_at.toISOString() })
    }
  }
  private async clearCovers(client: Client, actor: Actor, visitId: string, placeKey: string | null, allowedIds: string[], changes: Change[]) {
    const rows = (await client.query('SELECT * FROM map_covers WHERE owner=$1 AND visit_id=$2 AND deleted_at IS NULL', [actor.owner, visitId])).rows
    for (const row of rows) if (row.place_key !== placeKey || !allowedIds.includes(row.photo_id)) {
      const deleted = (await client.query('UPDATE map_covers SET deleted_at=now(),version=version+1 WHERE owner=$1 AND place_key=$2 RETURNING *', [actor.owner, row.place_key])).rows[0]
      changes.push({ entity: 'mapCover', id: row.place_key, version: String(deleted.version), operation: 'delete', deletedAt: deleted.deleted_at.toISOString() })
    }
  }
  async visitCreate(actor: Actor, req: Request) {
    return this.mutate(actor, req, async (client, changes) => {
      const input = fields(req.body, ['clientId', 'clientCreatedAt', 'place', 'date', 'note', 'photos', 'coverPhotoId']), clientId = string(input.clientId, 'clientId')
      const prior = (await client.query('SELECT * FROM visits WHERE owner=$1 AND client_id=$2', [actor.owner, clientId])).rows[0]
      if (prior) { current(prior); if (prior.input_hash !== hash(canonical(input))) fail(409, 'CLIENT_ID_CONFLICT', 'The client identity is already assigned'); return { status: 200, body: { visit: resource(prior) } } }
      const id = randomUUID(), value = await this.visitValue(client, actor, input, id), placeKey = `${value.place.kind}:${value.place.id}`
      const row = (await client.query('INSERT INTO visits(id,owner,client_id,input_hash,place_key,custom_place_id,data) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [id, actor.owner, clientId, hash(canonical(input)), placeKey, value.place.kind === 'custom' ? value.place.id : null, JSON.stringify(value)])).rows[0]
      for (const photo of value.photos) await client.query('UPDATE photos SET visit_id=$1 WHERE owner=$2 AND id=$3', [id, actor.owner, photo.id])
      const visit = resource(row); changes.push(upsert('visit', visit)); return { status: 201, body: { visit } }
    })
  }
  async visitPatch(actor: Actor, req: Request, id: string) {
    const patch = fields(req.body, ['place', 'date', 'note', 'photos', 'coverPhotoId']), expected = version(req.get('If-Match'))
    return this.mutate(actor, req, async (client, changes) => {
      const prior = current(await owned(client, 'visits', actor.owner, id)); match(prior, expected)
      const value = await this.visitValue(client, actor, { ...prior.data, ...patch }, id), placeKey = `${value.place.kind}:${value.place.id}`
      const photoIds = value.photos.map(photo => photo.id)
      await this.clearCovers(client, actor, id, placeKey, photoIds, changes)
      await this.retirePhotos(client, actor, prior.data.photos.map((photo: any) => photo.id).filter((photoId: string) => !photoIds.includes(photoId)), changes)
      for (const photo of value.photos) await client.query('UPDATE photos SET visit_id=$1 WHERE owner=$2 AND id=$3', [id, actor.owner, photo.id])
      const row = (await client.query('UPDATE visits SET data=$3,place_key=$4,custom_place_id=$5,version=version+1 WHERE owner=$1 AND id=$2 RETURNING *',
        [actor.owner, id, JSON.stringify(value), placeKey, value.place.kind === 'custom' ? value.place.id : null])).rows[0]
      const visit = resource(row); changes.push(upsert('visit', visit)); return { status: 200, body: { visit } }
    })
  }
  async remove(actor: Actor, req: Request, table: 'visits' | 'custom_places', id: string) {
    fields(req.body || {}, []); const expected = version(req.get('If-Match'))
    return this.mutate(actor, req, async (client, changes) => {
      const prior = current(await owned(client, table, actor.owner, id)); match(prior, expected)
      if (table === 'custom_places' && (await client.query('SELECT 1 FROM visits WHERE owner=$1 AND custom_place_id=$2 AND deleted_at IS NULL', [actor.owner, id])).rowCount) fail(409, 'PLACE_IN_USE', 'This place is still referenced')
      if (table === 'visits') {
        await this.clearCovers(client, actor, id, null, [], changes)
        await this.retirePhotos(client, actor, prior.data.photos.map((photo: any) => photo.id), changes)
      }
      const row = (await client.query(`UPDATE ${table} SET deleted_at=now(),version=version+1 WHERE owner=$1 AND id=$2 RETURNING *`, [actor.owner, id])).rows[0]
      const deleted = { id, version: String(row.version), deletedAt: row.deleted_at.toISOString() }
      changes.push({ entity: table === 'visits' ? 'visit' : 'customPlace', ...deleted, operation: 'delete' })
      return { status: 200, body: { deleted } }
    })
  }
  async cover(actor: Actor, req: Request, placeKey: string) {
    string(placeKey, 'placeKey', 160)
    const deleting = req.method === 'DELETE', value = fields(req.body || {}, deleting ? [] : ['visitId', 'photoId'])
    return this.mutate(actor, req, async (client, changes) => {
      const old = (await client.query('SELECT * FROM map_covers WHERE owner=$1 AND place_key=$2', [actor.owner, placeKey])).rows[0]
      if (old && !old.deleted_at) match(old, version(req.get('If-Match')))
      else if (deleting) fail(404, 'NOT_FOUND', 'Not found')
      else if (req.get('If-None-Match') !== '*') fail(428, 'VERSION_REQUIRED', 'If-None-Match: * is required to create a map cover')
      if (deleting) {
        const row = (await client.query('UPDATE map_covers SET deleted_at=now(),version=version+1 WHERE owner=$1 AND place_key=$2 RETURNING *', [actor.owner, placeKey])).rows[0]
        const deleted = { id: placeKey, version: String(row.version), deletedAt: row.deleted_at.toISOString() }
        changes.push({ entity: 'mapCover', ...deleted, operation: 'delete' }); return { status: 200, body: { deleted } }
      }
      const visit = current(await owned(client, 'visits', actor.owner, string(value.visitId, 'visitId')))
      const photo = await owned(client, 'photos', actor.owner, string(value.photoId, 'photoId'))
      if (visit.place_key !== placeKey || photo.state !== 'ready' || photo.visit_id !== visit.id || !visit.data.photos.some((item: any) => item.id === photo.id)) fail(422, 'INVALID_COVER', 'The cover must be a photo of this place and memory')
      const row = (await client.query('INSERT INTO map_covers(owner,place_key,visit_id,photo_id) VALUES($1,$2,$3,$4) ON CONFLICT(owner,place_key) DO UPDATE SET visit_id=$3,photo_id=$4,deleted_at=NULL,version=map_covers.version+1 RETURNING *', [actor.owner, placeKey, visit.id, photo.id])).rows[0]
      const mapCover = { id: placeKey, placeKey, visitId: row.visit_id, photoId: row.photo_id, version: String(row.version) }
      changes.push(upsert('mapCover', mapCover)); return { status: 200, body: { mapCover } }
    })
  }
  async list(actor: Actor, cursor: unknown, limitInput: unknown) {
    const limit = limitInput === undefined ? 50 : Number(limitInput)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_LIMIT', 'Invalid page limit')
    return this.db.tx(async client => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const account = (await client.query('SELECT sequence,sync_epoch FROM accounts WHERE id=$1', [actor.owner])).rows[0]
      let after: string | null = null
      if (cursor) {
        const value = this.signer.verify(cursor, 'visit-list')
        if (value.owner !== actor.owner || value.epoch !== account.sync_epoch) fail(400, 'INVALID_CURSOR', 'This cursor does not belong to this account')
        if (value.sequence !== account.sequence) fail(409, 'STALE_LIST', 'The library changed; restart this listing')
        after = value.after
      }
      const rows = (await client.query('SELECT * FROM visits WHERE owner=$1 AND deleted_at IS NULL AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3', [actor.owner, after, limit + 1])).rows
      const more = rows.length > limit, items = rows.slice(0, limit).map(resource)
      return { items, snapshotVersion: account.sequence, nextCursor: more ? this.signer.sign({ purpose: 'visit-list', owner: actor.owner, epoch: account.sync_epoch, sequence: account.sequence, after: items.at(-1).id }) : null }
    })
  }
  async sync(actor: Actor, cursor: unknown, limitInput: unknown) {
    const limit = limitInput === undefined ? 100 : Number(limitInput)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_LIMIT', 'Invalid commit limit')
    const account = (await this.db.pool.query('SELECT sync_epoch FROM accounts WHERE id=$1', [actor.owner])).rows[0]
    let after = '0'
    if (cursor) {
      const value = this.signer.verify(cursor, 'sync')
      if (value.owner !== actor.owner || value.epoch !== account.sync_epoch || !/^\d+$/.test(value.after)) fail(400, 'INVALID_CURSOR', 'This cursor does not belong to this account')
      after = value.after
    }
    const rows = (await this.db.pool.query('SELECT * FROM sync_commits WHERE owner=$1 AND sequence>$2 ORDER BY sequence LIMIT $3', [actor.owner, after, limit + 1])).rows
    const page = rows.slice(0, limit)
    return { commits: page.map(row => ({ id: row.id, sequence: row.sequence, changes: row.changes })), hasMore: rows.length > limit,
      nextCursor: this.signer.sign({ purpose: 'sync', owner: actor.owner, epoch: account.sync_epoch, after: page.at(-1)?.sequence || after }) }
  }
}
