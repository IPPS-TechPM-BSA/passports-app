import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { formatPhoneDisplay } from '../../utils/phone'

interface Subscriber {
  first_name: string
  last_name: string
  email: string | null
  phone: string
  check_in_at: string
}

export default function SubscriberList() {
  const { auth, currentLanguage } = useApp()
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [loading, setLoading] = useState(true)
  const locId = auth?.locationId || 'csc'
  const lang = currentLanguage

  const fetchAll = useCallback(async () => {
    if (!auth) return
    setLoading(true)
    try {
      const res = await fetch(`/api/visitors?location=${locId}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (res.ok) {
        const all: any[] = await res.json()
        setSubscribers(all)
      }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [auth, locId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const escapeCsvFormulaCell = (value: string) =>
    /^[=+\-@\t\r\n＝＋－＠]/.test(value) ? `'${value}` : value

  const csvCell = (value: string) =>
    `"${escapeCsvFormulaCell(value).replace(/"/g, '""')}"`

  const exportCSV = () => {
    const header = `${t('subscribers.colName', undefined, lang)},${t('subscribers.colEmail', undefined, lang)},${t('subscribers.colPhone', undefined, lang)},${t('subscribers.colOptIn', undefined, lang)}\n`
    const rows = subscribers.map(s =>
      [
        csvCell(`${s.first_name} ${s.last_name}`),
        csvCell(s.email || ''),
        csvCell(formatPhoneDisplay(s.phone)),
        csvCell(new Date(s.check_in_at).toLocaleDateString()),
      ].join(',')
    ).join('\n')
    const blob = new Blob([header + rows], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `subscribers_${locId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <p style={{ color: '#999' }}>{t('visitorLog.loading', undefined, lang)}</p>

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 className="page-header" style={{ margin: 0, border: 'none' }}>{t('subscribers.title', undefined, lang)}</h2>
        <button className="btn btn-primary" onClick={exportCSV} disabled={subscribers.length === 0}>
          <span className="glyphicon glyphicon-download-alt" style={{ marginRight: 6 }}></span>
          {t('subscribers.export', undefined, lang)}
        </button>
      </div>

      <div className="table-responsive">
        <table className="table table-striped">
          <thead>
            <tr>
              <th>{t('subscribers.colName', undefined, lang)}</th>
              <th>{t('subscribers.colEmail', undefined, lang)}</th>
              <th>{t('subscribers.colPhone', undefined, lang)}</th>
              <th>{t('subscribers.colOptIn', undefined, lang)}</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>{t('subscribers.noRecords', undefined, lang)}</td></tr>
            ) : subscribers.map((s, i) => (
              <tr key={i}>
                <td><strong>{s.first_name} {s.last_name}</strong></td>
                <td>{s.email ? <code>{s.email}</code> : <span style={{ color: '#ccc' }}>—</span>}</td>
                <td>{formatPhoneDisplay(s.phone)}</td>
                <td>{new Date(s.check_in_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
