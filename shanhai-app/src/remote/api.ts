export interface RemoteSession { account: { id: string; status: string }; csrfToken: string; expiresAt: string }
export interface RemoteOptions { origin?: string; fetch?: typeof globalThis.fetch; indexedDB?: IDBFactory; crypto?: Crypto }
export interface RemoteCapabilities { validationVersion: string; catalogueVersion: string; testIdentityOnly: true }
export class RemoteError extends Error {
  readonly friendlyMessage: string
  constructor(public code: string, message: string, public status = 0) { super(message); this.name = 'ShanhaiRemoteError'; this.friendlyMessage = message }
}
export const remoteError = (code: string, message: string, status = 0) => new RemoteError(code, message, status)
export function settings(options: RemoteOptions = {}) {
  const origin = options.origin || globalThis.location?.origin
  const url = new URL(origin || '')
  if (url.origin !== origin || url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || url.username || url.password) throw remoteError('remote-disabled', '账号连接只允许明确的本机 127.0.0.1 测试来源。')
  if (!options.fetch && globalThis.location?.origin !== origin) throw remoteError('remote-disabled', '账号接口必须与当前页面同源。')
  return { origin, fetch: options.fetch || globalThis.fetch.bind(globalThis), crypto: options.crypto || globalThis.crypto, indexedDB: options.indexedDB || globalThis.indexedDB }
}
const validSession = (value: unknown): value is RemoteSession => {
  const row = value as RemoteSession | undefined
  return !!row && /^[a-f0-9-]{36}$/.test(row.account?.id || '') && row.account.status === 'active' && typeof row.csrfToken === 'string' && row.csrfToken.length >= 32 && typeof row.expiresAt === 'string'
}
async function sessionRequest(path: string, body: unknown, options: RemoteOptions, session?: RemoteSession): Promise<RemoteSession | null> {
  const config = settings(options)
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await config.fetch(config.origin + '/api/v1' + path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: config.origin }), ...(session ? { 'X-CSRF-Token': session.csrfToken, 'X-Shanhai-Account': session.account.id } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (response.status === 401 && body === undefined) return null
    if (response.status === 204 && session) return null
    if (!response.ok) throw remoteError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'remote-unavailable', '本机账号服务未能完成请求，请检查服务和测试身份。', response.status)
    const value: unknown = await response.json()
    if (!validSession(value) || response.headers.get('X-Shanhai-Account') !== value.account.id) throw remoteError('unauthorized', '账号响应不一致，已停止读取私人资料。')
    return value
  } catch (cause) {
    if (cause instanceof RemoteError) throw cause
    throw remoteError('remote-unavailable', '本机账号连接暂时不可用，登录状态尚未确认；请检查服务后重试。')
  } finally { clearTimeout(timeout) }
}
export const getSession = (options: RemoteOptions = {}) => sessionRequest('/session', undefined, options)
export async function testLogin(subject: 'alice' | 'bob', secret: string, options: RemoteOptions = {}) {
  const result = await sessionRequest('/testing/login', { subject, secret }, options)
  if (!result) throw remoteError('unauthorized', '测试登录没有返回有效会话。')
  return result
}
export async function logout(session: RemoteSession, options: RemoteOptions = {}) { await sessionRequest('/auth/logout', {}, options, session) }

export class RemoteApi {
  private closed = false
  private controllers = new Set<AbortController>()
  readonly config: ReturnType<typeof settings>
  constructor(readonly session: RemoteSession, options: RemoteOptions, private invalidated: (error: RemoteError) => void) { this.config = settings(options) }
  check(signal?: AbortSignal) { if (this.closed) throw remoteError('unauthorized', '账号服务已隔离；旧请求不能继续。'); if (signal?.aborted) throw new DOMException('已取消读取', 'AbortError') }
  close() { this.closed = true; for (const controller of this.controllers) controller.abort(); this.controllers.clear() }
  private invalidate() { const cause = remoteError('unauthorized', '登录已失效或账号已切换；私人视图已停止，草稿与待发送记录保留在原账号。'); this.close(); this.invalidated(cause); throw cause }
  async request<T>(path: string, options: { method?: string; body?: unknown; key?: string; headers?: Record<string, string>; signal?: AbortSignal; public?: boolean } = {}): Promise<T> {
    this.check(options.signal)
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) throw remoteError('invalid-route', '无效接口路径。')
    const controller = new AbortController(), abort = () => controller.abort()
    this.controllers.add(controller); options.signal?.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(abort, 20_000)
    try {
      const method = options.method || 'GET'
      const response = await this.config.fetch(this.config.origin + '/api/v1' + path, { method, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { ...(options.public ? {} : { 'X-Shanhai-Account': this.session.account.id }), ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', Origin: this.config.origin, 'X-CSRF-Token': this.session.csrfToken }), ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...options.headers },
        body: options.body === undefined ? undefined : JSON.stringify(options.body) })
      this.check(options.signal)
      if (response.status === 401 || response.status === 403 || (!options.public && response.headers.get('X-Shanhai-Account') !== this.session.account.id)) this.invalidate()
      const value = response.status === 204 ? {} : await response.json()
      this.check(options.signal)
      if (!response.ok) {
        if (value.error?.code === 'ACCOUNT_CHANGED') this.invalidate()
        const code = response.status === 412 ? 'stale' : response.status === 410 ? 'missing' : value.error?.code || 'remote-failed'
        const message = code === 'stale' ? '另一端已修改这条回忆，请重新读取后决定，当前草稿仍保留。' : code === 'missing' ? '这条回忆或上传已被删除，不能用旧操作复活。' : response.status >= 500 ? '本机服务暂时不可用；原操作编号和草稿仍保留，可重试。' : `账号请求未完成（${code}），资料未被静默覆盖。`
        throw remoteError(code, message, response.status)
      }
      return value as T
    } catch (cause) {
      this.check(options.signal)
      if (cause instanceof RemoteError) throw cause
      throw remoteError('remote-unavailable', '连接暂时不可用，保存结果尚未确认；草稿和原操作已保留，重试会先核对，不会重复保存。')
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); this.controllers.delete(controller) }
  }
  async capability(urlInput: string, method: 'GET' | 'PUT', body?: Uint8Array, headers?: Record<string, string>, signal?: AbortSignal) {
    this.check(signal)
    const url = new URL(urlInput)
    const allowed = method === 'PUT' ? /^\/api\/v1\/uploads\/[a-f0-9-]{36}\/content$/ : /^\/api\/v1\/photos\/[a-f0-9-]{36}\/content$/
    if (url.origin !== this.config.origin || !allowed.test(url.pathname) || url.hash || url.username || url.password || !url.searchParams.has('token')) throw remoteError('invalid-capability', '拒绝非本来源的照片能力地址。')
    const controller = new AbortController(), abort = () => controller.abort()
    this.controllers.add(controller); signal?.addEventListener('abort', abort, { once: true }); const timeout = setTimeout(abort, 20_000)
    try {
      const response = await this.config.fetch(url.href, { method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal, headers, body: body ? body.slice().buffer as ArrayBuffer : undefined })
      this.check(signal)
      if (!response.ok) throw remoteError('photo-unavailable', '照片传输未完成；未丢弃待发送原操作。', response.status)
      if (method === 'PUT') return new Uint8Array()
      const announced = Number(response.headers.get('Content-Length') || 0)
      if (announced > 10 * 1024 * 1024) throw remoteError('invalid-photo', '照片超过允许大小。')
      const chunks: Uint8Array[] = []; let length = 0
      if (!response.body) throw remoteError('invalid-photo', '照片响应没有内容。')
      const reader = response.body.getReader()
      try {
        for (;;) {
          const part = await reader.read(); this.check(signal); if (part.done) break
          length += part.value.length
          if (length > 10 * 1024 * 1024) { await reader.cancel(); throw remoteError('invalid-photo', '照片超过允许大小。') }
          chunks.push(part.value)
        }
      } finally { reader.releaseLock() }
      const bytes = new Uint8Array(length); let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
      this.check(signal)
      return bytes
    } catch (cause) {
      this.check(signal)
      if (cause instanceof RemoteError) throw cause
      throw remoteError('remote-unavailable', '照片传输结果尚未确认；草稿和原操作已保留，重试会先核对，不会重复保存。')
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.controllers.delete(controller) }
  }
}
export async function sha256(crypto: Crypto, input: Uint8Array | string) {
  if (!crypto?.subtle) throw remoteError('unsupported', '浏览器缺少安全摘要功能，不能发送照片。')
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)), byte => byte.toString(16).padStart(2, '0')).join('')
}
