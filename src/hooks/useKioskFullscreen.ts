import { useEffect, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

// A touch screen at least as wide as an iPad in portrait. Desktop browsers
// report a fine pointer, so they keep the normal page with header and footer.
const TOUCH_TABLET_QUERY = '(pointer: coarse) and (min-width: 768px)'
const PREVIEW_STORAGE_KEY = 'kioskView'

function subscribe(onChange: () => void) {
  const query = window.matchMedia(TOUCH_TABLET_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

const isTouchTablet = () => window.matchMedia(TOUCH_TABLET_QUERY).matches

function previewStored(): boolean {
  try {
    return sessionStorage.getItem(PREVIEW_STORAGE_KEY) === 'tablet'
  } catch {
    return false
  }
}

/**
 * True when the check-in kiosk should fill the whole screen with no site
 * header, navigation or footer: on a tablet at /kiosk/:location, or on any
 * device after opening an address ending in ?view=tablet (for previewing from
 * a desktop). The preview sticks for the browser tab, so going to the
 * dashboard and back keeps it; ?view=desktop turns it off again.
 */
export function useKioskFullscreen(): boolean {
  const { pathname, search } = useLocation()
  const touchTablet = useSyncExternalStore(subscribe, isTouchTablet)
  const view = new URLSearchParams(search).get('view')

  useEffect(() => {
    try {
      if (view === 'tablet') sessionStorage.setItem(PREVIEW_STORAGE_KEY, 'tablet')
      else if (view === 'desktop') sessionStorage.removeItem(PREVIEW_STORAGE_KEY)
    } catch { /* ignore */ }
  }, [view])

  const forced = view === 'tablet' || (view !== 'desktop' && previewStored())
  return pathname.startsWith('/kiosk/') && (touchTablet || forced)
}
