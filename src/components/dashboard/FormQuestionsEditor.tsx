import { Fragment, useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import type { FormQuestion } from '../../services/api'

// Every check-in question, in kiosk order, for reference only: the check-in
// questions are locked, so this page has no editing controls (and the API
// has no route to change them). It uses the Customer Experience Form
// editor's Question / Question Type / Required layout, greyed out.

type QuestionType = 'singleChoice' | 'text' | 'number' | 'multiselect' | 'yesNo'

interface LockedQuestion {
  key: string
  label: string
  type: QuestionType
  required: boolean
  description?: string
  choices?: string[]
  note?: string
}

const TYPE_LABELS: Record<QuestionType, string> = {
  singleChoice: 'formQuestions.typeSingleChoice',
  text: 'survey.typeText',
  number: 'formQuestions.typeNumber',
  multiselect: 'survey.typeMultiselect',
  yesNo: 'formQuestions.typeYesNo',
}

const DEFAULT_DOCUMENT_QUESTIONS: FormQuestion[] = [
  { key: 'photo', title: 'Passport Photo', description: 'Do you have a 2x2 inch color photo taken within the last 6 months?', required: true },
  { key: 'citizenship', title: 'Proof of Citizenship', description: 'Do you have a certified birth certificate or naturalization certificate?', required: true },
  { key: 'id', title: 'Photo Identification', description: "Do you have a valid driver's license or government-issued ID?", required: true },
  { key: 'payment', title: 'Form of Payment', description: 'Do you have a credit card, check, or money order for processing fees?', required: true },
]

const AFFILIATION_KEYS = ['student', 'alumni', 'staff', 'faculty', 'na']
const REFERRAL_KEYS = ['web', 'email', 'passport_site', 'returning', 'signage', 'yelp', 'other']

const panelHeadingStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const panelTitleStyle = { textTransform: 'uppercase' as const, letterSpacing: '0.5px' }
const stepHeadingStyle = { margin: '1.5rem 0 0.75rem', color: '#182B49', fontSize: '1.1rem', fontWeight: 700 }
const noteStyle = { margin: '0.5rem 0 0', color: '#6B7C96', fontSize: '0.85rem' }

export default function FormQuestionsEditor() {
  const { currentLanguage } = useApp()
  const [documentQuestions, setDocumentQuestions] = useState<FormQuestion[]>(DEFAULT_DOCUMENT_QUESTIONS)
  const lang = currentLanguage
  const tr = (key: string) => t(key, undefined, lang)

  useEffect(() => {
    api.getQuestions()
      .then(data => { if (Array.isArray(data)) setDocumentQuestions(data) })
      .catch(() => { /* keep the defaults */ })
  }, [])

  const steps: { title: string; questions: LockedQuestion[] }[] = [
    {
      title: 'formQuestions.stepVisitType',
      questions: [
        { key: 'visitType', label: tr('step1.title'), type: 'singleChoice', required: true, choices: [tr('step1.appointment'), tr('step1.walkin')] },
      ],
    },
    {
      title: 'formQuestions.stepContact',
      questions: [
        { key: 'firstName', label: tr('step2.firstName'), type: 'text', required: true },
        { key: 'lastName', label: tr('step2.lastName'), type: 'text', required: true },
        { key: 'phone', label: tr('step2.phone'), type: 'text', required: true },
        { key: 'email', label: tr('step2.email'), type: 'text', required: true },
        { key: 'partySize', label: tr('step2.partySize'), type: 'number', required: true },
        { key: 'service', label: tr('service.title'), type: 'multiselect', required: true, choices: [tr('service.passports'), tr('service.notary'), tr('service.photoOnly')] },
        { key: 'photoType', label: tr('photo.format.title'), type: 'multiselect', required: true, choices: [tr('photo.digital'), tr('photo.printed')], note: 'formQuestions.shownWhenPhoto' },
      ],
    },
    {
      title: 'formQuestions.stepDocuments',
      questions: [
        { key: 'appComplete', label: tr('step3.appComplete'), type: 'yesNo', required: true },
        ...documentQuestions.map(q => ({
          key: `doc-${q.key}`, label: q.title, description: q.description, type: 'yesNo' as const, required: q.required,
        })),
      ],
    },
    {
      title: 'formQuestions.stepSurvey',
      questions: [
        { key: 'affiliation', label: tr('kioskSurvey.affiliation'), type: 'multiselect', required: true, choices: AFFILIATION_KEYS.map(k => tr(`kioskSurvey.affiliation.${k}`)), note: 'formQuestions.naExclusive' },
        { key: 'referral', label: tr('kioskSurvey.referral'), type: 'multiselect', required: true, choices: REFERRAL_KEYS.map(k => tr(`kioskSurvey.referral.${k}`)) },
      ],
    },
  ]

  const lockedPanel = (question: LockedQuestion, number: number) => (
    <div className="panel panel-default" key={question.key} style={{ marginBottom: '1rem', background: '#f8f8f8' }}>
      <div className="panel-heading" style={panelHeadingStyle}>
        <h3 className="panel-title" style={panelTitleStyle}>{t('survey.questionNumber', { number }, lang)}</h3>
        <span style={{ color: '#6B7C96', fontSize: '0.8rem' }}>
          <span className="glyphicon glyphicon-lock" style={{ marginRight: 6 }}></span>
          {tr('formQuestions.builtIn')}
        </span>
      </div>
      <div className="panel-body">
        <div className="row">
          <div className="col-sm-8 form-group">
            <label>{tr('survey.label')}</label>
            <input type="text" className="form-control" value={question.label} disabled />
          </div>
          <div className="col-sm-4 form-group">
            <label>{tr('survey.type')}</label>
            <select className="form-control" value={question.type} disabled>
              <option value={question.type}>{tr(TYPE_LABELS[question.type])}</option>
            </select>
          </div>
        </div>
        {question.description && (
          <div className="form-group">
            <label>{tr('formQuestions.description')}</label>
            <textarea className="form-control" rows={2} value={question.description} disabled />
          </div>
        )}
        {question.choices && (
          <div className="form-group">
            <label>{tr('formQuestions.choices')}</label>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', color: '#555' }}>
              {question.choices.map(choice => <li key={choice}>{choice}</li>)}
            </ul>
          </div>
        )}
        <label style={{ fontWeight: 400, margin: 0, color: '#555' }}>
          <input type="checkbox" checked={question.required} readOnly disabled style={{ marginRight: 6 }} />
          {tr('survey.required')}
        </label>
        {question.note && <p style={noteStyle}>{tr(question.note)}</p>}
      </div>
    </div>
  )

  let number = 0

  return (
    <>
      <h2 className="page-header" style={{ margin: '0 0 1rem', border: 'none' }}>{tr('formQuestions.title')}</h2>
      <p style={{ color: '#6B7C96' }}>{tr('formQuestions.builtInNote')}</p>

      {steps.map(step => (
        <Fragment key={step.title}>
          <h3 style={stepHeadingStyle}>{tr(step.title)}</h3>
          {step.questions.map(question => lockedPanel(question, ++number))}
        </Fragment>
      ))}
    </>
  )
}
