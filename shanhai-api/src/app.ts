import 'reflect-metadata'
import { All, Catch, Controller, HttpException, Inject, Module, Req, Res, type ArgumentsHost, type ExceptionFilter, type INestApplication } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import express, { type NextFunction, type Request, type Response } from 'express'
import { randomUUID } from 'node:crypto'
import { Auth } from './auth.js'
import { Catalogue, CATALOGUE_VERSION, VALIDATION_VERSION } from './catalogue.js'
import { type ApiConfig, validateConfig } from './config.js'
import { Signer } from './crypto.js'
import { Database, type Result } from './db.js'
import { ApiError, fail, fields, string } from './errors.js'
import { Photos, PHOTO_LIMIT } from './photos.js'
import { Records } from './records.js'
import { PrivateStorage } from './storage.js'

function respondError(error: unknown, res: Response) {
  const value = error as any
  const known = value instanceof ApiError
  const status = known ? value.status : value instanceof HttpException ? value.getStatus() : value?.type === 'entity.too.large' ? 413 : value instanceof SyntaxError || value?.code === '22P02' ? 400 : ['23505', '23503', '23514'].includes(value?.code) ? 409 : 500
  const code = known ? value.code : status === 404 ? 'NOT_FOUND' : status === 413 ? 'BODY_TOO_LARGE' : status === 400 ? 'INVALID_JSON' : status === 409 ? 'RELATION_CONFLICT' : 'INTERNAL_ERROR'
  if (!res.headersSent) res.status(status).json({ error: { code, message: known ? value.message : 'The request could not be completed safely', ...(known && value.details ? { details: value.details } : {}), requestId: res.getHeader('X-Request-Id') } })
}
@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) { respondError(error, host.switchToHttp().getResponse<Response>()) }
}
interface Services { db: Database; auth: Auth; records: Records; photos: Photos; config: ApiConfig }
@Controller('api/v1')
class ApiController {
  constructor(@Inject('SERVICES') private services: Services) {}
  @All('*path')
  async handle(@Req() req: Request, @Res() res: Response) {
    const { db, auth, records, photos, config } = this.services
    const route = req.path.slice('/api/v1'.length), method = req.method
    const send = (result: Result) => {
      if (result.body.error) result.body.error = { ...result.body.error, requestId: res.getHeader('X-Request-Id') }
      const version = result.body.visit?.version || result.body.customPlace?.version || result.body.mapCover?.version
      if (version) res.setHeader('ETag', `"${version}"`)
      return res.status(result.status).json(result.body)
    }
    if (method === 'GET' && route === '/capabilities') return res.json({ apiVersion: '1', validationVersion: VALIDATION_VERSION, catalogueVersion: CATALOGUE_VERSION, provinces: 34, regions: 49, publicPlaces: 43, completeNationalCatalogue: false, testIdentityOnly: true, photo: { maxBytes: PHOTO_LIMIT, maxPhotosPerVisit: 9, stripsMetadata: true }, fixedSnapshots: false, legacyMigration: false })
    if (method === 'GET' && route === '/health') { await db.pool.query('SELECT 1'); return res.json({ status: 'ok', scope: 'loopback-test-only' }) }
    if (method === 'POST' && route === '/testing/login') {
      if (req.headers.origin !== config.origin) fail(403, 'ORIGIN_REQUIRED', 'The local test login requires its exact origin')
      return res.status(200).json(await auth.login(req, res))
    }
    const upload = /^\/uploads\/([0-9a-f-]{36})\/content$/.exec(route)
    if (method === 'PUT' && upload) return res.json(await photos.upload(req, upload[1]))
    const download = /^\/photos\/([0-9a-f-]{36})\/content$/.exec(route)
    if (method === 'GET' && download) {
      const result = await photos.download(req, download[1])
      return res.type(result.mime).setHeader('Content-Disposition', 'inline; filename="photo.jpg"').send(result.bytes)
    }
    const actor = await auth.require(req, !['GET', 'HEAD'].includes(method))
    res.setHeader('X-Shanhai-Account', actor.owner)
    if (req.get('X-Shanhai-Account') && req.get('X-Shanhai-Account') !== actor.owner) fail(409, 'ACCOUNT_CHANGED', 'The active account changed; clear private views and reload the session')
    if (method === 'GET' && route === '/session') return res.json(await auth.session(actor))
    if (method === 'POST' && route === '/auth/logout') { fields(req.body || {}, []); await auth.logout(actor, res); return res.status(204).end() }
    if (method === 'POST' && route === '/custom-places') return send(await records.customCreate(actor, req))
    const custom = /^\/custom-places\/([^/]+)$/.exec(route)
    if (custom && method === 'GET') return res.json({ customPlace: await records.get(actor, 'custom_places', custom[1]) })
    if (custom && method === 'DELETE') return send(await records.remove(actor, req, 'custom_places', custom[1]))
    if (method === 'POST' && route === '/visits') return send(await records.visitCreate(actor, req))
    if (method === 'GET' && route === '/visits') return res.json(await records.list(actor, req.query.cursor, req.query.limit))
    const visit = /^\/visits\/([^/]+)$/.exec(route)
    if (visit && method === 'GET') return send({ status: 200, body: { visit: await records.get(actor, 'visits', visit[1]) } })
    if (visit && method === 'PATCH') return send(await records.visitPatch(actor, req, visit[1]))
    if (visit && method === 'DELETE') return send(await records.remove(actor, req, 'visits', visit[1]))
    const cover = /^\/map-covers\/([^/]+)$/.exec(route)
    if (cover && ['PUT', 'DELETE'].includes(method)) {
      let placeKey: string
      try { placeKey = decodeURIComponent(cover[1]) } catch { fail(400, 'INVALID_PATH', 'Invalid path encoding') }
      return send(await records.cover(actor, req, placeKey))
    }
    if (method === 'GET' && route === '/map-covers') {
      const rows = (await db.pool.query('SELECT place_key,visit_id,photo_id,version FROM map_covers WHERE owner=$1 AND deleted_at IS NULL ORDER BY place_key', [actor.owner])).rows
      return res.json({ items: rows.map(row => ({ id: row.place_key, placeKey: row.place_key, visitId: row.visit_id, photoId: row.photo_id, version: String(row.version) })) })
    }
    if (method === 'POST' && route === '/photos/uploads') return send(await photos.prepare(actor, req))
    const state = /^\/photos\/uploads\/([^/]+)$/.exec(route)
    if (state && method === 'GET') return res.json(await photos.status(actor, state[1]))
    if (state && method === 'DELETE') return send(await photos.cancel(actor, req, state[1]))
    const complete = /^\/photos\/uploads\/([^/]+)\/complete$/.exec(route)
    if (complete && method === 'POST') return send(await photos.complete(actor, req, complete[1]))
    const signing = /^\/photos\/([^/]+)\/download-url$/.exec(route)
    if (signing && method === 'POST') return res.json(await photos.downloadUrl(actor, req, signing[1]))
    if (method === 'GET' && route === '/cleanup-tasks') return res.json(await photos.cleanupList(actor))
    if (method === 'POST' && route === '/cleanup/retry') return send(await photos.cleanup(actor, req))
    if (method === 'GET' && route === '/sync/changes') return res.json(await records.sync(actor, req.query.cursor, req.query.limit))
    const receipt = /^\/mutations\/([^/]+)$/.exec(route)
    if (method === 'GET' && receipt) {
      let operationId: string
      try { operationId = decodeURIComponent(receipt[1]) } catch { fail(400, 'INVALID_PATH', 'Invalid path encoding') }
      string(operationId, 'operationId', 128)
      const row = (await db.pool.query('SELECT status,result FROM mutation_receipts WHERE owner=$1 AND operation_id=$2', [actor.owner, operationId])).rows[0]
      if (!row) fail(404, 'NOT_FOUND', 'Not found')
      return res.json({ operationId, status: row.status, result: row.result })
    }
    fail(404, 'NOT_FOUND', 'Not found')
  }
}

/** Initialized but not listening. The optional callback is for a separate local QA launcher. */
export async function createApp(input: ApiConfig, configure?: (app: INestApplication) => void | Promise<void>): Promise<INestApplication> {
  const config = validateConfig(input), db = new Database(config.databaseUrl)
  let app: INestApplication | undefined
  try {
    const storage = new PrivateStorage(config.storageRoot); await storage.init()
    const catalogue = new Catalogue(); await catalogue.load()
    const signer = new Signer(await db.secret())
    const services: Services = { db, config, auth: new Auth(db, config), records: new Records(db, catalogue, signer), photos: new Photos(db, storage, signer, config.origin) }
    @Module({ controllers: [ApiController], providers: [{ provide: 'SERVICES', useValue: services }, { provide: 'DATABASE_CLOSE', useValue: { onModuleDestroy: () => db.close() } }] })
    class ApiModule {}
    app = await NestFactory.create(ApiModule, { logger: false, bodyParser: false, abortOnError: false })
    app.getHttpAdapter().getInstance().disable('x-powered-by')
    let loginWindow = Date.now(), loginAttempts = 0
    app.use((req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Request-Id', randomUUID())
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Referrer-Policy', 'no-referrer')
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
      res.setHeader('Cache-Control', 'private, no-store')
      const hostCount = req.rawHeaders.filter((_, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === 'host').length
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '') || hostCount !== 1 || req.headers.host !== new URL(config.origin).host || (req.headers.origin !== undefined && req.headers.origin !== config.origin)) return respondError(new ApiError(403, 'ORIGIN_REJECTED', 'Only the configured loopback host and origin are allowed'), res)
      if (req.path === '/api/v1/testing/login') {
        if (Date.now() - loginWindow > 60_000) { loginWindow = Date.now(); loginAttempts = 0 }
        if (++loginAttempts > 100) return respondError(new ApiError(429, 'LOGIN_RATE_LIMIT', 'Wait before trying the local login again'), res)
      }
      next()
    })
    app.use(express.json({ limit: '64kb', strict: true, type: 'application/json' }))
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => respondError(error, res))
    app.useGlobalFilters(new Errors())
    if (configure) await configure(app)
    await app.init()
    const server = app.getHttpServer()
    server.requestTimeout = 15_000
    server.headersTimeout = 10_000
    server.maxHeadersCount = 50
    const listen = app.listen.bind(app)
    app.listen = (async (port: number | string, host?: string, ...args: any[]) => {
      if (Number(port) !== config.port || (host !== undefined && host !== '127.0.0.1')) throw new Error('This test API can listen only on its configured 127.0.0.1 port')
      return listen(config.port, '127.0.0.1', ...args)
    }) as typeof app.listen
    return app
  } catch (error) { if (app) await app.close(); else await db.close(); throw error }
}
