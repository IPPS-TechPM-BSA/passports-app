import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { formatPhoneDisplay } from '../../utils/phone'

const COL_WIDTHS_STORAGE_KEY = 'visitorLog.colWidths'

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  visitor: 160, service: 110, partySize: 90, docs: 150, notes: 260, signedIn: 110, signedOut: 90,
}

function loadColWidths(): Record<string, number> {
  try {
    const saved = localStorage.getItem(COL_WIDTHS_STORAGE_KEY)
    if (saved) return { ...DEFAULT_COL_WIDTHS, ...JSON.parse(saved) }
  } catch { /* ignore */ }
  return DEFAULT_COL_WIDTHS
}

interface Visitor {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string
  party_size: number | null
  visit_type: string
  service_type: string | null
  photo_format: string | null
  app_complete: boolean | null
  checklist: string | null
  notes: string
  status: string
  check_in_at: string
  sign_out_at: string | null
}

function serviceLabel(s: string | null): string {
  switch (s) {
    case 'passports': return 'Passports'
    case 'notary': return 'Notary'
    case 'photo-only': return 'Photo Only'
    default: return 'Questions / Returning'
  }
}

// UCSD brand colors already used elsewhere in the app (Diego Blue, Navy, gray),
// extended with a gold accent so each service type reads as a distinct color.
function serviceColor(s: string | null): string {
  switch (s) {
    case 'passports': return '#00629B'
    case 'notary': return '#182B49'
    case 'photo-only': return '#B8860B'
    default: return '#6B7C96'
  }
}

const DOC_LABELS: Record<string, string> = {
  photo: 'Photo', citizenship: 'Citiz', id: 'ID', payment: 'Pay',
}

export default function VisitorLog() {
  const { auth, currentLanguage } = useApp()
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [search, setSearch] = useState('')
  const [filterDate, setFilterDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [colWidths, setColWidths] = useState<Record<string, number>>(loadColWidths)
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)
  const locId = auth?.locationId || 'csc'
  const lang = currentLanguage

  const handleResizeMove = useCallback((e: MouseEvent) => {
    const r = resizingRef.current
    if (!r) return
    const newWidth = Math.max(50, r.startWidth + (e.clientX - r.startX))
    setColWidths(prev => ({ ...prev, [r.key]: newWidth }))
  }, [])

  const handleResizeEnd = useCallback(() => {
    resizingRef.current = null
    window.removeEventListener('mousemove', handleResizeMove)
    window.removeEventListener('mouseup', handleResizeEnd)
    setColWidths(prev => {
      localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify(prev))
      return prev
    })
  }, [handleResizeMove])

  const handleResizeStart = useCallback((key: string, e: React.MouseEvent) => {
    e.preventDefault()
    resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] }
    window.addEventListener('mousemove', handleResizeMove)
    window.addEventListener('mouseup', handleResizeEnd)
  }, [colWidths, handleResizeMove, handleResizeEnd])

  const fetchVisitors = useCallback(async (showLoading = false) => {
    if (!auth) return
    if (showLoading) setLoading(true)
    try {
      const params = new URLSearchParams({ location: locId })
      if (filterDate) params.set('date', filterDate)
      if (search) params.set('search', search)
      const res = await fetch(`/api/visitors?${params}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (res.ok) setVisitors(await res.json())
    } catch { /* ignore */ }
    finally { if (showLoading) setLoading(false) }
  }, [auth, locId, search, filterDate])

  useEffect(() => {
    fetchVisitors(true)
    const handler = () => fetchVisitors()
    window.addEventListener('visitor-update', handler)
    return () => window.removeEventListener('visitor-update', handler)
  }, [fetchVisitors])

  const signOut = async (id: string) => {
    if (!auth) return
    await fetch(`/api/visitors/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ status: 'Signed Out' }),
    })
    fetchVisitors()
  }

  const saveNotes = async (id: string, notes: string) => {
    if (!auth) return
    await fetch(`/api/visitors/${id}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ notes: notes.slice(0, 100) }),
    })
  }

  const exportCSV = async () => {
    if (!auth) return
    const res = await fetch(`/api/visitors/export?location=${locId}`, {
      headers: { Authorization: `Bearer ${auth.token}` },
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `visitors_${locId}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <h2 className="page-header" style={{ margin: 0, border: 'none' }}>{t('visitorLog.title', undefined, lang)}</h2>
        <button className="btn btn-primary" onClick={exportCSV}>
          <span className="glyphicon glyphicon-download-alt" style={{ marginRight: 6 }}></span>
          {t('visitorLog.export', undefined, lang)}
        </button>
      </div>

      <div className="panel panel-default" style={{ background: '#f8f8f8', marginBottom: '1.5rem' }}>
        <div className="panel-body">
          <div className="row">
            <div className="col-sm-5">
              <input type="text" className="form-control" placeholder={t('visitorLog.search', undefined, lang)}
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="col-sm-3">
              <input type="date" className="form-control" value={filterDate}
                onChange={e => setFilterDate(e.target.value)} />
            </div>
            <div className="col-sm-2">
              <button className="btn btn-default btn-block" onClick={() => { setSearch(''); setFilterDate('') }}>
                {t('visitorLog.clear', undefined, lang)}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="panel panel-default" style={{ overflowX: 'auto' }}>
        <table className="table table-striped table-hover" style={{ margin: 0, fontSize: '0.85rem', tableLayout: 'fixed' }}>
          <thead>
            <tr>
              {[
                { key: 'visitor', label: t('visitorLog.colVisitor', undefined, lang) },
                { key: 'service', label: t('visitorLog.colService', undefined, lang) },
                { key: 'partySize', label: t('visitorLog.colPartySize', undefined, lang) },
                { key: 'docs', label: 'Docs' },
                { key: 'notes', label: t('visitorLog.colNotes', undefined, lang) },
                { key: 'signedIn', label: t('visitorLog.colStatus', undefined, lang) },
                { key: 'signedOut', label: t('visitorLog.colAction', undefined, lang) },
              ].map(col => (
                <th key={col.key} style={{ width: colWidths[col.key], textAlign: 'left', position: 'relative' }}>
                  {col.label}
                  <span
                    onMouseDown={e => handleResizeStart(col.key, e)}
                    style={{
                      position: 'absolute', right: 0, top: 0, bottom: 0, width: 6,
                      cursor: 'col-resize', userSelect: 'none', borderRight: '2px solid transparent',
                    }}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>{t('visitorLog.loading', undefined, lang)}</td></tr>
            ) : visitors.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>{t('visitorLog.noRecords', undefined, lang)}</td></tr>
            ) : visitors.map(v => {
              const checkIn = new Date(v.check_in_at)
              const dateStr = checkIn.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })
              const timeStr = checkIn.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })
              const signOutDate = v.sign_out_at ? new Date(v.sign_out_at) : null
              const outStr = signOutDate
                ? signOutDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Los_Angeles' })
                : null
              const outDateStr = signOutDate
                ? signOutDate.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' })
                : null
              const cl = v.checklist ? JSON.parse(v.checklist) : {}
              const isPass = v.service_type === 'passports'

              return (
                <tr key={v.id}>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                    <strong>{v.first_name} {v.last_name}</strong>
                    <div style={{ fontSize: '0.75rem', color: '#6B7C96', lineHeight: 1.3 }}>
                      <div>{formatPhoneDisplay(v.phone)}</div>
                      {v.email && <div>{v.email}</div>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    <span className="label" style={{ fontSize: '0.75rem', background: serviceColor(v.service_type), color: '#fff' }}>
                      {serviceLabel(v.service_type)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {v.party_size ?? '—'}
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {isPass ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', justifyContent: 'center' }}>
                        {['app_complete', 'photo', 'citizenship', 'id', 'payment'].map(f => {
                          let ok: boolean | null
                          if (f === 'app_complete') { ok = v.app_complete }
                          else { ok = cl[f] ?? null }
                          const label = f === 'app_complete' ? 'App' : DOC_LABELS[f]
                          return (
                            <span key={f} style={{
                              fontSize: '0.7rem',
                              padding: '1px 4px',
                              borderRadius: 3,
                              background: ok === true ? '#dff0d8' : ok === false ? '#f2dede' : '#f5f5f5',
                              color: ok === true ? '#3c763d' : ok === false ? '#a94442' : '#999',
                              whiteSpace: 'nowrap',
                            }}>
                              {label} {ok === true ? '✓' : ok === false ? '✗' : '—'}
                            </span>
                          )
                        })}
                      </div>
                    ) : (
                      <span style={{ color: '#ccc', fontSize: '0.75rem' }}>N/A</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    <textarea className="form-control input-sm"
                      style={{ width: '100%', minWidth: 140, fontSize: '0.75rem', resize: 'vertical' }}
                      rows={2}
                      defaultValue={v.notes || ''} maxLength={100} placeholder="..."
                      onBlur={e => saveNotes(v.id, e.target.value)} />
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ fontSize: '0.75rem', color: '#6B7C96' }}>{timeStr}</div>
                    <div style={{ fontSize: '0.75rem', color: '#6B7C96' }}>{dateStr}</div>
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {v.status === 'Checked In' ? (
                      <button className="btn" style={{
                        fontSize: '0.75rem', padding: '.2em .6em .3em', lineHeight: 1, whiteSpace: 'nowrap',
                        minWidth: 0, fontWeight: 700, textTransform: 'none', letterSpacing: 'normal',
                        border: 'none', borderRadius: '.25em', background: '#00629B', color: '#fff',
                      }} onClick={() => signOut(v.id)}>
                        {t('visitorLog.signOut', undefined, lang)}
                      </button>
                    ) : (
                      <div style={{ fontSize: '0.75rem', color: '#6B7C96' }}>
                        <div>{outStr}</div>
                        <div>{outDateStr}</div>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
