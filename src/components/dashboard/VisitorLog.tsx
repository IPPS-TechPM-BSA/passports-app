import { useState, useEffect, useCallback, useRef } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import type { FormQuestion } from '../../services/api'
import ConfirmDialog from '../shared/ConfirmDialog'
import DeletePopup from '../shared/DeletePopup'
import Pager from '../shared/Pager'
import { useColumnResize } from '../../hooks/useColumnResize'
import { pacificToday } from '../../services/pacificDate'
import type { ColumnWidths } from '../../hooks/useColumnResize'

const COL_WIDTHS_STORAGE_KEY = 'visitorLog.colWidths'

// Notes has no default width: it takes whatever room the other columns leave,
// so the table fits the page without horizontal scrolling. It only gets a
// fixed width once someone drags its edge.
const DEFAULT_COL_WIDTHS: ColumnWidths = {
  visitor: 160, service: 95, photoType: 95, partySize: 90, docs: 150, signedIn: 110, signedOut: 90,
}
const PAGE_SIZE = 25

const CHECKBOX_COL_WIDTH = 36
const NOTES_MIN_WIDTH = 140

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
    case 'photo-only': return 'Photo'
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

// The kiosk stores a visitor who picked both photo types as "both".
function photoFormatKeys(format: string | null): string[] {
  if (!format) return []
  return format === 'both' ? ['digital', 'printed'] : [format]
}

// YYYY-MM-DD Pacific days, both inclusive; an empty side is open-ended.
interface DateRange {
  start: string
  end: string
}

// Sentinel anchor for the delete popup when the header "select all" box was used.
const SELECT_ALL_ANCHOR = '__all__'

// Short chip labels for the original checklist questions. Questions staff add
// later fall back to their title, or to the stored key once deleted.
const DOC_LABELS: Record<string, string> = {
  photo: 'Photo', citizenship: 'Citiz', id: 'ID', payment: 'Pay',
}

export default function VisitorLog() {
  const { auth, currentLanguage } = useApp()
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [search, setSearch] = useState('')
  // null means "follow today", so a dashboard left open overnight rolls over
  // to the new day instead of staying on yesterday. Other dates stay put.
  const [pickedRange, setPickedRange] = useState<DateRange | null>(null)
  const today = pacificToday()
  const range = pickedRange ?? { start: today, end: today }
  const { start: rangeStart, end: rangeEnd } = range
  const rangeInvalid = rangeStart !== '' && rangeEnd !== '' && rangeStart > rangeEnd
  // Newer requests win: a slow response for an old range must not replace a
  // newer one (a long range can easily outlast a later one-day load).
  const latestRequest = useRef(0)
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const { widths: colWidths, resizeHandle } = useColumnResize(COL_WIDTHS_STORAGE_KEY, DEFAULT_COL_WIDTHS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [popupAnchor, setPopupAnchor] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [questions, setQuestions] = useState<FormQuestion[]>([])
  const locId = auth?.locationId || 'csc'
  const lang = currentLanguage

  const fetchVisitors = useCallback(async (showLoading = false) => {
    if (!auth || rangeInvalid) return
    const request = ++latestRequest.current
    if (showLoading) setLoading(true)
    try {
      const params = new URLSearchParams({ location: locId })
      if (rangeStart) params.set('start', rangeStart)
      if (rangeEnd) params.set('end', rangeEnd)
      if (search) params.set('search', search)
      const res = await fetch(`/api/visitors?${params}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (res.ok) {
        const data: Visitor[] = await res.json()
        if (request !== latestRequest.current) return
        setVisitors(data)
        setSelected(prev => {
          const visibleIds = new Set(data.map(v => v.id))
          const pruned = new Set([...prev].filter(id => visibleIds.has(id)))
          return pruned.size === prev.size ? prev : pruned
        })
      }
    } catch { /* ignore */ }
    // Whichever request is newest ends the loading state: a background refresh
    // can overtake the request that turned it on.
    finally { if (request === latestRequest.current) setLoading(false) }
  }, [auth, locId, search, rangeStart, rangeEnd, rangeInvalid])

  useEffect(() => {
    fetchVisitors(true)
    const handler = () => fetchVisitors()
    window.addEventListener('visitor-update', handler)
    return () => window.removeEventListener('visitor-update', handler)
  }, [fetchVisitors])

  useEffect(() => {
    api.getQuestions().then(setQuestions).catch(() => { /* chips fall back to keys */ })
  }, [])

  // Chips for the answers a visitor actually gave, in the form's current
  // order, followed by answers to questions that have since been deleted.
  const docChips = (cl: Record<string, boolean | null>) => {
    const current = questions.filter(q => q.key in cl)
    const currentKeys = new Set(current.map(q => q.key))
    return [
      ...current.map(q => ({ key: q.key, label: DOC_LABELS[q.key] ?? q.title, title: q.title })),
      ...Object.keys(cl).filter(key => !currentKeys.has(key)).map(key => {
        const label = DOC_LABELS[key] ?? key.replace(/_/g, ' ')
        return { key, label, title: label }
      }),
    ]
  }

  const signOut = async (id: string) => {
    if (!auth) return
    await fetch(`/api/visitors/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ status: 'Signed Out' }),
    })
    fetchVisitors()
  }

  const undoSignOut = async (id: string) => {
    if (!auth) return
    await fetch(`/api/visitors/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ status: 'Checked In' }),
    })
    fetchVisitors()
  }

  const toggleSelected = (id: string) => {
    if (!selected.has(id)) setPopupAnchor(id)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Clamped rather than stored, so deleting the last rows of the final page
  // (or a poll returning fewer visitors) falls back to the new last page.
  const pageCount = Math.max(1, Math.ceil(visitors.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageVisitors = visitors.slice(pageStart, pageStart + PAGE_SIZE)

  // A new range starts on page 1 with nothing selected, so a delete can never
  // reach rows from the previous range.
  const showRange = (next: DateRange) => {
    // Picking today again follows today again.
    setPickedRange(next.start === today && next.end === today ? null : next)
    setPage(1)
    setSelected(new Set())
    setExportFailed(false)
  }

  const setRangeDay = (field: keyof DateRange, value: string) =>
    showRange({ ...range, [field]: value })

  // Selection is cleared on a page change so a delete can only ever remove
  // rows that are on screen.
  const goToPage = (n: number) => {
    setPage(n)
    setSelected(new Set())
  }

  // "Select all" and the delete popup work on the page being shown.
  const visibleIds = pageVisitors.map(v => v.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selected.has(id))

  // The delete popup sits next to the most recently checked box; if that row is
  // no longer selected it falls back to the first selected row still visible.
  const activeAnchor = selected.size === 0
    ? null
    : popupAnchor === SELECT_ALL_ANCHOR || (popupAnchor !== null && selected.has(popupAnchor))
      ? popupAnchor
      : visibleIds.find(id => selected.has(id)) ?? SELECT_ALL_ANCHOR

  const deletePopup = (
    <DeletePopup
      label={t('visitorLog.deleteSelected', { count: selected.size }, lang)}
      onClick={() => setConfirmOpen(true)}
    />
  )

  const toggleSelectAll = () => {
    if (!allVisibleSelected) setPopupAnchor(SELECT_ALL_ANCHOR)
    setSelected(prev => {
      if (allVisibleSelected) {
        const hidden = new Set(prev)
        visibleIds.forEach(id => hidden.delete(id))
        return hidden
      }
      return new Set([...prev, ...visibleIds])
    })
  }

  const deleteSelected = async () => {
    if (!auth || selected.size === 0) return
    setDeleting(true)
    try {
      const res = await fetch('/api/visitors/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
        body: JSON.stringify({ ids: Array.from(selected) }),
      })
      // Whether it worked or another staff member deleted some of these rows
      // first (the server then deletes none and answers 404), show what is
      // left now rather than leaving the dialog stuck open.
      if (res.ok || res.status === 404) {
        setSelected(new Set())
        setConfirmOpen(false)
        await fetchVisitors()
      }
    } catch { /* network error: leave the dialog open so the user can retry */ }
    finally {
      setDeleting(false)
    }
  }

  const saveNotes = async (id: string, notes: string) => {
    if (!auth) return
    await fetch(`/api/visitors/${id}/notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify({ notes: notes.slice(0, 100) }),
    })
  }

  // Exports the date range being shown (not the search, which only narrows
  // what is on screen).
  const exportCSV = async () => {
    if (!auth || rangeInvalid || exporting) return
    setExporting(true)
    setExportFailed(false)
    try {
      const params = new URLSearchParams({ location: locId })
      if (rangeStart) params.set('start', rangeStart)
      if (rangeEnd) params.set('end', rangeEnd)
      const res = await fetch(`/api/visitors/export?${params}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      const blob = await res.blob()
      // The server names the file after the range.
      const filename = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
        ?? `visitors_${locId}.csv`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      // Revoking straight after click() can cancel the download in Firefox.
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <h2 className="page-header" style={{ margin: 0, border: 'none' }}>{t('visitorLog.title', undefined, lang)}</h2>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', margin: '0.25rem 0 1.5rem' }}>
        <h3 style={{ margin: 0, fontFamily: 'Teko-SemiBold, sans-serif', fontWeight: 500, fontSize: 28, letterSpacing: '0.5px', color: '#182B49' }}>
          {t('visitorLog.totalRecords', { count: loading || rangeInvalid ? '—' : visitors.length }, lang)}
        </h3>
        {/* Decorator 5 gives every .btn a bottom margin and uppercase text;
            both are reset so the button centres on the subtitle line and
            reads "Export". */}
        <button className="btn btn-primary" style={{
          padding: '6px 18px', minWidth: 0, margin: 0,
          textTransform: 'none', letterSpacing: 'normal',
        }} onClick={exportCSV} disabled={exporting || rangeInvalid}>
          {t(exporting ? 'visitorLog.exporting' : 'visitorLog.export', undefined, lang)}
        </button>
      </div>
      {exportFailed && (
        <p className="text-danger" role="alert" style={{ margin: '-0.75rem 0 1rem', textAlign: 'right' }}>
          {t('visitorLog.exportFailed', undefined, lang)}
        </p>
      )}

      <div className="panel panel-default" style={{ background: '#f8f8f8', marginBottom: '1.5rem' }}>
        {/* The flex row is a child of .panel-body, not the body itself:
            Bootstrap's clearfix pseudo-elements on .panel-body would become
            flex items and push the controls in from the corners. */}
        <div className="panel-body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label htmlFor="visitor-log-start" style={{ margin: 0, fontWeight: 400 }}>{t('visitorLog.from', undefined, lang)}</label>
              <input id="visitor-log-start" type="date" className="form-control" style={{ width: 'auto' }}
                value={range.start} max={range.end || today}
                onChange={e => setRangeDay('start', e.target.value)} />
              <label htmlFor="visitor-log-end" style={{ margin: 0, fontWeight: 400 }}>{t('visitorLog.to', undefined, lang)}</label>
              <input id="visitor-log-end" type="date" className="form-control" style={{ width: 'auto' }}
                value={range.end} min={range.start || undefined} max={today}
                onChange={e => setRangeDay('end', e.target.value)} />
            </div>
            <div style={{ position: 'relative', flex: '0 1 270px', marginLeft: 'auto' }}>
              <span className="glyphicon glyphicon-search" aria-hidden="true" style={{
                position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
                color: '#999', pointerEvents: 'none',
              }}></span>
              <input type="text" className="form-control" placeholder={t('visitorLog.search', undefined, lang)}
                aria-label={t('visitorLog.search', undefined, lang)}
                style={{ paddingLeft: 32 }}
                value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} />
            </div>
        </div>
        {rangeInvalid && (
          <p className="text-danger" role="alert" style={{ margin: '0.75rem 0 0' }}>
            {t('visitorLog.rangeInvalid', undefined, lang)}
          </p>
        )}
        </div>
      </div>

      <div className="panel panel-default" style={{ overflowX: 'auto' }}>
        <table className="table table-striped table-hover" style={{
          margin: 0, fontSize: '0.85rem', tableLayout: 'fixed',
          // While Notes is flexible, stop it collapsing on a narrow window.
          minWidth: colWidths.notes === undefined
            ? CHECKBOX_COL_WIDTH + NOTES_MIN_WIDTH + Object.values(colWidths).reduce<number>((sum, w) => sum + (w ?? 0), 0)
            : undefined,
        }}>
          <thead>
            <tr>
              <th style={{ width: CHECKBOX_COL_WIDTH, textAlign: 'center', position: 'relative' }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  aria-label={t('visitorLog.selectAll', undefined, lang)}
                  title={t('visitorLog.selectAll', undefined, lang)}
                />
                {activeAnchor === SELECT_ALL_ANCHOR && deletePopup}
              </th>
              {[
                { key: 'visitor', label: t('visitorLog.colVisitor', undefined, lang) },
                { key: 'service', label: t('visitorLog.colService', undefined, lang) },
                { key: 'photoType', label: t('visitorLog.colPhotoType', undefined, lang) },
                { key: 'partySize', label: t('visitorLog.colPartySize', undefined, lang) },
                { key: 'docs', label: 'Docs' },
                { key: 'notes', label: t('visitorLog.colNotes', undefined, lang) },
                { key: 'signedIn', label: t('visitorLog.colStatus', undefined, lang) },
                { key: 'signedOut', label: t('visitorLog.colAction', undefined, lang) },
              ].map(col => (
                <th key={col.key} style={{ width: colWidths[col.key], textAlign: 'left', position: 'relative' }}>
                  {col.label}
                  {resizeHandle(col.key, t('visitorLog.resizeColumn', undefined, lang))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rangeInvalid ? (
              // The error itself is shown under the date inputs.
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>—</td></tr>
            ) : loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>{t('visitorLog.loading', undefined, lang)}</td></tr>
            ) : visitors.length === 0 ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '3rem', color: '#999' }}>{t('visitorLog.noRecords', undefined, lang)}</td></tr>
            ) : pageVisitors.map(v => {
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
              // Several services are stored comma-separated; none means a
              // Questions / Returning visit, which still gets one badge.
              const services: (string | null)[] = v.service_type ? v.service_type.split(',') : [null]
              const isPass = services.includes('passports')
              const photoFormats = photoFormatKeys(v.photo_format)

              return (
                <tr key={v.id}>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle', position: 'relative' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(v.id)}
                      onChange={() => toggleSelected(v.id)}
                      aria-label={t('visitorLog.selectVisitor', undefined, lang)}
                    />
                    {activeAnchor === v.id && deletePopup}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', textAlign: 'center', verticalAlign: 'middle' }}>
                    <strong>{v.first_name} {v.last_name}</strong>
                    <div style={{ fontSize: '0.75rem', color: '#6B7C96', lineHeight: 1.3 }}>
                      <div>{v.phone}</div>
                      {v.email && <div>{v.email}</div>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
                      {services.map(service => (
                        <span key={service ?? 'none'} className="label" style={{
                          display: 'inline-block', padding: '.15em .4em', lineHeight: 1.2, whiteSpace: 'normal',
                          fontSize: '0.75rem', background: serviceColor(service), color: '#fff',
                        }}>
                          {serviceLabel(service)}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {photoFormats.length > 0 ? (
                      photoFormats.map(format => <div key={format}>{t(`photo.${format}`, undefined, lang)}</div>)
                    ) : (
                      <span style={{ color: '#ccc', fontSize: '0.75rem' }}>N/A</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {v.party_size ?? '—'}
                  </td>
                  <td style={{ textAlign: 'center', verticalAlign: 'middle' }}>
                    {isPass ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 6px', justifyContent: 'center' }}>
                        {[
                          { key: 'app_complete', label: 'App', title: 'App', ok: v.app_complete },
                          ...docChips(cl).map(chip => ({ ...chip, ok: (cl[chip.key] ?? null) as boolean | null })),
                        ].map(({ key, label, title, ok }) => (
                          <span key={key} title={title} style={{
                            display: 'inline-flex',
                            gap: 3,
                            maxWidth: '100%',
                            fontSize: '0.7rem',
                            padding: '1px 4px',
                            borderRadius: 3,
                            background: ok === true ? '#dff0d8' : ok === false ? '#f2dede' : '#f5f5f5',
                            color: ok === true ? '#3c763d' : ok === false ? '#a94442' : '#999',
                            whiteSpace: 'nowrap',
                          }}>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                            <span>{ok === true ? '✓' : ok === false ? '✗' : '—'}</span>
                          </span>
                        ))}
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
                        <button
                          className="btn btn-link"
                          style={{ padding: 0, fontSize: '0.75rem', fontWeight: 700 }}
                          onClick={() => undoSignOut(v.id)}
                        >
                          {t('visitorLog.undo', undefined, lang)}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!loading && !rangeInvalid && visitors.length > 0 && (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          onPage={goToPage}
          summary={t('visitorLog.showing', {
            from: pageStart + 1,
            to: pageStart + pageVisitors.length,
            total: visitors.length,
          }, lang)}
          prevLabel={t('visitorLog.prevPage', undefined, lang)}
          nextLabel={t('visitorLog.nextPage', undefined, lang)}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('visitorLog.confirmDeleteTitle', undefined, lang)}
        message={t('visitorLog.confirmDelete', { count: selected.size }, lang)}
        confirmLabel={t('visitorLog.deleteSelected', { count: selected.size }, lang)}
        cancelLabel={t('visitorLog.cancel', undefined, lang)}
        danger
        busy={deleting}
        onConfirm={deleteSelected}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}
