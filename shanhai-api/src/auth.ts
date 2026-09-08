import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { Database, type Actor } from './db.js'
import { csrfFor, equalSecret, hash, randomToken } from './crypto.js'
import { fail, fields } from './errors.js'
import type { ApiConfig } from './config.js'
export class Auth {
  constructor(private db: Database, private config: ApiConfig) {}
  async login(req: Request, res: Response) {
    if (!this.config.testAuthEnabled) fail(404, 'NOT_FOUND', 'Not found')
    const value = fields(req.body, ['subject', 'secret'])
    if (!['alice', 'bob'].includes(String(value.subject)) || typeof value.secret !== 'string' || !equalSecret(value.secret, this.config.testAuthSecret)) fail(401, 'TEST_AUTH_FAILED', 'Invalid local test identity credentials')
    const token = randomToken(), csrfToken = csrfFor(token), expiresAt = new Date(Date.now() + 12 * 60 * 60_000)
    const account = await this.db.tx(async client => {
      await client.query('INSERT INTO accounts(id,subject,sync_epoch) VALUES($1,$2,$3) ON CONFLICT(subject) DO NOTHING', [randomUUID(), value.subject, randomUUID()])
      const account = (await client.query("SELECT id,status FROM accounts WHERE subject=$1 AND status='active' FOR UPDATE", [value.subject])).rows[0]
      if (!account) fail(401, 'TEST_AUTH_FAILED', 'Invalid local test identity credentials')
      await client.query('INSERT INTO sessions(id,owner,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), account.id, hash(token), hash(csrfToken), expiresAt])
      return account
    })
    // Secure is intentionally absent only for the explicitly gated HTTP loopback lab.
    res.setHeader('Set-Cookie', `shanhai_session=${token}; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=43200`)
    res.setHeader('X-Shanhai-Account', account.id)
    return { account, csrfToken, expiresAt: expiresAt.toISOString(), testIdentityOnly: true }
  }
  async require(req: Request, write = false): Promise<Actor> {
    const cookies = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith('shanhai_session='))
    const token = cookies.length === 1 ? cookies[0].slice('shanhai_session='.length) : ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(401, 'SESSION_EXPIRED', 'Please sign in again')
    const session = (await this.db.pool.query("SELECT s.* FROM sessions s JOIN accounts a ON a.id=s.owner WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND a.status='active'", [hash(token)])).rows[0]
    if (!session) fail(401, 'SESSION_EXPIRED', 'Please sign in again')
    if (write && (req.headers.origin !== this.config.origin || typeof req.headers['x-csrf-token'] !== 'string' || !equalSecret(hash(req.headers['x-csrf-token']), session.csrf_hash))) fail(403, 'CSRF_FAILED', 'Same-origin CSRF proof is required')
    return { owner: session.owner, sessionId: session.id, token }
  }
  async session(actor: Actor) {
    const row = (await this.db.pool.query('SELECT s.expires_at,a.id,a.status FROM sessions s JOIN accounts a ON a.id=s.owner WHERE s.id=$1', [actor.sessionId])).rows[0]
    return { account: { id: row.id, status: row.status }, csrfToken: csrfFor(actor.token), expiresAt: row.expires_at.toISOString() }
  }
  async logout(actor: Actor, res: Response) {
    await this.db.tx(async client => { await this.db.lock(client, actor); await client.query('UPDATE sessions SET revoked_at=now() WHERE id=$1', [actor.sessionId]) })
    res.setHeader('Set-Cookie', 'shanhai_session=; HttpOnly; SameSite=Strict; Path=/api/v1; Max-Age=0')
  }
}
