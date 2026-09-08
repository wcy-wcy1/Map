import { randomUUID } from 'node:crypto'
import type { Request } from 'express'
import sharp, { type OutputInfo } from 'sharp'
import { Database, type Actor, type Change, type Client } from './db.js'
import { canonical, hash, randomToken, Signer } from './crypto.js'
import { fail, fields, string } from './errors.js'
import { mutationFingerprint, owned } from './records.js'
import { PrivateStorage } from './storage.js'

export const PHOTO_LIMIT = 10 * 1024 * 1024
const UPLOAD_TTL = 5 * 60_000
let activeTransfers = 0
let activeTransforms = 0
sharp.concurrency(1)
sharp.cache(false)

export class Photos {
  constructor(private db: Database, private storage: PrivateStorage, private signer: Signer, private origin: string) {}
  private uploadToken(upload: any) {
    return this.signer.sign({ purpose: 'upload', owner: upload.owner, id: upload.id, sessionId: upload.session_id, generation: upload.generation, expires: upload.expires_at.getTime() })
  }
  private async session(client: Client, owner: string, sessionId: string) {
    if (!(await client.query("SELECT 1 FROM sessions s JOIN accounts a ON a.id=s.owner WHERE s.id=$1 AND s.owner=$2 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active'", [sessionId, owner])).rowCount) fail(403, 'CAPABILITY_REVOKED', 'This capability is no longer valid')
  }
  private async quota(client: Client, owner: string) {
    // Reservations include input plus actual output and remain charged until retired
    // objects have completed cleanup. Cancellation cannot bypass the disk budget.
    return (await client.query("SELECT count(*) AS count,coalesce(sum((p.data->>'expectedBytes')::bigint+coalesce((p.data->>'bytes')::bigint,0)),0) AS bytes FROM photos p WHERE p.owner=$1 AND (p.deleted_at IS NULL OR EXISTS(SELECT 1 FROM cleanup_tasks t WHERE t.photo_id=p.id AND t.state='pending'))", [owner])).rows[0]
  }
  async prepare(actor: Actor, req: Request) {
    const input = fields(req.body, ['clientPhotoId', 'name', 'contentType', 'bytes', 'sha256'])
    const value = { clientPhotoId: string(input.clientPhotoId, 'clientPhotoId'), name: string(input.name, 'name', 150), contentType: string(input.contentType, 'contentType'), bytes: input.bytes, sha256: input.sha256 }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(value.contentType) || typeof value.bytes !== 'number' || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > PHOTO_LIMIT || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) fail(422, 'INVALID_PHOTO', 'Use JPEG, PNG or WebP up to 10 MiB with its SHA-256')
    const expectedBytes = value.bytes
    const result = await this.db.mutate(actor, req.get('Idempotency-Key'), mutationFingerprint(req), async client => {
      const old = (await client.query('SELECT * FROM photos WHERE owner=$1 AND client_id=$2', [actor.owner, value.clientPhotoId])).rows[0]
      if (old) {
        if (old.deleted_at || old.state === 'rejected') fail(410, 'PHOTO_RETIRED', 'This client photo identity cannot be reused')
        if (old.input_hash !== hash(canonical(value))) fail(409, 'CLIENT_ID_CONFLICT', 'The client photo identity is already assigned')
        const upload = (await client.query('SELECT id FROM uploads WHERE owner=$1 AND photo_id=$2', [actor.owner, old.id])).rows[0]
        return { status: 200, body: { uploadId: upload.id, photoId: old.id } }
      }
      const quota = await this.quota(client, actor.owner)
      if (Number(quota.count) >= 500 || Number(quota.bytes) + expectedBytes > 100 * 1024 * 1024) fail(413, 'PHOTO_QUOTA', 'The local test account photo quota is exhausted')
      const photoId = randomUUID(), uploadId = randomUUID(), generation = randomUUID(), expiresAt = new Date(Date.now() + UPLOAD_TTL)
      const upload = { id: uploadId, owner: actor.owner, session_id: actor.sessionId, generation, expires_at: expiresAt }
      const data = { name: value.name, contentType: value.contentType, expectedBytes: value.bytes, inputSha256: value.sha256 }
      await client.query("INSERT INTO photos(id,owner,client_id,input_hash,data,state,object_key) VALUES($1,$2,$3,$4,$5,'prepared',$6)", [photoId, actor.owner, value.clientPhotoId, hash(canonical(value)), JSON.stringify(data), `photo-${photoId}`])
      await client.query("INSERT INTO uploads(id,owner,photo_id,session_id,generation,token_hash,incoming_key,expires_at,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'prepared')", [uploadId, actor.owner, photoId, actor.sessionId, generation, hash(this.uploadToken(upload)), `incoming-${generation}`, expiresAt])
      // Cleanup intents commit before the first filesystem write, including crash-orphan output.
      await client.query("INSERT INTO cleanup_tasks(id,owner,photo_id,object_key,kind,due_at) VALUES($1,$2,$3,$4,'incoming',$5),($6,$2,$3,$7,'photo',$8)", [randomUUID(), actor.owner, photoId, `incoming-${generation}`, expiresAt, randomUUID(), `photo-${photoId}`, new Date(Date.now() + 24 * 60 * 60_000)])
      return { status: 201, body: { uploadId, photoId } }
    })
    const upload = await owned(this.db.pool, 'uploads', actor.owner, result.body.uploadId)
    const photo = await owned(this.db.pool, 'photos', actor.owner, upload.photo_id)
    // Receipts contain identities only, never bearer capabilities. Replays cannot renew expiry.
    return { ...result, body: { ...result.body, state: upload.state, upload: { method: 'PUT', url: `${this.origin}/api/v1/uploads/${upload.id}/content?token=${this.uploadToken(upload)}`, headers: { 'Content-Type': photo.data.contentType }, expiresAt: upload.expires_at.toISOString(), maxBytes: PHOTO_LIMIT } } }
  }
  async upload(req: Request, id: string) {
    const token = req.query.token, claims = this.signer.verify(token, 'upload')
    if (claims.id !== id) fail(403, 'INVALID_TOKEN', 'Invalid upload capability')
    if (activeTransfers >= 2) fail(429, 'BUSY', 'Two uploads are already in progress')
    activeTransfers++
    try {
      return await this.db.tx(async client => {
        const actor = { owner: claims.owner, sessionId: claims.sessionId, token: '' }
        await this.db.lock(client, actor)
        const upload = await owned(client, 'uploads', actor.owner, id)
        if (upload.token_hash !== hash(String(token)) || upload.generation !== claims.generation || upload.expires_at.getTime() <= Date.now()) fail(403, 'INVALID_TOKEN', 'Invalid upload capability')
        if (upload.state !== 'prepared') fail(409, 'UPLOAD_ALREADY_USED', 'Each immutable upload generation accepts bytes once')
        const photo = await owned(client, 'photos', actor.owner, upload.photo_id)
        if (req.get('Content-Type') !== photo.data.contentType) fail(415, 'CONTENT_TYPE_MISMATCH', 'Use the prepared content type')
        const announced = req.get('Content-Length')
        if (announced && (!/^\d+$/.test(announced) || Number(announced) > PHOTO_LIMIT)) fail(413, 'PHOTO_TOO_LARGE', 'The upload exceeds 10 MiB')
        const chunks: Buffer[] = []; let length = 0
        req.setTimeout(15_000, () => req.destroy())
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          length += bytes.length
          if (length > PHOTO_LIMIT) fail(413, 'PHOTO_TOO_LARGE', 'The upload exceeds 10 MiB')
          chunks.push(bytes)
        }
        const bytes = Buffer.concat(chunks)
        if (length !== photo.data.expectedBytes || hash(bytes) !== photo.data.inputSha256) fail(422, 'UPLOAD_MISMATCH', 'Actual bytes do not match the prepared length and SHA-256')
        await this.storage.putOnce(upload.incoming_key, bytes)
        await client.query("UPDATE uploads SET state='uploaded' WHERE id=$1", [id])
        await client.query("UPDATE photos SET state='uploaded' WHERE id=$1", [photo.id])
        return { uploadId: id, photoId: photo.id, state: 'uploaded' }
      })
    } finally { activeTransfers-- }
  }
  async status(actor: Actor, id: string) {
    const upload = await owned(this.db.pool, 'uploads', actor.owner, id)
    const photo = await owned(this.db.pool, 'photos', actor.owner, upload.photo_id)
    return { uploadId: id, photoId: photo.id, state: upload.state, expiresAt: upload.expires_at.toISOString(), ...(photo.state === 'ready' ? { photo: this.publicPhoto(photo) } : {}) }
  }
  private publicPhoto(photo: any) {
    const { name, mime, bytes, width, height, sha256, inputSha256 } = photo.data
    return { id: photo.id, version: String(photo.version), state: photo.state, name, mime, bytes, width, height, sha256, inputSha256, storedSha256: sha256 }
  }
  async complete(actor: Actor, req: Request, id: string) {
    fields(req.body || {}, [])
    return this.db.mutate(actor, req.get('Idempotency-Key'), mutationFingerprint(req), async (client, changes) => {
      const upload = await owned(client, 'uploads', actor.owner, id), photo = await owned(client, 'photos', actor.owner, upload.photo_id)
      if (upload.state === 'ready' && photo.state === 'ready') return { status: 200, body: { photo: this.publicPhoto(photo) } }
      if (upload.state !== 'uploaded') fail(409, 'UPLOAD_NOT_READY', 'Complete a successfully uploaded generation')
      if (activeTransforms >= 2) fail(429, 'BUSY', 'Two photos are already being processed')
      activeTransforms++
      let result: { data: Buffer; info: OutputInfo }
      let bytes: Buffer
      try { bytes = await this.storage.read(upload.incoming_key) }
      catch { activeTransforms--; fail(503, 'OBJECT_READ_UNAVAILABLE', 'Staged bytes could not be read; retry this completion later') }
      try {
        if (hash(bytes) !== photo.data.inputSha256 || bytes.length !== photo.data.expectedBytes) throw new Error('Corrupt staging object')
        const metadata = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).metadata()
        if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) !== 1 || `image/${metadata.format === 'jpeg' ? 'jpeg' : metadata.format}` !== photo.data.contentType) throw new Error('Unsupported image')
        result = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'warning' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 86 }).timeout({ seconds: 5 }).toBuffer({ resolveWithObject: true })
      } catch {
        await client.query("UPDATE uploads SET state='rejected' WHERE id=$1", [id])
        await client.query("UPDATE photos SET state='rejected',deleted_at=now(),version=version+1 WHERE id=$1", [photo.id])
        await client.query("UPDATE cleanup_tasks SET due_at=now() WHERE photo_id=$1 AND state='pending'", [photo.id])
        return { status: 422, body: { error: { code: 'IMAGE_DECODE_FAILED', message: 'The image could not be safely decoded and re-encoded' } } }
      } finally { activeTransforms-- }
      if (result.data.length > PHOTO_LIMIT || Number((await this.quota(client, actor.owner)).bytes) + result.data.length > 100 * 1024 * 1024) return { status: 413, body: { error: { code: 'PHOTO_QUOTA', message: 'Re-encoded output exceeds the private object budget; free unused photos and retry with a new operation key' } } }
      await this.storage.putOnce(photo.object_key, result.data)
      const data = { ...photo.data, mime: 'image/jpeg', bytes: result.data.length, width: result.info.width, height: result.info.height, sha256: hash(result.data) }
      const row = (await client.query("UPDATE photos SET state='ready',data=$2,version=version+1 WHERE id=$1 RETURNING *", [photo.id, JSON.stringify(data)])).rows[0]
      await client.query("UPDATE uploads SET state='ready' WHERE id=$1", [id])
      await client.query("UPDATE cleanup_tasks SET due_at=now() WHERE photo_id=$1 AND kind='incoming' AND state='pending'", [photo.id])
      const published = this.publicPhoto(row)
      changes.push({ entity: 'photo', id: photo.id, version: published.version, operation: 'upsert', value: published })
      return { status: 200, body: { photo: published } }
    })
  }
  async cancel(actor: Actor, req: Request, id: string) {
    fields(req.body || {}, [])
    return this.db.mutate(actor, req.get('Idempotency-Key'), mutationFingerprint(req), async (client, changes) => {
      const upload = await owned(client, 'uploads', actor.owner, id), photo = await owned(client, 'photos', actor.owner, upload.photo_id)
      if (photo.visit_id) fail(409, 'PHOTO_IN_USE', 'A referenced photo cannot be cancelled')
      if (!photo.deleted_at) {
        const row = (await client.query("UPDATE photos SET state='deleted',deleted_at=now(),version=version+1 WHERE id=$1 RETURNING *", [photo.id])).rows[0]
        changes.push({ entity: 'photo', id: photo.id, version: String(row.version), operation: 'delete', deletedAt: row.deleted_at.toISOString() })
      }
      await client.query("UPDATE uploads SET state='cancelled' WHERE id=$1", [id])
      await client.query("UPDATE cleanup_tasks SET state='pending',due_at=now() WHERE photo_id=$1", [photo.id])
      return { status: 200, body: { uploadId: id, photoId: photo.id, state: 'cancelled' } }
    })
  }
  async downloadUrl(actor: Actor, req: Request, id: string) {
    fields(req.body || {}, [])
    return this.db.tx(async client => {
      await this.db.lock(client, actor)
      const photo = await owned(client, 'photos', actor.owner, id)
      if (photo.state !== 'ready' || !photo.visit_id || !(await client.query('SELECT 1 FROM visits WHERE owner=$1 AND id=$2 AND deleted_at IS NULL', [actor.owner, photo.visit_id])).rowCount) fail(404, 'NOT_FOUND', 'Not found')
      const expiresAt = new Date(Date.now() + 60_000)
      const token = this.signer.sign({ purpose: 'download', owner: actor.owner, id, sessionId: actor.sessionId, nonce: randomToken(), expires: expiresAt.getTime() })
      await client.query('INSERT INTO download_grants(token_hash,owner,photo_id,session_id,expires_at) VALUES($1,$2,$3,$4,$5)', [hash(token), actor.owner, id, actor.sessionId, expiresAt])
      return { url: `${this.origin}/api/v1/photos/${id}/content?token=${token}`, expiresAt: expiresAt.toISOString(), mime: photo.data.mime, bytes: photo.data.bytes, sha256: photo.data.sha256 }
    })
  }
  async download(req: Request, id: string) {
    const token = req.query.token, claims = this.signer.verify(token, 'download')
    if (claims.id !== id) fail(403, 'INVALID_TOKEN', 'Invalid download capability')
    return this.db.tx(async client => {
      // Account lock gives logout/delete and the authorization decision a total order.
      await client.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [claims.owner])
      await this.session(client, claims.owner, claims.sessionId)
      if (!(await client.query('SELECT 1 FROM download_grants WHERE token_hash=$1 AND owner=$2 AND photo_id=$3 AND session_id=$4 AND expires_at>now()', [hash(String(token)), claims.owner, id, claims.sessionId])).rowCount) fail(403, 'INVALID_TOKEN', 'Invalid download capability')
      const photo = await owned(client, 'photos', claims.owner, id)
      if (photo.state !== 'ready' || !photo.visit_id || !(await client.query('SELECT 1 FROM visits WHERE owner=$1 AND id=$2 AND deleted_at IS NULL', [claims.owner, photo.visit_id])).rowCount) fail(404, 'NOT_FOUND', 'Not found')
      const bytes = await this.storage.read(photo.object_key)
      if (hash(bytes) !== photo.data.sha256) fail(500, 'OBJECT_INTEGRITY_FAILED', 'Stored photo integrity check failed')
      return { bytes, mime: photo.data.mime }
    })
  }
  async cleanupList(actor: Actor) {
    return { tasks: (await this.db.pool.query('SELECT id,photo_id AS "photoId",kind,state,due_at AS "dueAt",attempts,last_error AS "lastError" FROM cleanup_tasks WHERE owner=$1 ORDER BY due_at LIMIT 100', [actor.owner])).rows }
  }
  private async expirePhoto(client: Client, photo: any, changes: Change[]) {
    if (photo.deleted_at) return
    const row = (await client.query("UPDATE photos SET state='deleted',deleted_at=now(),version=version+1 WHERE id=$1 RETURNING *", [photo.id])).rows[0]
    await client.query("UPDATE uploads SET state='expired' WHERE photo_id=$1 AND state IN ('prepared','uploaded','ready')", [photo.id])
    changes.push({ entity: 'photo', id: photo.id, version: String(row.version), operation: 'delete', deletedAt: row.deleted_at.toISOString() })
  }
  async cleanup(actor: Actor, req: Request) {
    fields(req.body || {}, [])
    const planned = await this.db.mutate(actor, req.get('Idempotency-Key'), mutationFingerprint(req), async (client, changes) => {
      const tasks = (await client.query("SELECT * FROM cleanup_tasks WHERE owner=$1 AND state='pending' AND due_at<=now() ORDER BY due_at LIMIT 100", [actor.owner])).rows
      let deferred = 0
      const eligible: string[] = []
      for (const task of tasks) {
        const photo = await owned(client, 'photos', actor.owner, task.photo_id)
        const upload = (await client.query('SELECT * FROM uploads WHERE photo_id=$1', [photo.id])).rows[0]
        if (task.kind === 'photo' && photo.visit_id) {
          await client.query("UPDATE cleanup_tasks SET due_at=now()+interval '24 hours' WHERE id=$1", [task.id]); deferred++; continue
        }
        if (task.kind === 'incoming' && upload.state === 'uploaded' && !photo.deleted_at) {
          // A successfully uploaded image gets a full day to complete, not only the PUT TTL.
          const finalTask = (await client.query("SELECT due_at FROM cleanup_tasks WHERE photo_id=$1 AND kind='photo'", [photo.id])).rows[0]
          if (finalTask.due_at.getTime() > Date.now()) { await client.query('UPDATE cleanup_tasks SET due_at=$2 WHERE id=$1', [task.id, finalTask.due_at]); deferred++; continue }
        }
        if (task.kind === 'photo' || ['prepared', 'uploaded'].includes(upload.state)) await this.expirePhoto(client, photo, changes)
        eligible.push(task.id)
      }
      return { status: 200, body: { cleanup: { examined: tasks.length, deferred, taskIds: eligible } } }
    })
    // Phase 1 above MUST commit retirement/tombstones before any irreversible delete.
    // A failed phase-2 acknowledgement leaves a retired object plus a retryable task,
    // never a ready database row pointing at a physically removed object.
    let done = 0, failed = 0
    for (const taskId of planned.body.cleanup.taskIds) {
      try {
        const removed = await this.db.tx(async client => {
          await this.db.lock(client, actor)
          const task = (await client.query('SELECT * FROM cleanup_tasks WHERE owner=$1 AND id=$2', [actor.owner, taskId])).rows[0]
          if (!task || task.state === 'done') return false
          const photo = await owned(client, 'photos', actor.owner, task.photo_id)
          const upload = (await client.query('SELECT state FROM uploads WHERE photo_id=$1', [photo.id])).rows[0]
          if ((task.kind === 'photo' && (!photo.deleted_at || photo.visit_id)) || (task.kind === 'incoming' && ['prepared', 'uploaded'].includes(upload.state))) return false
          await this.storage.remove(task.object_key)
          await client.query("UPDATE cleanup_tasks SET state='done',attempts=attempts+1,last_error=NULL WHERE id=$1", [task.id])
          return true
        })
        if (removed) done++
      } catch {
        failed++
        await this.db.pool.query("UPDATE cleanup_tasks SET attempts=attempts+1,last_error='OBJECT_REMOVE_OR_ACK_FAILED' WHERE owner=$1 AND id=$2 AND state='pending'", [actor.owner, taskId])
      }
    }
    const { taskIds: _taskIds, ...summary } = planned.body.cleanup
    return { ...planned, body: { ...planned.body, cleanup: { ...summary, done, failed } } }
  }
}
