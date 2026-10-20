import type { LocationId } from '../context/AppContext'

const KIOSK_LOCATION_STORAGE_KEY = 'kioskLocation'

/** The location this browser last checked visitors in for; CSC if none yet. */
export function loadKioskLocation(): LocationId {
  try {
    if (localStorage.getItem(KIOSK_LOCATION_STORAGE_KEY) === 'bookstore') return 'bookstore'
  } catch { /* ignore */ }
  return 'csc'
}

export function saveKioskLocation(location: LocationId) {
  try {
    localStorage.setItem(KIOSK_LOCATION_STORAGE_KEY, location)
  } catch { /* ignore */ }
}
