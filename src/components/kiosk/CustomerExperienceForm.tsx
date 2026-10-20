import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import type { SurveyAnswerValue, SurveyQuestion } from '../../services/api'

type AnswerValue = SurveyAnswerValue

const RATING_VALUES = [1, 2, 3, 4, 5]
const RESET_SECONDS = 15
// How often an open form re-checks the survey template for edits.
const REFRESH_MS = 60_000

// Everything about the questions that changes what the visitor sees or sends.
const signature = (questions: SurveyQuestion[]) =>
  JSON.stringify(questions.map(q => [q.id, q.type, q.label, q.required, q.options]))

// Survey controls are sized for fingers: at least 44px to tap, and text of
// 16px or more so iPhones do not zoom in when a field is tapped.
const CHECKBOX_STYLE = { width: 20, height: 20, margin: 0, flexShrink: 0 }

export default function CustomerExperienceForm() {
  const { location } = useParams<{ location: string }>()
  const { currentLanguage } = useApp()
  const lang = currentLanguage

  const [questions, setQuestions] = useState<SurveyQuestion[]>([])
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({})
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Blocks a second tap that lands before the button re-renders as disabled.
  const submittingRef = useRef(false)
  const [submitted, setSubmitted] = useState(false)
  const [alertMsg, setAlertMsg] = useState('')
  // Shown when the survey was edited while someone was filling it in.
  const [surveyChanged, setSurveyChanged] = useState(false)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The questions on screen; null until the first load succeeds.
  const questionsRef = useRef<SurveyQuestion[] | null>(null)
  const startedRef = useRef(false)

  useEffect(() => {
    startedRef.current = name !== '' || email !== '' || Object.keys(answers).length > 0
  }, [name, email, answers])

  /**
   * Loads the current survey template. If it differs from what is on screen,
   * shows the new questions, keeping answers to questions that are still
   * asked the same way. Returns true when an already-shown survey changed.
   */
  const refreshQuestions = useCallback(async (): Promise<boolean> => {
    let fresh: SurveyQuestion[]
    try {
      fresh = await api.getSurveyQuestions()
    } catch {
      return false
    }
    const previous = questionsRef.current
    if (previous && signature(fresh) === signature(previous)) return false
    questionsRef.current = fresh
    setQuestions(fresh)
    if (!previous) return false
    setAnswers(prev => {
      const next: Record<string, AnswerValue> = {}
      for (const question of fresh) {
        const before = previous.find(q => q.id === question.id)
        const value = prev[question.id]
        if (!before || before.type !== question.type || value === undefined) continue
        next[question.id] = question.type === 'multiselect' && Array.isArray(value)
          ? value.filter(option => question.options.includes(option))
          : value
      }
      return next
    })
    return true
  }, [])

  useEffect(() => {
    refreshQuestions()
    // Pick up edits while the form sits open, and as soon as a sleeping
    // tablet is woken. Only someone mid-way through is told about it.
    const check = async () => {
      if (await refreshQuestions() && startedRef.current) setSurveyChanged(true)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const interval = setInterval(check, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refreshQuestions])

  const resetForm = useCallback(() => {
    setAnswers({})
    setName('')
    setEmail('')
    setSubmitted(false)
    setAlertMsg('')
    setSurveyChanged(false)
    setSubmitting(false)
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  useEffect(() => {
    if (submitted && countdownRef.current === null) {
      let seconds = RESET_SECONDS
      countdownRef.current = setInterval(() => {
        seconds -= 1
        if (seconds <= 0) resetForm()
      }, 1000)
    }
    return () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current)
        countdownRef.current = null
      }
    }
  }, [submitted, resetForm])

  const setAnswer = (questionId: string, value: AnswerValue) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }))
  }

  const toggleOption = (questionId: string, option: string) => {
    setAnswers(prev => {
      const current = prev[questionId]
      const chosen = Array.isArray(current) ? current : []
      return {
        ...prev,
        [questionId]: chosen.includes(option) ? chosen.filter(o => o !== option) : [...chosen, option],
      }
    })
  }

  const isBlank = (value: AnswerValue | undefined) =>
    value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)

  const validate = (): boolean => {
    setAlertMsg('')
    if (!name.trim()) {
      setAlertMsg(t('required.fields', undefined, lang))
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setAlertMsg(t('invalid.email', undefined, lang))
      return false
    }
    for (const question of questions) {
      if (question.required && isBlank(answers[question.id])) {
        setAlertMsg(t('survey.answerRequired', { label: question.label }, lang))
        return false
      }
    }
    return true
  }

  const handleSubmit = async () => {
    if (submittingRef.current || !validate() || !location) return
    submittingRef.current = true
    setSubmitting(true)
    setAlertMsg('')
    setSurveyChanged(false)
    try {
      // Never send answers to a survey that has since been edited: show the
      // new version and let the visitor check it first.
      if (await refreshQuestions()) {
        setSurveyChanged(true)
        return
      }
      await api.submitSurveyResponse({
        location_id: location,
        name: name.trim(),
        email: email.trim(),
        answers: questions.map(question => ({
          question_id: question.id,
          value: answers[question.id] ?? null,
        })),
      })
      setSubmitted(true)
    } catch (err) {
      // Edited between that check and the submit.
      if (String(err).startsWith('Error: 409')) {
        await refreshQuestions()
        setSurveyChanged(true)
      } else {
        setAlertMsg(t('survey.submitFailed', undefined, lang))
      }
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const ratingBtnStyle = (selected: boolean) => ({
    minWidth: 48,
    minHeight: 44,
    padding: '6px 10px',
    fontSize: 16,
    fontWeight: selected ? 700 : 400,
    lineHeight: 1.5,
    textTransform: 'none' as const,
    letterSpacing: 'normal',
    borderRadius: 3,
    border: `1px solid ${selected ? '#00629B' : '#ccc'}`,
    background: selected ? '#00629B' : '#fff',
    color: selected ? '#fff' : '#333',
  })

  const renderQuestion = (question: SurveyQuestion) => {
    const value = answers[question.id]
    return (
      <div className="panel panel-default" key={question.id} style={{ marginBottom: '1rem' }}>
        <div className="panel-body" style={{ padding: '1.25rem' }}>
          <strong>{question.label}</strong>
          {question.required && <span style={{ color: '#E05D5D', marginLeft: 4 }}>*</span>}

          {question.type === 'rating' && (
            // display: flex puts the scale on its own line under the question;
            // a .btn-group is inline by default and sat beside the label.
            <div className="btn-group" style={{ display: 'flex', marginTop: '0.75rem' }} role="group" aria-label={question.label}>
              {RATING_VALUES.map(ratingValue => (
                <button
                  key={ratingValue}
                  type="button"
                  className="btn btn-sm"
                  style={ratingBtnStyle(value === ratingValue)}
                  onClick={() => setAnswer(question.id, ratingValue)}
                >
                  {ratingValue}
                </button>
              ))}
            </div>
          )}

          {question.type === 'multiselect' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: '0.75rem' }}>
              {question.options.map(option => (
                <label key={option} style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0, minHeight: 44, fontWeight: 400, cursor: 'pointer' }}>
                  <input
                    type="checkbox" style={CHECKBOX_STYLE}
                    checked={Array.isArray(value) && value.includes(option)}
                    onChange={() => toggleOption(question.id, option)}
                  />
                  {option}
                </label>
              ))}
            </div>
          )}

          {question.type === 'checkbox' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: '0.75rem', minHeight: 44, fontWeight: 400, cursor: 'pointer' }}>
              <input
                type="checkbox" style={CHECKBOX_STYLE}
                checked={value === true}
                onChange={e => setAnswer(question.id, e.target.checked)}
              />
              {t('yes', undefined, lang)}
            </label>
          )}

          {question.type === 'text' && (
            <textarea
              className="form-control"
              rows={3}
              style={{ marginTop: '0.75rem', fontSize: 16 }}
              value={typeof value === 'string' ? value : ''}
              onChange={e => setAnswer(question.id, e.target.value)}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="layout-main" id="main-content" role="main">
      <div className="container" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
        <div className="row">
          <div className="col-sm-8 col-sm-offset-2">
            {surveyChanged && !submitted && (
              <div className="alert alert-warning" role="alert" style={{ marginBottom: '1.5rem' }}>
                <span className="glyphicon glyphicon-refresh" style={{ marginRight: 6 }}></span>
                {t('survey.formUpdated', undefined, lang)}
              </div>
            )}
            {alertMsg && (
              <div className="alert alert-danger" role="alert" style={{ marginBottom: '1.5rem' }}>
                <span className="glyphicon glyphicon-exclamation-sign" style={{ marginRight: 6 }}></span>
                {alertMsg}
              </div>
            )}

            <div className="panel panel-default" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <div className="panel-body" style={{ padding: '2.5rem' }}>
                {submitted ? (
                  <div className="text-center">
                    <div style={{
                      width: 80, height: 80, borderRadius: '50%', background: '#4BB543',
                      color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: '1.5rem',
                    }}>
                      <span className="glyphicon glyphicon-ok" style={{ fontSize: '2.5rem' }}></span>
                    </div>
                    <h2 className="page-header" style={{ border: 'none' }}>{t('survey.thankYou', undefined, lang)}</h2>
                    <p className="lead">{t('survey.thankYouDesc', undefined, lang)}</p>
                    <button className="btn btn-default" onClick={resetForm} style={{ marginTop: '0.5rem' }}>
                      <span className="glyphicon glyphicon-chevron-left" style={{ marginRight: 6 }}></span>
                      {t('survey.submitAnother', undefined, lang)}
                    </button>
                  </div>
                ) : (
                  <>
                    <h2 className="page-header" style={{ margin: '0 0 1.5rem', border: 'none' }}>{t('survey.title', undefined, lang)}</h2>

                    <div className="row" style={{ marginBottom: '1rem' }}>
                      <div className="col-sm-6 form-group">
                        <label htmlFor="survey-name">{t('survey.name', undefined, lang)}</label>
                        <input
                          id="survey-name"
                          autoComplete="name"
                          type="text"
                          className="form-control input-lg"
                          value={name}
                          onChange={e => setName(e.target.value)}
                        />
                      </div>
                      <div className="col-sm-6 form-group">
                        <label htmlFor="survey-email">{t('survey.email', undefined, lang)}</label>
                        <input
                          id="survey-email"
                          autoComplete="email"
                          inputMode="email"
                          type="email"
                          className="form-control input-lg"
                          value={email}
                          onChange={e => setEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    {questions.map(renderQuestion)}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      <button className="btn btn-primary btn-lg" onClick={handleSubmit} disabled={submitting} style={{ margin: 0 }}>
                        {submitting ? t('survey.submitting', undefined, lang) : t('survey.submit', undefined, lang)}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
