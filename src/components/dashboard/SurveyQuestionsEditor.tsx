import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import type { SurveyQuestion, SurveyQuestionInput } from '../../services/api'
import { useDragReorder } from '../../hooks/useDragReorder'
import ConfirmDialog from '../shared/ConfirmDialog'

type QuestionType = SurveyQuestionInput['question_type']

interface EditorQuestion {
  id: string
  question_type: QuestionType
  label: string
  required: boolean
  // The possible selections of a "select all that apply" question. Kept
  // while the type is switched away and back, but only saved for that type.
  options: string[]
}

const toEditor = (q: SurveyQuestion): EditorQuestion => ({
  id: q.id,
  question_type: q.type,
  label: q.label,
  required: q.required,
  options: q.options ?? [],
})

// Matches the server's limit.
const MAX_OPTIONS = 20

let nextId = 0
const makeId = () => `editor-${Date.now()}-${nextId++}`

// Locked rows that mirror the Name and Email fields the public form always
// asks for first. They are not survey questions and are never saved.
const FIXED_FIELDS = [
  { key: 'name', labelKey: 'survey.name', typeKey: 'survey.typeText' },
  { key: 'email', labelKey: 'survey.email', typeKey: 'survey.typeEmail' },
]

export default function SurveyQuestionsEditor() {
  const { auth, currentLanguage } = useApp()
  // Starts empty and shows exactly what the public form uses. If loading fails
  // nothing can be saved, so the live survey is never replaced by a guess.
  const [questions, setQuestions] = useState<EditorQuestion[]>([])
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  // Ids of the questions as last loaded or saved: these are sent back so the
  // server keeps them (and their answers); any missing on save are deleted.
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false)
  const [addedId, setAddedId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(false)
  const drag = useDragReorder(setQuestions)
  const lang = currentLanguage

  const showSaved = (saved: SurveyQuestion[]) => {
    setQuestions(saved.map(toEditor))
    setSavedIds(new Set(saved.map(question => question.id)))
  }

  useEffect(() => {
    // A load abandoned by unmounting must not overwrite a later one.
    let current = true
    api.getSurveyQuestions()
      .then(data => {
        if (!current) return
        showSaved(data)
        setLoadState('ready')
      })
      .catch(() => { if (current) setLoadState('failed') })
    return () => { current = false }
  }, [])

  // Saved questions no longer in the list; saving deletes their answers.
  const removedCount = [...savedIds].filter(id => !questions.some(question => question.id === id)).length

  const updateQuestion = (id: string, patch: Partial<EditorQuestion>) => {
    setQuestions(prev => prev.map(question => question.id === id ? { ...question, ...patch } : question))
  }

  const addQuestion = () => {
    const id = makeId()
    setAddedId(id)
    setQuestions(prev => [...prev, {
      id,
      question_type: 'text',
      label: '',
      required: false,
      options: [],
    }])
  }

  const setOption = (id: string, index: number, text: string) => {
    setQuestions(prev => prev.map(question => question.id === id
      ? { ...question, options: question.options.map((option, i) => (i === index ? text : option)) }
      : question))
  }

  const addOption = (id: string) => {
    setQuestions(prev => prev.map(question => question.id === id
      ? { ...question, options: [...question.options, ''] }
      : question))
  }

  const removeOption = (id: string, index: number) => {
    setQuestions(prev => prev.map(question => question.id === id
      ? { ...question, options: question.options.filter((_, i) => i !== index) }
      : question))
  }

  const removeQuestion = (id: string) => {
    setQuestions(prev => prev.filter(question => question.id !== id))
  }

  const fail = (key: string) => {
    setMsg(t(key, undefined, lang))
    setMsgOk(false)
    return null
  }

  // The questions as they would be saved, or null (with a message) if they
  // cannot be.
  const buildPayload = (): SurveyQuestionInput[] | null => {
    const payload: SurveyQuestionInput[] = questions.map(question => ({
      id: savedIds.has(question.id) ? question.id : undefined,
      question_type: question.question_type,
      label: question.label.trim(),
      required: question.required,
      options: question.question_type === 'multiselect'
        ? question.options.map(option => option.trim()).filter(Boolean)
        : [],
    }))
    if (payload.some(question => !question.label)) return fail('survey.editor.blankLabel')
    const multiselects = payload.filter(question => question.question_type === 'multiselect')
    if (multiselects.some(question => question.options.length === 0)) return fail('survey.editor.needOptions')
    if (multiselects.some(question =>
      new Set(question.options.map(option => option.toLowerCase())).size !== question.options.length)) {
      return fail('survey.editor.duplicateOptions')
    }
    return payload
  }

  const save = async () => {
    setConfirmSaveOpen(false)
    if (!auth || loadState !== 'ready') return
    setMsg('')
    const payload = buildPayload()
    if (!payload) return
    setSaving(true)
    try {
      showSaved(await api.updateSurveyQuestions(payload, auth.token))
      setMsg(t('survey.editor.saved', undefined, lang))
      setMsgOk(true)
    } catch {
      setMsg(t('survey.editor.failed', undefined, lang))
      setMsgOk(false)
    } finally {
      setSaving(false)
    }
  }

  // Deleting answers can't be undone, so it is confirmed first.
  const handleSave = () => {
    setMsg('')
    if (!buildPayload()) return
    if (removedCount > 0) setConfirmSaveOpen(true)
    else save()
  }

  const typeLabel = (type: QuestionType) =>
    type === 'checkbox' ? t('survey.typeCheckbox', undefined, lang)
      : type === 'rating' ? t('survey.typeRating', undefined, lang)
        : type === 'multiselect' ? t('survey.typeMultiselect', undefined, lang)
          : t('survey.typeText', undefined, lang)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <h2 className="page-header" style={{ margin: 0, border: 'none' }}>{t('nav.survey', undefined, lang)}</h2>
        <button className="btn btn-default" onClick={addQuestion} disabled={loadState !== 'ready'}>
          <span className="glyphicon glyphicon-plus" style={{ marginRight: 6 }}></span>
          {t('survey.add', undefined, lang)}
        </button>
      </div>

      {msg && (
        <div className={`alert ${msgOk ? 'alert-success' : 'alert-danger'}`} role="alert">{msg}</div>
      )}

      {loadState === 'loading' && <p style={{ color: '#999' }}>{t('survey.editor.loading', undefined, lang)}</p>}
      {loadState === 'failed' && (
        <div className="alert alert-danger" role="alert">{t('survey.editor.loadFailed', undefined, lang)}</div>
      )}

      {loadState === 'ready' && FIXED_FIELDS.map(field => (
        <div className="panel panel-default" key={field.key} style={{ marginBottom: '1rem', background: '#f8f8f8' }}>
          <div className="panel-heading" style={{ display: 'flex', alignItems: 'center' }}>
            <h3 className="panel-title" style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <span className="glyphicon glyphicon-lock" style={{ marginRight: 8, color: '#999' }}></span>
              {t('survey.fixedField', undefined, lang)}
            </h3>
          </div>
          <div className="panel-body">
            <div className="row">
              <div className="col-sm-8 form-group">
                <label>{t('survey.label', undefined, lang)}</label>
                <input type="text" className="form-control" value={t(field.labelKey, undefined, lang)} disabled readOnly />
              </div>
              <div className="col-sm-4 form-group">
                <label>{t('survey.type', undefined, lang)}</label>
                <select className="form-control" disabled value={field.key}>
                  <option value={field.key}>{t(field.typeKey, undefined, lang)}</option>
                </select>
              </div>
            </div>
            <label style={{ fontWeight: 400 }}>
              <input type="checkbox" checked disabled readOnly style={{ marginRight: 6 }} />
              {t('survey.required', undefined, lang)}
            </label>
          </div>
        </div>
      ))}

      {loadState === 'ready' && questions.length === 0 && (
        <div className="alert alert-info" role="alert">{t('survey.editor.empty', undefined, lang)}</div>
      )}

      {questions.map((question, index) => (
        <div
          className="panel panel-default"
          key={question.id}
          style={{ marginBottom: '1rem', ...drag.itemStyle(index) }}
          {...drag.itemProps(index)}
        >
          <div
            className="panel-heading"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'grab' }}
            title={t('survey.drag', undefined, lang)}
            {...drag.handleProps(index)}
          >
            <h3 className="panel-title" style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <span className="glyphicon glyphicon-move" style={{ marginRight: 8, color: '#999' }}></span>
              {t('survey.questionNumber', { number: index + 1 }, lang)}
            </h3>
            {/* A fixed square with the icon flex-centred: the theme's button
                padding, letter-spacing and the glyph's 1px nudge otherwise
                leave the trash can visibly off centre. */}
            <button className="btn btn-danger btn-xs" onClick={() => setRemoveId(question.id)}
              title={t('survey.remove', undefined, lang)} aria-label={t('survey.remove', undefined, lang)}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 28, height: 28, minWidth: 0, padding: 0, margin: 0, letterSpacing: 0,
              }}>
              <span className="glyphicon glyphicon-trash" style={{ top: 0, lineHeight: 1 }}></span>
            </button>
          </div>
          <div className="panel-body">
            <div className="row">
              <div className="col-sm-8 form-group">
                <label>{t('survey.label', undefined, lang)}</label>
                <input
                  type="text"
                  className="form-control"
                  autoFocus={question.id === addedId}
                  value={question.label}
                  onChange={e => updateQuestion(question.id, { label: e.target.value })}
                />
              </div>
              <div className="col-sm-4 form-group">
                <label>{t('survey.type', undefined, lang)}</label>
                <select
                  className="form-control"
                  value={question.question_type}
                  onChange={e => {
                    const question_type = e.target.value as QuestionType
                    // Start a new "select all that apply" question with two blank selections to fill in.
                    const options = question_type === 'multiselect' && question.options.length === 0 ? ['', ''] : question.options
                    updateQuestion(question.id, { question_type, options })
                  }}
                >
                  <option value="checkbox">{typeLabel('checkbox')}</option>
                  <option value="text">{typeLabel('text')}</option>
                  <option value="rating">{typeLabel('rating')}</option>
                  <option value="multiselect">{typeLabel('multiselect')}</option>
                </select>
              </div>
            </div>

            {question.question_type === 'multiselect' && (
              <div className="form-group">
                <label>{t('survey.options', undefined, lang)}</label>
                {question.options.map((option, optionIndex) => (
                  <div key={optionIndex} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      className="form-control"
                      maxLength={100}
                      placeholder={t('survey.optionNumber', { number: optionIndex + 1 }, lang)}
                      aria-label={t('survey.optionNumber', { number: optionIndex + 1 }, lang)}
                      value={option}
                      onChange={e => setOption(question.id, optionIndex, e.target.value)}
                    />
                    <button className="btn btn-default" onClick={() => removeOption(question.id, optionIndex)}
                      title={t('survey.removeOption', undefined, lang)} aria-label={t('survey.removeOption', undefined, lang)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        width: 34, minWidth: 0, padding: 0, margin: 0, letterSpacing: 0,
                      }}>
                      <span className="glyphicon glyphicon-remove" style={{ top: 0, lineHeight: 1 }}></span>
                    </button>
                  </div>
                ))}
                <button className="btn btn-default btn-sm" onClick={() => addOption(question.id)}
                  disabled={question.options.length >= MAX_OPTIONS}
                  style={{ minWidth: 0, margin: 0, padding: '5px 12px', textTransform: 'none', letterSpacing: 'normal' }}>
                  <span className="glyphicon glyphicon-plus" style={{ marginRight: 6 }}></span>
                  {t('survey.addOption', undefined, lang)}
                </button>
              </div>
            )}

            <label style={{ fontWeight: 400, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={question.required}
                onChange={e => updateQuestion(question.id, { required: e.target.checked })}
                style={{ marginRight: 6 }}
              />
              {t('survey.required', undefined, lang)}
            </label>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
        <button className="btn btn-primary" style={{ padding: '6px 16px', minWidth: 0 }} onClick={handleSave} disabled={saving || loadState !== 'ready'}>
          {saving ? t('survey.editor.saving', undefined, lang) : t('survey.editor.save', undefined, lang)}
        </button>
      </div>
      <ConfirmDialog
        open={removeId !== null}
        title={t('survey.confirmRemoveTitle', undefined, lang)}
        message={t('survey.confirmRemove', undefined, lang)}
        confirmLabel={t('survey.remove', undefined, lang)}
        cancelLabel={t('visitorLog.cancel', undefined, lang)}
        danger
        onConfirm={() => {
          if (removeId !== null) removeQuestion(removeId)
          setRemoveId(null)
        }}
        onCancel={() => setRemoveId(null)}
      />
      <ConfirmDialog
        open={confirmSaveOpen}
        title={t('survey.editor.confirmSaveTitle', undefined, lang)}
        message={t('survey.editor.confirmSave', { count: removedCount }, lang)}
        confirmLabel={t('survey.editor.confirmSaveButton', undefined, lang)}
        cancelLabel={t('visitorLog.cancel', undefined, lang)}
        danger
        busy={saving}
        onConfirm={save}
        onCancel={() => setConfirmSaveOpen(false)}
      />
    </>
  )
}
