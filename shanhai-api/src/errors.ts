export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message) }
}
export function fail(status: number, code: string, message: string, details?: unknown): never { throw new ApiError(status, code, message, details) }
export function fields(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.isBuffer(value)) fail(400, 'INVALID_FIELD', 'Expected a JSON object')
  const result = value as Record<string, unknown>
  if (Object.keys(result).some(key => !allowed.includes(key))) fail(400, 'INVALID_FIELD', 'Unknown or forbidden field')
  return result
}
export function string(value: unknown, name: string, max = 100, min = 1): string {
  if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) fail(422, 'VALIDATION_FAILED', `Invalid ${name}`)
  return value
}
export function version(value: string | undefined): string {
  if (!value) fail(428, 'VERSION_REQUIRED', 'If-Match is required')
  if (!/^"[1-9][0-9]*"$/.test(value)) fail(400, 'INVALID_VERSION', 'If-Match must contain a quoted positive version')
  return value.slice(1, -1)
}
