import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { fail } from './errors.js'
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
export const randomToken = () => randomBytes(32).toString('base64url')
export const csrfFor = (sessionToken: string) => createHmac('sha256', sessionToken).update('shanhai-csrf-v1').digest('base64url')
export const equalSecret = (a: string, b: string) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)))
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical((value as Record<string, unknown>)[key])).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
export class Signer {
  constructor(private key: string) {}
  sign(value: Record<string, unknown>): string {
    const payload = Buffer.from(canonical(value)).toString('base64url')
    return payload + '.' + createHmac('sha256', this.key).update(payload).digest('base64url')
  }
  verify(token: unknown, purpose: string): Record<string, any> {
    if (typeof token !== 'string' || token.length > 2000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) fail(403, 'INVALID_TOKEN', 'Invalid or expired capability')
    const [payload, signature] = token.split('.') as [string, string]
    if (!equalSecret(signature, createHmac('sha256', this.key).update(payload).digest('base64url'))) fail(403, 'INVALID_TOKEN', 'Invalid or expired capability')
    let value
    try { value = JSON.parse(Buffer.from(payload, 'base64url').toString()) } catch { fail(403, 'INVALID_TOKEN', 'Invalid or expired capability') }
    if (value.purpose !== purpose || (value.expires !== undefined && (!Number.isFinite(value.expires) || value.expires <= Date.now()))) fail(403, 'INVALID_TOKEN', 'Invalid or expired capability')
    return value
  }
}
