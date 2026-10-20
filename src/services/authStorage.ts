export const AUTH_STORAGE_KEY = 'passports.auth'

export interface StoredAuth {
  token: string
  locationId: 'csc' | 'bookstore'
}

function isValidAuth(value: unknown): value is StoredAuth {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.token === 'string'
    && candidate.token.length > 0
    && (candidate.locationId === 'csc' || candidate.locationId === 'bookstore')
}

export function loadStoredAuth(): StoredAuth | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return isValidAuth(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveStoredAuth(auth: StoredAuth): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
}

export function clearStoredAuth(): void {
  localStorage.removeItem(AUTH_STORAGE_KEY)
}
