import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import { clearStoredAuth, loadStoredAuth, saveStoredAuth } from '../services/authStorage'
import { saveKioskLocation } from '../services/kioskLocation'

export type Language = 'en' | 'es' | 'zh' | 'vi'
export type LocationId = 'csc' | 'bookstore'

interface AuthState {
  token: string
  locationId: LocationId
}

interface AppState {
  currentLanguage: Language
  kioskLocation: LocationId | null
  auth: AuthState | null
}

interface AppContextValue extends AppState {
  setLanguage: (lang: Language) => void
  setKioskLocation: (loc: LocationId | null) => void
  login: (token: string, locationId: LocationId) => void
  logout: () => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({
    currentLanguage: 'en',
    kioskLocation: null,
    auth: loadStoredAuth(),
  })

  const setLanguage = useCallback((lang: Language) => setState(s => ({ ...s, currentLanguage: lang })), [])
  const setKioskLocation = useCallback((loc: LocationId | null) => {
    if (loc) saveKioskLocation(loc)
    setState(s => ({ ...s, kioskLocation: loc }))
  }, [])
  const login = useCallback((token: string, locationId: LocationId) => {
    const auth = { token, locationId }
    saveStoredAuth(auth)
    setState(s => ({ ...s, auth }))
  }, [])
  const logout = useCallback(() => {
    clearStoredAuth()
    setState(s => ({ ...s, auth: null }))
  }, [])

  const value = useMemo<AppContextValue>(
    () => ({ ...state, setLanguage, setKioskLocation, login, logout }),
    [state, setLanguage, setKioskLocation, login, logout],
  )

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
