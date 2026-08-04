import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useApp, type Language } from '../../context/AppContext'
import { t } from '../../services/translations'

const languages: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
]

export default function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const { currentLanguage, setLanguage, auth, logout } = useApp()
  const [langOpen, setLangOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const path = location.pathname
  const isDashboard = path.startsWith('/dashboard')
  const isKiosk = path.startsWith('/kiosk') || path.startsWith('/mobile')
  const isLogin = path === '/dashboard/login'
  const lang = currentLanguage

  const closeMobile = () => setMobileOpen(false)

  return (
    <nav className="navbar navbar-default navbar-static-top" role="navigation">
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
            {!isDashboard && !isKiosk && (
              <li className={path === '/' ? 'active' : ''}>
                <a href="/" onClick={e => { e.preventDefault(); navigate('/'); closeMobile() }}>
                  {t('nav.home', undefined, lang)}
                </a>
              </li>
            )}
            {isDashboard && auth && (
              <li>
                <a href="/" onClick={e => { e.preventDefault(); logout(); navigate('/'); closeMobile() }}>
                  {t('nav.lockDashboard', undefined, lang)}
                </a>
              </li>
            )}
            {isKiosk && (
              <li className="active">
                <a href="#">{t('nav.checkin', undefined, lang)}</a>
              </li>
            )}
          </ul>

          <ul className="nav navbar-nav navbar-right">
            {/* Employee Dashboard — always visible, with lock icon */}
            {!isDashboard && !isLogin && (
              <li>
                <a href="/dashboard/login" onClick={e => { e.preventDefault(); navigate('/dashboard/login'); closeMobile() }}>
                  <span className="glyphicon glyphicon-lock" style={{ marginRight: 6 }}></span>
                  {t('dashboard.link', undefined, lang)}
                </a>
              </li>
            )}
            <li className={`dropdown ${langOpen ? 'open' : ''}`}>
              <a href="#" className="dropdown-toggle" onClick={e => { e.preventDefault(); setLangOpen(o => !o) }}
                role="button" aria-haspopup="true" aria-expanded={langOpen}>
                {languages.find(l => l.code === currentLanguage)?.label || 'English'}
                <span className="caret" style={{ marginLeft: 4 }}></span>
              </a>
              <ul className="dropdown-menu" style={{ display: langOpen ? 'block' : 'none' }}>
                {languages.map(l => (
                  <li key={l.code} className={currentLanguage === l.code ? 'active' : ''}>
                    <a href="#" onClick={e => {
                      e.preventDefault()
                      setLanguage(l.code)
                      setLangOpen(false)
                    }}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </div>
      </div>
    </nav>
  )
}
