import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import path from 'node:path'
import { hash } from './crypto.js'
export class PrivateStorage {
  constructor(readonly root: string) {}
  async init() {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    if ((await lstat(this.root)).isSymbolicLink() || path.resolve(await realpath(this.root)) !== path.resolve(this.root)) throw new Error('Private storage may not resolve through a link')
  }
  private target(key: string) {
    if (!/^(incoming|photo)-[0-9a-f-]{36}$/.test(key)) throw new Error('Invalid internal object key')
    return path.join(this.root, key)
  }
  async read(key: string): Promise<Buffer> {
    const target = this.target(key), info = await lstat(target)
    if (info.isSymbolicLink() || !info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Unsafe private object')
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
    try { return await file.readFile() } finally { await file.close() }
  }
  async putOnce(key: string, bytes: Buffer) {
    if (bytes.length > 10 * 1024 * 1024) throw new Error('Object exceeds private storage bound')
    let file
    try { file = await open(this.target(key), 'wx', 0o600) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || hash(await this.read(key)) !== hash(bytes)) throw error
      return // Recovery of a pre-commit crash; ordinary repeated uploads fail at DB state validation.
    }
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  }
  async remove(key: string) {
    const target = this.target(key)
    try { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw new Error('Refusing unsafe object cleanup'); await unlink(target) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}
