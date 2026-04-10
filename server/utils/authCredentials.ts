import bcrypt from 'bcrypt'

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/
const BCRYPT_ROUNDS = 10

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string') return null
  const u = username.trim()
  if (!USERNAME_RE.test(u)) return null
  return u
}

export function validatePasswordPlain(password: unknown): string | null {
  if (typeof password !== 'string') return null
  if (password.length < 8 || password.length > 128) return null
  return password
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
