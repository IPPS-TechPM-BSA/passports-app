import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'

export default function LoginPage() {
  const navigate = useNavigate()
  const { currentLanguage, login } = useApp()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const lang = currentLanguage

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api.login(password) as { token: string; location_id: string }
      login(result.token, result.location_id as 'csc' | 'bookstore')
      navigate('/dashboard/visitor-log')
    } catch {
      setError(t('login.invalid', undefined, lang))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="layout-main" id="main-content" role="main">
      <div className="container" style={{ paddingTop: '3rem', paddingBottom: '4rem' }}>
        <div className="row">
          <div className="col-sm-6 col-sm-offset-3">
            <div className="panel panel-primary">
              <div className="panel-heading">
                <h3 className="panel-title">{t('login.title', undefined, lang)}</h3>
              </div>
              <div className="panel-body">
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label className="control-label" htmlFor="password">{t('login.password', undefined, lang)}</label>
                    <input type="password" id="password"
                      className="form-control input-lg"
                      placeholder={t('login.placeholder', undefined, lang)}
                      value={password} onChange={e => setPassword(e.target.value)}
                      autoFocus />
                  </div>

                  {error && (
                    <div className="alert alert-danger" role="alert">
                      <span className="glyphicon glyphicon-exclamation-sign" style={{ marginRight: 6 }}></span>
                      {error}
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary btn-lg btn-block"
                    disabled={loading || !password}>
                    {loading ? t('login.signingIn', undefined, lang) : t('login.signIn', undefined, lang)}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
