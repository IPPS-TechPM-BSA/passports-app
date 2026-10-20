import { useState, useEffect, useCallback } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import type { SurveyQuestion, SurveyResponseRecord } from '../../services/api'
import ConfirmDialog from '../shared/ConfirmDialog'
import DeletePopup from '../shared/DeletePopup'
import Pager from '../shared/Pager'
import { useColumnResize } from '../../hooks/useColumnResize'
import type { ColumnWidths } from '../../hooks/useColumnResize'

type Answer = SurveyResponseRecord['answers'][number]

const COL_WIDTHS_STORAGE_KEY = 'experienceLog.colWidths'

// Question columns have no default width: they share whatever room these
// leave, and their text wraps, so the table fits the page.
const DEFAULT_COL_WIDTHS: ColumnWidths = { name: 150, email: 200, submitted: 150 }
const PAGE_SIZE = 25
const CHECKBOX_COL_WIDTH = 36
const QUESTION_MIN_WIDTH = 120

// Sentinel anchor for the delete popup when the header "select all" box was used.
const SELECT_ALL_ANCHOR = '__all__'

const questionKey = (questionId: string) => `q:${questionId}`

const escapeCsvFormulaCell = (value: string) =>
  /^[=+\-@\t\r\n＝＋－＠]/.test(value) ? `'${value}` : value

const csvCell = (value: string) =>
  `"${escapeCsvFormulaCell(value).replace(/"/g, '""')}"`

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

export default function CustomerExperienceLog() {
  const { auth, currentLanguage } = useApp()
  const [responses, setResponses] = useState<SurveyResponseRecord[]>([])
  const [questions, setQuestions] = useState<SurveyQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const { widths: colWidths, resizeHandle } = useColumnResize(COL_WIDTHS_STORAGE_KEY, DEFAULT_COL_WIDTHS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [popupAnchor, setPopupAnchor] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const locId = auth?.locationId || 'csc'
  const lang = currentLanguage

  const fetchResponses = useCallback(async () => {
    if (!auth) return
    try {
      const [nextResponses, nextQuestions] = await Promise.all([
        api.getSurveyResponses(locId, auth.token),
        api.getSurveyQuestions().catch(() => [] as SurveyQuestion[]),
      ])
      setResponses(nextResponses)
      setQuestions(nextQuestions)
      setSelected(prev => {
        const ids = new Set(nextResponses.map(r => r.id))
        const pruned = new Set([...prev].filter(id => ids.has(id)))
        return pruned.size === prev.size ? prev : pruned
      })
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [auth, locId])

  useEffect(() => {
    fetchResponses()
    window.addEventListener('visitor-update', fetchResponses)
    return () => window.removeEventListener('visitor-update', fetchResponses)
  }, [fetchResponses])

  const answerValue = (answer: Answer) => {
    if (answer.value === null || answer.value === undefined || answer.value === '') return '—'
    if (Array.isArray(answer.value)) return answer.value.length ? answer.value.join(', ') : '—'
    if (answer.type === 'checkbox') return answer.value ? t('yes', undefined, lang) : t('no', undefined, lang)
    if (answer.type === 'rating') return `${answer.value} / 5`
    return String(answer.value)
  }

  // One column per question on the current form, in form order, headed with
  // its current wording. Answers are matched by question id, so renaming a
  // question keeps its answers; answers to removed questions are deleted when
  // the survey is saved, so they have no column.
  const cellValue = (response: SurveyResponseRecord, questionId: string) => {
    const answer = response.answers.find(a => a.question_id === questionId)
    return answer ? answerValue(answer) : '—'
  }

  const columns = [
    { key: 'name', label: t('survey.name', undefined, lang) },
    { key: 'email', label: t('survey.email', undefined, lang) },
    { key: 'submitted', label: t('survey.submitted', undefined, lang) },
    ...questions.map(question => ({ key: questionKey(question.id), label: question.label })),
  ]

  // Keep every still-flexible question column readable; past that the table
  // scrolls sideways instead of squeezing them further.
  const tableMinWidth = CHECKBOX_COL_WIDTH + columns.reduce(
    (sum, col) => sum + (colWidths[col.key] ?? QUESTION_MIN_WIDTH), 0)

  // Clamped rather than stored, so deleting the last rows of the final page
  // falls back to the new last page.
  const pageCount = Math.max(1, Math.ceil(responses.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const pageResponses = responses.slice(pageStart, pageStart + PAGE_SIZE)

  // Selection is cleared on a page change so a delete can only ever remove
  // rows that are on screen.
  const goToPage = (n: number) => {
    setPage(n)
    setSelected(new Set())
  }

  // "Select all" and the delete popup work on the page being shown.
  const visibleIds = pageResponses.map(r => r.id)
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

  const toggleSelected = (id: string) => {
    if (!selected.has(id)) setPopupAnchor(id)
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
      await api.deleteSurveyResponses(Array.from(selected), auth.token)
      setSelected(new Set())
      setConfirmOpen(false)
      await fetchResponses()
    } catch (err) {
      // Another staff member deleted some of these first: show what is left.
      if (String(err).startsWith('Error: 404')) {
        setSelected(new Set())
        setConfirmOpen(false)
        await fetchResponses()
      }
      // Otherwise leave the dialog open so the user can retry.
    }
    finally {
      setDeleting(false)
    }
  }

  const exportCSV = () => {
    const header = columns.map(col => csvCell(col.label)).join(',')
    const rows = responses.map(response =>
      [
        csvCell(response.name),
        csvCell(response.email),
        csvCell(formatDate(response.submitted_at)),
        ...questions.map(question => csvCell(cellValue(response, question.id))),
      ].join(',')
    )
    const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `customer_experience_${locId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const cellStyle = { textAlign: 'center' as const, verticalAlign: 'middle' as const, overflowWrap: 'anywhere' as const }
  const emptyRowStyle = { textAlign: 'center' as const, padding: '3rem', color: '#999' }

  return (
    <>
      <h2 className="page-header" style={{ margin: 0, border: 'none' }}>{t('nav.experienceLog', undefined, lang)}</h2>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', margin: '0.25rem 0 1.5rem' }}>
        <h3 style={{ margin: 0, fontFamily: 'Teko-SemiBold, sans-serif', fontWeight: 500, fontSize: 28, letterSpacing: '0.5px', color: '#182B49' }}>
          {t('experienceLog.count', { count: loading ? '—' : responses.length }, lang)}
        </h3>
        {/* Decorator 5 gives every .btn a bottom margin and uppercase text;
            both are reset so the button centres on the subtitle line and
            reads "Export". */}
        <button className="btn btn-primary" style={{
          padding: '6px 18px', minWidth: 0, margin: 0,
          textTransform: 'none', letterSpacing: 'normal',
        }} onClick={exportCSV} disabled={responses.length === 0}>
          {t('visitorLog.export', undefined, lang)}
        </button>
      </div>

      <div className="panel panel-default" style={{ overflowX: 'auto' }}>
        <table className="table table-striped table-hover" style={{
          margin: 0, fontSize: '0.85rem', tableLayout: 'fixed', minWidth: tableMinWidth,
        }}>
          <thead>
            <tr>
              <th style={{ width: CHECKBOX_COL_WIDTH, textAlign: 'center', position: 'relative' }}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  aria-label={t('experienceLog.selectAll', undefined, lang)}
                  title={t('experienceLog.selectAll', undefined, lang)}
                />
                {activeAnchor === SELECT_ALL_ANCHOR && deletePopup}
              </th>
              {columns.map(col => (
                <th key={col.key} style={{ width: colWidths[col.key], textAlign: 'left', position: 'relative', overflowWrap: 'anywhere' }}>
                  {col.label}
                  {resizeHandle(col.key, t('visitorLog.resizeColumn', undefined, lang))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + 1} style={emptyRowStyle}>{t('visitorLog.loading', undefined, lang)}</td></tr>
            ) : responses.length === 0 ? (
              <tr><td colSpan={columns.length + 1} style={emptyRowStyle}>{t('reports.noSurveyResponses', undefined, lang)}</td></tr>
            ) : pageResponses.map(response => (
              <tr key={response.id}>
                <td style={{ textAlign: 'center', verticalAlign: 'middle', position: 'relative' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(response.id)}
                    onChange={() => toggleSelected(response.id)}
                    aria-label={t('experienceLog.selectResponse', undefined, lang)}
                  />
                  {activeAnchor === response.id && deletePopup}
                </td>
                <td style={cellStyle}><strong>{response.name}</strong></td>
                <td style={cellStyle}>{response.email}</td>
                <td style={cellStyle}>
                  <div style={{ fontSize: '0.75rem', color: '#6B7C96' }}>{formatDate(response.submitted_at)}</div>
                </td>
                {questions.map(question => (
                  <td key={question.id} style={cellStyle}>{cellValue(response, question.id)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && responses.length > 0 && (
        <Pager
          page={currentPage}
          pageCount={pageCount}
          onPage={goToPage}
          summary={t('visitorLog.showing', {
            from: pageStart + 1,
            to: pageStart + pageResponses.length,
            total: responses.length,
          }, lang)}
          prevLabel={t('visitorLog.prevPage', undefined, lang)}
          nextLabel={t('visitorLog.nextPage', undefined, lang)}
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        title={t('experienceLog.confirmDeleteTitle', undefined, lang)}
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
