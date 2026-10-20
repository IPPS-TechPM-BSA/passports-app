import { useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { pacificToday, shiftDay } from '../../services/pacificDate'

interface Stats {
  total: number
  passports_count: number
  notary_count: number
  photo_only_count: number
  prep_rate: number
  walk_in_percent: number
  incomplete_app_count: number
  missing_photo_count: number
  missing_citizenship_count: number
  missing_id_count: number
  missing_payment_count: number
}

// YYYY-MM-DD Pacific days, both inclusive; an empty end means "up to now".
interface DateRange {
  start: string
  end: string
}

type Preset = 'all' | 'today' | 'week' | 'month' | 'custom'

const presetRange = (preset: Exclude<Preset, 'custom'>): DateRange => {
  const today = pacificToday()
  switch (preset) {
    case 'today': return { start: today, end: today }
    case 'week': return { start: shiftDay(today, -6), end: today }
    case 'month': return { start: shiftDay(today, -29), end: today }
    default: return { start: '', end: '' }
  }
}

const PRESETS: { key: Exclude<Preset, 'custom'>; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'Last 30 Days' },
]

// How each figure is worked out, shown when staff hover over (or tab to) it.
const DESCRIPTIONS = {
  total: 'Every check-in at this location in the selected dates, whatever the service.',
  prepRate: 'Of the passport visits in the selected dates, the share that did not answer "No" to "Is your passport application complete?". (Passport visits − incomplete applications) ÷ passport visits, as a percentage.',
  walkIn: 'Of all check-ins in the selected dates, the share where the visitor chose Walk-In rather than Appointment.',
  passports: 'Check-ins that included the Passport service. A visitor who picked several services is counted once under each, so these bars can add up to more than Total Visits.',
  notary: 'Check-ins that included the Notary service. A visitor who picked several services is counted once under each.',
  photo: 'Check-ins that included the Photo service. A visitor who picked several services is counted once under each.',
  incomplete: 'Passport visits that answered "No" to "Is your passport application complete?".',
  missing: (item: string) => `Passport visits that answered "No" to the ${item} question on the document checklist.`,
}

/**
 * Shows `text` in a dark tooltip above its content on hover or keyboard focus.
 * The wrapped content is focusable so the explanation is reachable without a
 * mouse.
 */
function InfoTip({ text, children }: { text: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      style={{ position: 'relative', cursor: 'help' }}
      tabIndex={0}
      aria-label={text}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && (
        <div role="tooltip" style={{
          position: 'absolute', left: '50%', bottom: 'calc(100% + 8px)', transform: 'translateX(-50%)',
          zIndex: 20, width: 'max-content', maxWidth: 320, padding: '8px 12px', borderRadius: 4,
          background: '#182B49', color: '#fff', fontSize: '0.8rem', fontWeight: 400, lineHeight: 1.4,
          textAlign: 'left', boxShadow: '0 2px 8px rgba(0,0,0,0.25)', pointerEvents: 'none',
        }}>
          {text}
        </div>
      )}
    </div>
  )
}

function Bar({ value, max, color, label, description }: {
  value: number; max: number; color: string; label: string; description: string
}) {
  return (
    <InfoTip text={description}>
      <div className="row" style={{ marginBottom: '0.75rem', alignItems: 'center' }}>
        <div className="col-sm-4" style={{ fontWeight: 500, fontSize: '0.9rem' }}>{label}</div>
        <div className="col-sm-6">
          <div className="progress" style={{ height: 24, margin: 0 }}>
            <div
              className="progress-bar"
              role="progressbar"
              style={{ width: `${(value / max) * 100}%`, background: color, lineHeight: '24px', fontSize: '0.85rem' }}
            >
              {value > 0 ? value : ''}
            </div>
          </div>
        </div>
        <div className="col-sm-2" style={{ fontWeight: 700, fontSize: '0.9rem' }}>{value}</div>
      </div>
    </InfoTip>
  )
}

function StatTile({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <InfoTip text={description}>
      <div className="panel panel-primary">
        <div className="panel-heading"><h3 className="panel-title">{title}</h3></div>
        <div className="panel-body text-center">
          <span style={{ fontSize: '2.5rem', fontWeight: 700 }}>{value}</span>
        </div>
      </div>
    </InfoTip>
  )
}

export default function Reports() {
  const { auth, currentLanguage } = useApp()
  const [stats, setStats] = useState<Stats | null>(null)
  const [preset, setPreset] = useState<Preset>('all')
  const [range, setRange] = useState<DateRange>({ start: '', end: '' })
  const locId = auth?.locationId || 'csc'
  const lang = currentLanguage
  const today = pacificToday()
  const rangeInvalid = range.start !== '' && range.end !== '' && range.start > range.end

  const fetchStats = useCallback(async () => {
    if (!auth || rangeInvalid) return
    try {
      const params = new URLSearchParams({ location: locId })
      if (range.start) params.set('start', range.start)
      if (range.end) params.set('end', range.end)
      const res = await fetch(`/api/stats?${params}`, {
        headers: { Authorization: `Bearer ${auth.token}` },
      })
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
  }, [auth, locId, range.start, range.end, rangeInvalid])

  useEffect(() => {
    fetchStats()
    const handler = () => fetchStats()
    window.addEventListener('visitor-update', handler)
    return () => window.removeEventListener('visitor-update', handler)
  }, [fetchStats])

  const choosePreset = (key: Exclude<Preset, 'custom'>) => {
    setPreset(key)
    setRange(presetRange(key))
  }

  const setRangeDay = (field: keyof DateRange, value: string) => {
    setPreset('custom')
    setRange(prev => ({ ...prev, [field]: value }))
  }

  if (!stats) return <p style={{ color: '#999' }}>{t('visitorLog.loading', undefined, lang)}</p>

  const barColor = '#00629B'

  const maxService = Math.max(stats.passports_count, stats.notary_count, stats.photo_only_count, 1)
  const maxMissing = Math.max(stats.missing_photo_count, stats.missing_citizenship_count, stats.missing_id_count, stats.missing_payment_count, stats.incomplete_app_count, 1)

  // Decorator 5's .btn is sized for large CTAs; keep these compact.
  const presetBtnStyle = (active: boolean) => ({
    padding: '4px 12px', minWidth: 0, margin: 0, textTransform: 'none' as const, letterSpacing: 'normal',
    fontWeight: active ? 700 : 400,
    ...(active ? { background: '#00629B', borderColor: '#00629B', color: '#fff' } : {}),
  })

  return (
    <>
      <h2 className="page-header" style={{ margin: '0 0 1.5rem', border: 'none' }}>{t('reports.title', undefined, lang)}</h2>

      <div className="panel panel-default" style={{ background: '#f8f8f8', marginBottom: '1.5rem' }}>
        <div className="panel-body">
          {/* Its own flex row: Bootstrap's clearfix pseudo-elements on
              .panel-body would otherwise become flex items. */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div className="btn-group" role="group" aria-label="Date range">
              {PRESETS.map(p => (
                <button key={p.key} type="button" className="btn btn-default" aria-pressed={preset === p.key}
                  style={presetBtnStyle(preset === p.key)} onClick={() => choosePreset(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <label htmlFor="report-start" style={{ margin: 0, fontWeight: 400 }}>From</label>
              <input id="report-start" type="date" className="form-control" style={{ width: 'auto' }}
                value={range.start} max={range.end || today}
                onChange={e => setRangeDay('start', e.target.value)} />
              <label htmlFor="report-end" style={{ margin: 0, fontWeight: 400 }}>To</label>
              <input id="report-end" type="date" className="form-control" style={{ width: 'auto' }}
                value={range.end} min={range.start || undefined} max={today}
                onChange={e => setRangeDay('end', e.target.value)} />
            </div>
          </div>
          {rangeInvalid && (
            <p className="text-danger" style={{ margin: '0.75rem 0 0' }}>
              The From date must be on or before the To date.
            </p>
          )}
        </div>
      </div>

      <div className="row" style={{ marginBottom: '2rem' }}>
        <div className="col-sm-4">
          <StatTile title={t('reports.totalVisits', undefined, lang)} value={String(stats.total)} description={DESCRIPTIONS.total} />
        </div>
        <div className="col-sm-4">
          <StatTile title={t('reports.preparationRate', undefined, lang)} value={`${stats.prep_rate}%`} description={DESCRIPTIONS.prepRate} />
        </div>
        <div className="col-sm-4">
          <StatTile title={t('reports.walkinRatio', undefined, lang)} value={`${stats.walk_in_percent}%`} description={DESCRIPTIONS.walkIn} />
        </div>
      </div>

      <div className="panel panel-default">
        <div className="panel-heading"><h3 className="panel-title">{t('reports.byService', undefined, lang)}</h3></div>
        <div className="panel-body">
          <Bar value={stats.passports_count} max={maxService} color={barColor} label="Passports" description={DESCRIPTIONS.passports} />
          <Bar value={stats.notary_count} max={maxService} color={barColor} label="Notary" description={DESCRIPTIONS.notary} />
          <Bar value={stats.photo_only_count} max={maxService} color={barColor} label="Photo" description={DESCRIPTIONS.photo} />
        </div>
      </div>

      <div className="panel panel-default">
        <div className="panel-heading"><h3 className="panel-title">{t('reports.documentIssues', undefined, lang)}</h3></div>
        <div className="panel-body">
          <p style={{ color: '#6B7C96', fontSize: '0.85rem' }}>
            {t('reports.among', { count: stats.passports_count }, lang)}
          </p>
          <Bar value={stats.incomplete_app_count} max={maxMissing} color={barColor} label="Incomplete Application" description={DESCRIPTIONS.incomplete} />
          <Bar value={stats.missing_photo_count} max={maxMissing} color={barColor} label="Missing Photo" description={DESCRIPTIONS.missing('Passport Photo')} />
          <Bar value={stats.missing_citizenship_count} max={maxMissing} color={barColor} label="Missing Citizenship" description={DESCRIPTIONS.missing('Proof of Citizenship')} />
          <Bar value={stats.missing_id_count} max={maxMissing} color={barColor} label="Missing ID" description={DESCRIPTIONS.missing('Photo Identification')} />
          <Bar value={stats.missing_payment_count} max={maxMissing} color={barColor} label="Missing Payment" description={DESCRIPTIONS.missing('Form of Payment')} />
        </div>
      </div>
    </>
  )
}
