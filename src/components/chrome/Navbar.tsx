import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useApp, type Language, type LocationId } from '../../context/AppContext'
import { t } from '../../services/translations'

const languages: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
]

const locations: { id: LocationId; label: string }[] = [
  { id: 'csc', label: 'CSC' },
  { id: 'bookstore', label: 'Bookstore' },
]

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentLanguage, setLanguage, auth, logout } = useApp()
  const [openMenu, setOpenMenu] = useState<'checkin' | 'language' | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const navRef = useRef<HTMLElement>(null)

  // An open dropdown closes when the user clicks or taps anywhere outside
  // it, or presses Escape.
  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (e: PointerEvent) => {
      const inOpenMenu = (e.target as Element | null)?.closest?.('.dropdown.open')
      if (!inOpenMenu || !navRef.current?.contains(inOpenMenu)) setOpenMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const path = location.pathname
  const isDashboard = path.startsWith('/dashboard')
  const isKiosk = path.startsWith('/kiosk') || path.startsWith('/mobile')
  const isLogin = path === '/dashboard/login'
  const lang = currentLanguage

  // Phone check-ins (from the QR code) stay on the phone route.
  const checkinPage = path.startsWith('/mobile') ? '/mobile' : '/kiosk'
  const currentLocation = isKiosk ? path.split('/')[2] : null
  // A signed-in dashboard is tied to the location of the password used.
  const showCheckin = !isDashboard || isLogin

  const dashboardPath = auth ? '/dashboard/visitor-log' : '/dashboard/login'

  const closeMobile = () => setMobileOpen(false)
  const toggleMenu = (menu: 'checkin' | 'language') => setOpenMenu(open => (open === menu ? null : menu))

  return (
    <nav ref={navRef} className="navbar navbar-default navbar-static-top" role="navigation">
      <div className="container">
        <div className="navbar-header">
          <button
            type="button"
            className="navbar-toggle"
            onClick={() => setMobileOpen(o => !o)}
            aria-expanded={mobileOpen}
            aria-controls="site-nav"
          >
            <span className="sr-only">Toggle navigation</span>
            <div className="col-sm-1 mobile-nav-bars">
              <span className="icon-bar"></span>
              <span className="icon-bar"></span>
              <span className="icon-bar"></span>
            </div>
            <div className="col-sm-1 mobile-nav-icon">MENU</div>
          </button>
          <div className="col-sm-4 pull-right visible-xs-block">
            <img
              src="https://cdn.ucsd.edu/developer/decorator/5.0.2/img/ucsd-footer-logo-white.png"
              alt="UC San Diego"
              className="img-responsive header-logo"
            />
          </div>
        </div>

        <div className={`collapse navbar-collapse ${mobileOpen ? 'in' : ''}`} id="site-nav">
          <ul className="nav navbar-nav">
            <li className={isDashboard ? 'active' : ''}>
              <a href={dashboardPath} onClick={e => { e.preventDefault(); navigate(dashboardPath); closeMobile() }}>
                {t('dashboard.link', undefined, lang)}
              </a>
            </li>
            {showCheckin && (
              <li className={`dropdown ${isKiosk ? 'active' : ''} ${openMenu === 'checkin' ? 'open' : ''}`}>
                <a href="#" className="dropdown-toggle" onClick={e => { e.preventDefault(); toggleMenu('checkin') }}
                  role="button" aria-haspopup="true" aria-expanded={openMenu === 'checkin'}>
                  {t('nav.checkin', undefined, lang)}
                  <span className="caret" style={{ marginLeft: 4 }}></span>
                </a>
                <ul className="dropdown-menu" style={{ display: openMenu === 'checkin' ? 'block' : 'none' }}>
                  {locations.map(loc => (
                    <li key={loc.id} className={currentLocation === loc.id ? 'active' : ''}>
                      <a href={`${checkinPage}/${loc.id}`} onClick={e => {
                        e.preventDefault()
                        navigate(`${checkinPage}/${loc.id}`)
                        setOpenMenu(null)
                        closeMobile()
                      }}>
                        {loc.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            )}
          </ul>

          <ul className="nav navbar-nav navbar-right">
            <li className={`dropdown ${openMenu === 'language' ? 'open' : ''}`}>
              <a href="#" className="dropdown-toggle" onClick={e => { e.preventDefault(); toggleMenu('language') }}
                role="button" aria-haspopup="true" aria-expanded={openMenu === 'language'}>
                {languages.find(l => l.code === currentLanguage)?.label || 'English'}
                <span className="caret" style={{ marginLeft: 4 }}></span>
              </a>
              <ul className="dropdown-menu" style={{ display: openMenu === 'language' ? 'block' : 'none' }}>
                {languages.map(l => (
                  <li key={l.code} className={currentLanguage === l.code ? 'active' : ''}>
                    <a href="#" onClick={e => {
                      e.preventDefault()
                      setLanguage(l.code)
                      setOpenMenu(null)
                    }}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
            {isDashboard && auth && (
              <li>
                <a href="/dashboard/login" onClick={e => { e.preventDefault(); logout(); navigate('/dashboard/login'); closeMobile() }}>
                  {t('nav.logOut', undefined, lang)}
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>
    </nav>
  )
}
