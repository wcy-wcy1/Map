import pg, { type PoolClient } from 'pg'
import { randomUUID } from 'node:crypto'
import { randomToken, hash, canonical } from './crypto.js'
import { fail, string } from './errors.js'
export type Client = PoolClient
export interface Actor { owner: string; sessionId: string; token: string }
export interface Change { entity: string; id: string; version: string; operation: 'upsert' | 'delete'; value?: unknown; deletedAt?: string }
export interface Result { status: number; body: Record<string, any> }
export class Database {
  pool: pg.Pool
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, max: 6, connectionTimeoutMillis: 5000, statement_timeout: 15000 }) }
  async tx<T>(action: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try { await client.query('BEGIN'); const result = await action(client); await client.query('COMMIT'); return result }
    catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
  }
  async secret(): Promise<string> {
    await this.pool.query("INSERT INTO service_secrets(id,value) VALUES('signing-v1',$1) ON CONFLICT DO NOTHING", [randomToken()])
    return (await this.pool.query("SELECT value FROM service_secrets WHERE id='signing-v1'")).rows[0].value
  }
  async lock(client: Client, actor: Actor) {
    const row = (await client.query("SELECT * FROM accounts WHERE id=$1 AND status='active' FOR UPDATE", [actor.owner])).rows[0]
    if (!row || !(await client.query('SELECT 1 FROM sessions WHERE id=$1 AND owner=$2 AND revoked_at IS NULL AND expires_at>now()', [actor.sessionId, actor.owner])).rowCount) fail(401, 'SESSION_EXPIRED', 'Please sign in again')
    return row
  }
  async changes(client: Client, owner: string, changes: Change[]): Promise<string | null> {
    if (!changes.length) return null
    const account = (await client.query('UPDATE accounts SET sequence=sequence+1 WHERE id=$1 RETURNING sequence', [owner])).rows[0]
    await client.query('INSERT INTO sync_commits(owner,sequence,id,changes) VALUES($1,$2,$3,$4)', [owner, account.sequence, randomUUID(), JSON.stringify(changes)])
    return account.sequence
  }
  async mutate(actor: Actor, operation: unknown, fingerprint: unknown, work: (client: Client, changes: Change[]) => Promise<Result>): Promise<Result> {
    const operationId = string(operation, 'Idempotency-Key', 128), requestHash = hash(canonical(fingerprint))
    return this.tx(async client => {
      await this.lock(client, actor)
      const previous = (await client.query('SELECT * FROM mutation_receipts WHERE owner=$1 AND operation_id=$2', [actor.owner, operationId])).rows[0]
      if (previous) {
        if (previous.request_hash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', 'This operation key was used with different content')
        return { status: previous.status, body: { ...previous.result, receipt: { operationId, replayed: true } } }
      }
      const changes: Change[] = [], result = await work(client, changes)
      const sequence = await this.changes(client, actor.owner, changes)
      result.body = { ...result.body, ...(sequence ? { changeSequence: sequence } : {}), receipt: { operationId, replayed: false } }
      await client.query('INSERT INTO mutation_receipts(owner,operation_id,request_hash,status,result) VALUES($1,$2,$3,$4,$5)', [actor.owner, operationId, requestHash, result.status, JSON.stringify(result.body)])
      return result
    })
  }
  async close() { await this.pool.end() }
}
