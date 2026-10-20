import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, type Language, type LocationId } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import type { FormQuestion } from '../../services/api'
import { useIdleTimer } from '../../hooks/useIdleTimer'
import { useKioskFullscreen } from '../../hooks/useKioskFullscreen'
import { useMediaQuery } from '../../hooks/useMediaQuery'

type VisitType = 'appointment' | 'walk-in'
type ServiceType = 'passports' | 'notary' | 'photo-only'
// The order services are sent and stored in, whatever order they were tapped.
const SERVICE_ORDER: ServiceType[] = ['passports', 'notary', 'photo-only']
type PhotoFormat = 'digital' | 'printed'

interface KioskData {
  step: number
  // Nothing is pre-selected; the visitor has to choose.
  visitType: VisitType | null
  // A visitor can need several services in one visit.
  serviceTypes: ServiceType[]
  // Digital, printed, or both.
  photoFormats: PhotoFormat[]
  appComplete: boolean | null
  formData: {
    firstName: string
    lastName: string
    email: string
    phone: string
    partySize: string
  }
  // Keyed by checklist question key; a question with no entry is unanswered.
  checklist: Record<string, boolean>
  // Customer Survey step: chosen keys, both optional.
  affiliations: string[]
  referralSources: string[]
}

const INITIAL_DATA: KioskData = {
  step: 0,
  visitType: null,
  serviceTypes: [],
  photoFormats: [],
  appComplete: null,
  formData: { firstName: '', lastName: '', email: '', phone: '', partySize: '' },
  checklist: {},
  affiliations: [],
  referralSources: [],
}

const STEP_LABELS = ['Welcome', 'Visit Type', 'Contact', 'Document', 'Survey', 'Complete']

// The Customer Survey step's choices, in display order. The keys are what is
// stored (see AFFILIATIONS / REFERRAL_SOURCES in backend/schemas.py).
const AFFILIATION_KEYS = ['student', 'alumni', 'staff', 'faculty', 'na']
const REFERRAL_KEYS = ['web', 'email', 'passport_site', 'returning', 'signage', 'yelp', 'other']

const DEFAULT_CHECKLIST_QUESTIONS: FormQuestion[] = [
  { key: 'photo', title: 'Passport Photo', description: 'Do you have a 2x2 inch color photo taken within the last 6 months?', required: true },
  { key: 'citizenship', title: 'Proof of Citizenship', description: 'Do you have a certified birth certificate or naturalization certificate?', required: true },
  { key: 'id', title: 'Photo Identification', description: "Do you have a valid driver's license or government-issued ID?", required: true },
  { key: 'payment', title: 'Form of Payment', description: 'Do you have a credit card, check, or money order for processing fees?', required: true },
]

// The original document questions have built-in translations. Staff wording
// from the Check-In Form editor replaces the English only; questions staff
// add are shown as typed in every language.
const TRANSLATED_DOC_KEYS = ['photo', 'citizenship', 'id', 'payment']

const KIOSK_LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'zh', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
]

const KIOSK_LOCATIONS: { id: LocationId; label: string }[] = [
  { id: 'csc', label: 'CSC' },
  { id: 'bookstore', label: 'Bookstore' },
]

export default function KioskStepper() {
  const { location } = useParams<{ location: string }>()
  const { search } = useLocation()
  const navigate = useNavigate()
  const { auth, currentLanguage, setLanguage, setKioskLocation } = useApp()
  const fullscreen = useKioskFullscreen()
  // Phones and tablets: size tap targets for fingers.
  const touch = useMediaQuery('(pointer: coarse)')
  const [submitting, setSubmitting] = useState(false)
  // A ref, not just state: a second tap can land before React re-renders
  // the disabled button, and must not send a duplicate check-in.
  const submittingRef = useRef(false)
  const [data, setData] = useState<KioskData>(INITIAL_DATA)
  const [submitted, setSubmitted] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [alertMsg, setAlertMsg] = useState('')
  const [openMenu, setOpenMenu] = useState<'checkin' | 'language' | null>(null)
  const toggleMenu = (menu: 'checkin' | 'language') => setOpenMenu(open => (open === menu ? null : menu))
  const [checklistQuestions, setChecklistQuestions] = useState<FormQuestion[]>(DEFAULT_CHECKLIST_QUESTIONS)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const locName = location === 'bookstore' ? 'Bookstore' : 'CSC'

  useEffect(() => {
    if (location) setKioskLocation(location as 'csc' | 'bookstore')
  }, [location, setKioskLocation])

  useEffect(() => {
    const fetchQs = async () => {
      try {
        const data = await api.getQuestions()
        if (Array.isArray(data)) setChecklistQuestions(data)
      } catch { /* fall back to defaults */ }
    }
    fetchQs()
  }, [])

  const resetToWelcome = useCallback(() => {
    setData(INITIAL_DATA)
    setSubmitted(false)
    setCountdown(10)
    setAlertMsg('')
    if (countdownRef.current) clearInterval(countdownRef.current)
  }, [])

  useIdleTimer(resetToWelcome, 60000, !submitted)

  const set = (patch: Partial<KioskData>) => setData(prev => ({ ...prev, ...patch }))

  const updateFormData = (field: string, value: string | boolean) => {
    setData(prev => ({ ...prev, formData: { ...prev.formData, [field]: value } }))
  }

  const services = SERVICE_ORDER.filter(service => data.serviceTypes.includes(service))
  const hasService = (service: ServiceType) => services.includes(service)
  // Only passport visits have a further step (the document checklist); the
  // photo type is asked on the contact step, right under the service.
  const needsDocumentStep = hasService('passports')

  const toggleService = (service: ServiceType) => {
    setData(prev => ({
      ...prev,
      serviceTypes: prev.serviceTypes.includes(service)
        ? prev.serviceTypes.filter(s => s !== service)
        : [...prev.serviceTypes, service],
    }))
  }

  const togglePhotoFormat = (format: PhotoFormat) => {
    setData(prev => ({
      ...prev,
      photoFormats: prev.photoFormats.includes(format)
        ? prev.photoFormats.filter(f => f !== format)
        : [...prev.photoFormats, format],
    }))
  }

  // The API's single photo_format field already has a value for "both".
  const photoFormatValue = !hasService('photo-only') || data.photoFormats.length === 0
    ? null
    : data.photoFormats.length === 2 ? 'both' : data.photoFormats[0]

  // Choice buttons toggle: tapping the selected answer again clears it.
  const toggleVisitType = (visitType: VisitType) => {
    setData(prev => ({ ...prev, visitType: prev.visitType === visitType ? null : visitType }))
  }

  const toggleAppComplete = (value: boolean) => {
    setData(prev => ({ ...prev, appComplete: prev.appComplete === value ? null : value }))
  }

  const docQuestionText = (question: FormQuestion) =>
    currentLanguage !== 'en' && TRANSLATED_DOC_KEYS.includes(question.key)
      ? {
          title: t(`checklist.${question.key}.title`, undefined, currentLanguage),
          description: t(`checklist.${question.key}.description`, undefined, currentLanguage),
        }
      : question

  const requiredMark = <span style={{ color: '#E05D5D' }}> *</span>

  const toggleChoice = (field: 'affiliations' | 'referralSources', key: string) => {
    setData(prev => {
      const current = prev[field]
      let next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
      // N/A means "not affiliated", so it cannot sit alongside an affiliation:
      // picking it clears the others, and picking an affiliation clears it.
      if (field === 'affiliations' && !current.includes(key)) {
        next = key === 'na' ? ['na'] : next.filter(k => k !== 'na')
      }
      return { ...prev, [field]: next }
    })
  }

  const setChecklist = (field: string, value: boolean) => {
    setData(prev => {
      const checklist = { ...prev.checklist }
      if (checklist[field] === value) delete checklist[field]
      else checklist[field] = value
      return { ...prev, checklist }
    })
  }

  // Decorator 5's .btn-primary is styled for large CTAs (min-width: 200px,
  // bold uppercase, big padding). Coloring via inline style instead of
  // swapping to that class keeps these toggle buttons a fixed size.
  // On the tablet kiosk they are sized for fingers instead.
  const yesNoBtnStyle = (selected: boolean) => ({
    padding: fullscreen || touch ? '12px 24px' : '5px 10px',
    fontSize: fullscreen || touch ? 17 : 12,
    fontWeight: 400,
    lineHeight: 1.5,
    textTransform: 'none' as const,
    letterSpacing: 'normal',
    minWidth: 0,
    borderRadius: 3,
    border: `1px solid ${selected ? '#00629B' : '#ccc'}`,
    background: selected ? '#00629B' : '#fff',
    color: selected ? '#fff' : '#333',
  })

  // A chosen card is filled in solid blue, the same as a chosen Yes / No
  // button, so the selection is obvious at a glance.
  const choiceCardStyle = (selected: boolean) => (selected
    ? { background: '#00629B', borderColor: '#00629B', color: '#fff' }
    : {})

  const validateContact = (): boolean => {
    setAlertMsg('')
    const fd = data.formData
    if (!fd.firstName || !fd.lastName || !fd.phone || !fd.email.trim() || !fd.partySize) {
      setAlertMsg(t('required.fields', undefined, currentLanguage))
      return false
    }
    const cleanPhone = fd.phone.replace(/\D/g, '')
    if (cleanPhone.length < 10) {
      setAlertMsg(t('invalid.phone', undefined, currentLanguage))
      return false
    }
    if (!/^\d+$/.test(fd.partySize) || parseInt(fd.partySize, 10) < 1) {
      setAlertMsg(t('invalid.partySize', undefined, currentLanguage))
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.email.trim())) {
      setAlertMsg(t('invalid.email', undefined, currentLanguage))
      return false
    }
    if (services.length === 0) {
      setAlertMsg(t('select.service', undefined, currentLanguage))
      return false
    }
    if (hasService('photo-only') && data.photoFormats.length === 0) {
      setAlertMsg(t('select.photoFormat', undefined, currentLanguage))
      return false
    }
    return true
  }

  const validateChecklist = (): boolean => {
    setAlertMsg('')
    if (hasService('passports')) {
      if (data.appComplete === null) {
        setAlertMsg(t('confirm.appComplete', undefined, currentLanguage))
        return false
      }
      if (checklistQuestions.some(q => q.required && data.checklist[q.key] === undefined)) {
        setAlertMsg(t('confirm.checklist', undefined, currentLanguage))
        return false
      }
    }
    return true
  }

  const submitCheckIn = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const checklistJson = hasService('passports')
      ? JSON.stringify(Object.fromEntries(checklistQuestions.map(q => [q.key, data.checklist[q.key] ?? null])))
      : null

    try {
      await api.checkin({
        location_id: location || 'csc',
        first_name: data.formData.firstName,
        last_name: data.formData.lastName,
        email: data.formData.email.trim(),
        phone: data.formData.phone,
        party_size: parseInt(data.formData.partySize, 10),
        visit_type: data.visitType,
        service_type: services.join(','),
        photo_format: photoFormatValue,
        app_complete: hasService('passports') ? data.appComplete : null,
        checklist: checklistJson,
        affiliations: AFFILIATION_KEYS.filter(k => data.affiliations.includes(k)).join(','),
        referral_sources: REFERRAL_KEYS.filter(k => data.referralSources.includes(k)).join(','),
      })
      setData(prev => ({ ...prev, step: 5 }))
      setSubmitted(true)
      setCountdown(10)
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current)
            resetToWelcome()
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch {
      setAlertMsg(t('checkin.failed', undefined, currentLanguage))
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const nextStep = () => {
    setAlertMsg('')
    if (data.step === 0) { set({ step: 1 }); return }
    if (data.step === 1) {
      if (!data.visitType) {
        setAlertMsg(t('select.visitType', undefined, currentLanguage))
        return
      }
      set({ step: 2 })
      return
    }
    if (data.step === 2) {
      if (!validateContact()) return
      // Passport visits answer the document questions; everyone then takes
      // the Customer Survey step before checking in.
      set({ step: needsDocumentStep ? 3 : 4 })
      return
    }
    if (data.step === 3) {
      if (!validateChecklist()) return
      set({ step: 4 })
      return
    }
    if (data.step === 4) {
      if (data.affiliations.length === 0 || data.referralSources.length === 0) {
        setAlertMsg(t('kioskSurvey.required', undefined, currentLanguage))
        return
      }
      submitCheckIn()
    }
  }

  const prevStep = () => {
    setAlertMsg('')
    // Back from the survey skips the document step when it was not shown.
    if (data.step === 4 && !needsDocumentStep) set({ step: 2 })
    else if (data.step > 0) set({ step: data.step - 1 })
  }

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  const stepIndicator = () => {
    const steps = [0, 1, 2, 3, 4]
    const active = data.step >= 5 ? 4 : data.step
    return (
      <div className="row" style={{ marginBottom: '2rem' }}>
        <div className="col-sm-12">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {steps.map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i === 0 ? '0 0 auto' : '1 1 0' }}>
                {i > 0 && (
                  <div style={{
                    flex: 1, height: 3,
                    background: s - 1 < active ? '#00629B' : '#e0e0e0',
                    borderRadius: 2,
                    transition: 'background 0.3s',
                  }} />
                )}
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  flexShrink: 0, width: 80,
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 32, height: 32, borderRadius: '50%',
                    background: s < active ? '#00629B' : s === active ? '#182B49' : '#e0e0e0',
                    color: s <= active ? '#fff' : '#999',
                    fontWeight: 700, fontSize: '0.85rem',
                    transition: 'background 0.3s',
                  }}>
                    {s < active
                      ? <span className="glyphicon glyphicon-ok" style={{ fontSize: '0.75rem' }}></span>
                      : s + 1}
                  </div>
                  <div style={{
                    fontSize: '0.75rem', color: s === active ? '#182B49' : '#999',
                    fontWeight: s === active ? 700 : 400, textAlign: 'center',
                    marginTop: 6, whiteSpace: 'nowrap',
                  }}>
                    {STEP_LABELS[s]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderStep = () => {
    switch (data.step) {
      case 0:
        return (
          <div className="text-center" style={{ padding: '2rem 0' }}>
            <h1 className="page-header" style={{ border: 'none', margin: '0 0 2rem' }}>
              {locName} Check-In
            </h1>
            <button className="btn btn-primary btn-lg" onClick={nextStep}
              style={{ padding: '1rem 4rem', fontSize: '1.3rem', margin: 0 }}>
              {t('kiosk.start', undefined, currentLanguage)}
            </button>
          </div>
        )

      case 1: {
        const types: { key: VisitType; icon: string; label: string }[] = [
          { key: 'appointment', icon: 'calendar', label: t('step1.appointment', undefined, currentLanguage) },
          { key: 'walk-in', icon: 'user', label: t('step1.walkin', undefined, currentLanguage) },
        ]
        return (
          <>
            <h2 className="page-header" style={{ border: 'none', marginTop: 0 }}>{t('step1.title', undefined, currentLanguage)}</h2>
            <div className="row">
              {types.map(vt => (
                <div key={vt.key} className="col-sm-6" style={{ marginBottom: '1rem' }}>
                  <div
                    className={`panel ${data.visitType === vt.key ? 'panel-primary' : 'panel-default'}`}
                    style={{ cursor: 'pointer', textAlign: 'center', ...choiceCardStyle(data.visitType === vt.key) }}
                    onClick={() => toggleVisitType(vt.key)}
                    role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') toggleVisitType(vt.key) }}
                  >
                    <div className="panel-body" style={{ padding: '2rem 1rem' }}>
                      <span className={`glyphicon glyphicon-${vt.icon}`}
                        style={{ fontSize: '3rem', display: 'block', marginBottom: '0.5rem' }}></span>
                      <h3 className="panel-title" style={{ fontSize: '1.2rem' }}>{vt.label}</h3>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )
      }

      case 2: {
        const photoOptions: { key: PhotoFormat; icon: string; label: string }[] = [
          { key: 'digital', icon: 'hdd', label: t('photo.digital', undefined, currentLanguage) },
          { key: 'printed', icon: 'picture', label: t('photo.printed', undefined, currentLanguage) },
        ]
        const serviceOptions: { key: ServiceType; icon: string; label: string }[] = [
          { key: 'passports', icon: 'book', label: t('service.passports', undefined, currentLanguage) },
          { key: 'notary', icon: 'pencil', label: t('service.notary', undefined, currentLanguage) },
          { key: 'photo-only', icon: 'camera', label: t('service.photoOnly', undefined, currentLanguage) },
        ]
        return (
          <>
            <h2 className="page-header" style={{ border: 'none', marginTop: 0 }}>{t('step2.title', undefined, currentLanguage)}</h2>

            <div className="row">
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label" htmlFor="kiosk-firstName">{t('step2.firstName', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="text" className="form-control input-lg" id="kiosk-firstName" required aria-required="true"
                    autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                    value={data.formData.firstName}
                    onChange={e => updateFormData('firstName', e.target.value)} />
                </div>
              </div>
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label" htmlFor="kiosk-lastName">{t('step2.lastName', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="text" className="form-control input-lg" id="kiosk-lastName" required aria-required="true"
                    autoComplete="off" autoCorrect="off" autoCapitalize="words" spellCheck={false}
                    value={data.formData.lastName}
                    onChange={e => updateFormData('lastName', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label" htmlFor="kiosk-phone">{t('step2.phone', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="tel" inputMode="tel" className="form-control input-lg" id="kiosk-phone" required aria-required="true"
                    autoComplete="off"
                    value={data.formData.phone}
                    onChange={e => updateFormData('phone', e.target.value)} />
                </div>
              </div>
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label" htmlFor="kiosk-email">{t('step2.email', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="email" inputMode="email" className="form-control input-lg" id="kiosk-email" required aria-required="true"
                    autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
                    value={data.formData.email}
                    onChange={e => updateFormData('email', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label" htmlFor="kiosk-partySize">{t('step2.partySize', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="number" inputMode="numeric" pattern="[0-9]*" min={1} step={1} id="kiosk-partySize" required aria-required="true"
                    autoComplete="off"
                    className="form-control input-lg"
                    value={data.formData.partySize}
                    onChange={e => updateFormData('partySize', e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
            </div>

            <h2 className="page-header" style={{ border: 'none', marginTop: '2rem', marginBottom: '0.25rem' }}>
                  {t('service.title', undefined, currentLanguage)}
                </h2>
                <p style={{ marginBottom: '1rem', color: '#6B7C96' }}>{t('service.hint', undefined, currentLanguage)}</p>
                <div className="row">
                  {serviceOptions.map(sv => (
                    <div key={sv.key} className="col-sm-4" style={{ marginBottom: '1rem' }}>
                      <div
                        className={`panel ${hasService(sv.key) ? 'panel-primary' : 'panel-default'}`}
                        style={{ cursor: 'pointer', textAlign: 'center', ...choiceCardStyle(hasService(sv.key)) }}
                        onClick={() => toggleService(sv.key)}
                        role="checkbox" aria-checked={hasService(sv.key)} tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleService(sv.key) } }}
                      >
                        <div className="panel-body" style={{ padding: '1.5rem 0.5rem' }}>
                          <span className={`glyphicon glyphicon-${sv.icon}`}
                            style={{ fontSize: '2rem', display: 'block', marginBottom: '0.25rem' }}></span>
                          {sv.label}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {hasService('photo-only') && (
                  <>
                    <h2 className="page-header" style={{ border: 'none', marginTop: '1rem', marginBottom: '0.25rem' }}>
                      {t('photo.format.title', undefined, currentLanguage)}
                    </h2>
                    <p style={{ marginBottom: '1rem', color: '#6B7C96' }}>{t('service.hint', undefined, currentLanguage)}</p>
                    <div className="row">
                      {photoOptions.map(pf => {
                        const chosen = data.photoFormats.includes(pf.key)
                        return (
                          <div key={pf.key} className="col-sm-4" style={{ marginBottom: '1rem' }}>
                            <div
                              className={`panel ${chosen ? 'panel-primary' : 'panel-default'}`}
                              style={{ cursor: 'pointer', textAlign: 'center', ...choiceCardStyle(chosen) }}
                              onClick={() => togglePhotoFormat(pf.key)}
                              role="checkbox" aria-checked={chosen} tabIndex={0}
                              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePhotoFormat(pf.key) } }}
                            >
                              <div className="panel-body" style={{ padding: '1.5rem 0.5rem' }}>
                                <span className={`glyphicon glyphicon-${pf.icon}`}
                                  style={{ fontSize: '2rem', display: 'block', marginBottom: '0.25rem' }}></span>
                                {pf.label}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
          </>
        )
      }

      case 3:
        return (
          <>
            <h2 className="page-header" style={{ border: 'none', marginTop: 0 }}>{t('step3.title', undefined, currentLanguage)}</h2>
            <p className="lead" style={{ marginTop: '-0.5rem' }}>{t('step3.desc', undefined, currentLanguage)}</p>

            <div className={`panel ${data.appComplete === null ? 'panel-default' : data.appComplete === false ? 'panel panel-default' : 'panel-success'}`}
              style={{ borderLeft: data.appComplete === false ? '6px solid #E05D5D' : data.appComplete === true ? '6px solid #4BB543' : 'none' }}>
              <div className="panel-body">
                <div className="row">
                  <div className="col-sm-8">
                    <strong style={{ fontSize: '1.05rem' }}>{t('step3.appComplete', undefined, currentLanguage)}</strong>{requiredMark}
                  </div>
                  <div className="col-sm-4 text-right">
                    <div className="btn-group">
                      <button className="btn btn-sm" style={yesNoBtnStyle(data.appComplete === true)}
                        onClick={() => toggleAppComplete(true)}>
                        <span className="glyphicon glyphicon-ok" style={{ marginRight: 4 }}></span>
                        {t('yes', undefined, currentLanguage)}
                      </button>
                      <button className="btn btn-sm" style={yesNoBtnStyle(data.appComplete === false)}
                        onClick={() => toggleAppComplete(false)}>
                        <span className="glyphicon glyphicon-remove" style={{ marginRight: 4 }}></span>
                        {t('no', undefined, currentLanguage)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {checklistQuestions.map(question => {
              const field = question.key
              const val = data.checklist[field]
              const text = docQuestionText(question)
              return (
                <div key={field} className="panel panel-default"
                  style={{ borderLeft: val === false ? '6px solid #E05D5D' : 'none' }}>
                  <div className="panel-body">
                    <div className="row">
                      <div className="col-sm-8">
                        <strong>{text.title}</strong>{question.required && requiredMark}
                        {text.description && (
                          <p style={{ margin: '0.25rem 0 0', color: '#6B7C96' }}>{text.description}</p>
                        )}
                      </div>
                      <div className="col-sm-4 text-right">
                        <div className="btn-group">
                          <button className="btn btn-sm" style={yesNoBtnStyle(val === true)}
                            onClick={() => setChecklist(field, true)}>
                            <span className="glyphicon glyphicon-ok" style={{ marginRight: 4 }}></span>
                            {t('yes', undefined, currentLanguage)}
                          </button>
                          <button className="btn btn-sm" style={yesNoBtnStyle(val === false)}
                            onClick={() => setChecklist(field, false)}>
                            <span className="glyphicon glyphicon-remove" style={{ marginRight: 4 }}></span>
                            {t('no', undefined, currentLanguage)}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )

      case 4: {
        // Both questions are required; N/A and Other cover answers not listed.
        const choiceGroup = (
          title: string,
          options: { key: string; label: string }[],
          chosen: string[],
          field: 'affiliations' | 'referralSources',
          columns: string,
        ) => (
          <>
            <h2 className="page-header" style={{ border: 'none', margin: '1.5rem 0 0.25rem' }}>{title}{requiredMark}</h2>
            <p style={{ marginBottom: '1rem', color: '#6B7C96' }}>{t('service.hint', undefined, currentLanguage)}</p>
            <div className="row">
              {options.map(option => {
                const on = chosen.includes(option.key)
                return (
                  <div key={option.key} className={columns} style={{ marginBottom: '1rem' }}>
                    <div
                      className={`panel ${on ? 'panel-primary' : 'panel-default'}`}
                      style={{ cursor: 'pointer', textAlign: 'center', margin: 0, ...choiceCardStyle(on) }}
                      onClick={() => toggleChoice(field, option.key)}
                      role="checkbox" aria-checked={on} tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleChoice(field, option.key) } }}
                    >
                      <div className="panel-body" style={{ padding: '1.25rem 0.5rem' }}>{option.label}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )
        return (
          <>
            <h2 className="page-header" style={{ border: 'none', marginTop: 0 }}>{t('kioskSurvey.title', undefined, currentLanguage)}</h2>
            {choiceGroup(
              t('kioskSurvey.affiliation', undefined, currentLanguage),
              AFFILIATION_KEYS.map(key => ({ key, label: t(`kioskSurvey.affiliation.${key}`, undefined, currentLanguage) })),
              data.affiliations, 'affiliations', 'col-sm-4 col-xs-6',
            )}
            {choiceGroup(
              t('kioskSurvey.referral', undefined, currentLanguage),
              REFERRAL_KEYS.map(key => ({ key, label: t(`kioskSurvey.referral.${key}`, undefined, currentLanguage) })),
              data.referralSources, 'referralSources', 'col-sm-4 col-xs-6',
            )}
          </>
        )
      }

      case 5: {
        const name = `${data.formData.firstName} ${data.formData.lastName}`
        return (
          <div className="text-center" style={{ padding: '2rem 0' }}>
            <div style={{
              width: 80, height: 80, borderRadius: '50%', background: '#4BB543',
              color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: '1.5rem',
            }}>
              <span className="glyphicon glyphicon-ok" style={{ fontSize: '2.5rem' }}></span>
            </div>
            <h2 className="page-header" style={{ border: 'none' }}>{t('success.title', undefined, currentLanguage)}</h2>
            <p className="lead">{t('success.desc', { name }, currentLanguage)}</p>
            <p style={{ color: '#6B7C96', fontStyle: 'italic', marginTop: '1.5rem' }}>
              {t('redirecting', { seconds: countdown }, currentLanguage)}
            </p>
            <button className="btn btn-default" onClick={resetToWelcome} style={{ marginTop: '0.5rem' }}>
              <span className="glyphicon glyphicon-chevron-left" style={{ marginRight: 6 }}></span>
              {t('returnToStart', undefined, currentLanguage)}
            </button>
          </div>
        )
      }

      default:
        return null
    }
  }

  const showNav = data.step > 0 && data.step < 5

  const navButtons = (
    <>
      <button className="btn btn-default btn-lg" onClick={prevStep}>
        <span className="glyphicon glyphicon-chevron-left" style={{ marginRight: 6 }}></span>
        {t('back', undefined, currentLanguage)}
      </button>
      <button className="btn btn-primary btn-lg" onClick={nextStep} disabled={submitting}>
        {data.step === 4
          ? t('submit', undefined, currentLanguage)
          : t('next', undefined, currentLanguage)}
        {data.step < 4 ? (
          <span className="glyphicon glyphicon-chevron-right" style={{ marginLeft: 6, fontSize: '0.9rem' }}></span>
        ) : ''}
      </button>
    </>
  )

  const alert = alertMsg && (
    <div className="alert alert-danger" role="alert" style={{ marginBottom: '1.5rem' }}>
      <span className="glyphicon glyphicon-exclamation-sign" style={{ marginRight: 6 }}></span>
      {alertMsg}
    </div>
  )

  // Tablet kiosk: the card is the whole screen. A top bar carries the
  // location and language choice (the site navigation is not shown), the step
  // scrolls in the middle, and Back / Next stay pinned to the bottom edge.
  if (fullscreen) {
    return (
      <div className="kiosk-fullscreen" id="main-content" role="main">
        <div className="kiosk-topbar">
          {/* Tapping anywhere else closes whichever menu is open. */}
          {openMenu && <div className="kiosk-menu-backdrop" onClick={() => setOpenMenu(null)} />}

          {/* The same two items as the left of the desktop navigation bar. */}
          <div className="kiosk-nav">
            <button type="button" onClick={() => navigate(auth ? '/dashboard/visitor-log' : '/dashboard/login')}>
              {t('dashboard.link', undefined, currentLanguage)}
            </button>
            <div className={`dropdown ${openMenu === 'checkin' ? 'open' : ''}`}>
              <button type="button" className="active" aria-haspopup="true" aria-expanded={openMenu === 'checkin'}
                onClick={() => toggleMenu('checkin')}>
                {t('nav.checkin', undefined, currentLanguage)}
                <span className="caret" style={{ marginLeft: 8 }}></span>
              </button>
              <ul className="dropdown-menu" style={{ display: openMenu === 'checkin' ? 'block' : 'none' }}>
                {KIOSK_LOCATIONS.map(loc => (
                  <li key={loc.id} className={location === loc.id ? 'active' : ''}>
                    {/* Keeps ?view=tablet when previewing from a desktop. */}
                    <a href={`/kiosk/${loc.id}${search}`} onClick={e => {
                      e.preventDefault()
                      navigate(`/kiosk/${loc.id}${search}`)
                      setOpenMenu(null)
                    }}>
                      {loc.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* The welcome screen already shows this as its heading. */}
          <span className="kiosk-topbar-title">{data.step > 0 && <>{locName} Check-In</>}</span>

          {/* Same dropdown as the desktop navigation bar. */}
          <div className={`dropdown kiosk-language ${openMenu === 'language' ? 'open' : ''}`}>
            <button type="button" aria-haspopup="true" aria-expanded={openMenu === 'language'}
              onClick={() => toggleMenu('language')}>
              {KIOSK_LANGUAGES.find(l => l.code === currentLanguage)?.label || 'English'}
              <span className="caret" style={{ marginLeft: 8 }}></span>
            </button>
            <ul className="dropdown-menu dropdown-menu-right" style={{ display: openMenu === 'language' ? 'block' : 'none' }}>
              {KIOSK_LANGUAGES.map(l => (
                <li key={l.code} className={currentLanguage === l.code ? 'active' : ''}>
                  <a href="#" onClick={e => {
                    e.preventDefault()
                    setLanguage(l.code)
                    setOpenMenu(null)
                  }}>
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {showNav && <div className="kiosk-progress">{stepIndicator()}</div>}

        <div className="kiosk-body">
          <div className="kiosk-body-inner">
            {alert}
            {renderStep()}
          </div>
        </div>

        {showNav && <div className="kiosk-footer">{navButtons}</div>}
      </div>
    )
  }

  return (
    <div className="layout-main" id="main-content" role="main">
      <div className="container" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
        <div className="row">
          <div className="col-sm-8 col-sm-offset-2">
            {showNav && stepIndicator()}

            {alert}

            <div className="panel panel-default" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <div className="panel-body" style={{ padding: '2.5rem' }}>
                {renderStep()}

                {showNav && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #eee',
                  }}>
                    {navButtons}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
