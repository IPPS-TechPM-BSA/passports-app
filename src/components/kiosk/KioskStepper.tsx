import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'
import { api } from '../../services/api'
import { useIdleTimer } from '../../hooks/useIdleTimer'

type VisitType = 'appointment' | 'walk-in' | 'returning'
type ServiceType = 'passports' | 'notary' | 'photo-only' | null
type PhotoFormat = 'digital' | 'both' | 'printed' | null

interface KioskData {
  step: number
  visitType: VisitType
  serviceType: ServiceType
  photoFormat: PhotoFormat
  appComplete: boolean | null
  formData: {
    firstName: string
    lastName: string
    email: string
    phone: string
    partySize: string
  }
  checklist: {
    photo: boolean | null
    citizenship: boolean | null
    id: boolean | null
    payment: boolean | null
  }
}

const INITIAL_DATA: KioskData = {
  step: 0,
  visitType: 'appointment',
  serviceType: null,
  photoFormat: null,
  appComplete: null,
  formData: { firstName: '', lastName: '', email: '', phone: '', partySize: '' },
  checklist: { photo: null, citizenship: null, id: null, payment: null },
}

const STEP_LABELS = ['Welcome', 'Visit Type', 'Contact', 'Document', 'Complete']

interface ChecklistQuestion {
  title: string
  description: string
}

interface ChecklistQuestions {
  [key: string]: ChecklistQuestion
}

const DEFAULT_CHECKLIST_QUESTIONS: ChecklistQuestions = {
  photo: { title: 'Passport Photo', description: 'Do you have a 2x2 inch color photo taken within the last 6 months?' },
  citizenship: { title: 'Proof of Citizenship', description: 'Do you have a certified birth certificate or naturalization certificate?' },
  id: { title: 'Photo Identification', description: "Do you have a valid driver's license or government-issued ID?" },
  payment: { title: 'Form of Payment', description: 'Do you have a credit card, check, or money order for processing fees?' },
}

export default function KioskStepper() {
  const { location } = useParams<{ location: string }>()
  const navigate = useNavigate()
  const { currentLanguage, setKioskLocation } = useApp()
  const [data, setData] = useState<KioskData>(INITIAL_DATA)
  const [submitted, setSubmitted] = useState(false)
  const [countdown, setCountdown] = useState(10)
  const [alertMsg, setAlertMsg] = useState('')
  const [checklistQuestions, setChecklistQuestions] = useState<ChecklistQuestions>(DEFAULT_CHECKLIST_QUESTIONS)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const locName = location === 'bookstore' ? 'Bookstore' : 'CSC'

  useEffect(() => {
    if (location) setKioskLocation(location as 'csc' | 'bookstore')
  }, [location, setKioskLocation])

  useEffect(() => {
    const fetchQs = async () => {
      try {
        const data = await api.getQuestions() as ChecklistQuestions
        if (data && Object.keys(data).length) setChecklistQuestions(data)
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

  const setChecklist = (field: string, value: boolean) => {
    setData(prev => ({ ...prev, checklist: { ...prev.checklist, [field]: value } }))
  }

  // Decorator 5's .btn-primary is styled for large CTAs (min-width: 200px,
  // bold uppercase, big padding). Coloring via inline style instead of
  // swapping to that class keeps these toggle buttons a fixed size.
  const yesNoBtnStyle = (selected: boolean) => ({
    padding: '5px 10px',
    fontSize: 12,
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

  const validateContact = (): boolean => {
    setAlertMsg('')
    const fd = data.formData
    if (!fd.firstName || !fd.lastName || !fd.phone || !fd.partySize) {
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
    if (data.serviceType === 'photo-only' && !fd.email.trim()) {
      setAlertMsg(t('required.email', undefined, currentLanguage))
      return false
    }
    if (fd.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fd.email.trim())) {
      setAlertMsg(t('invalid.email', undefined, currentLanguage))
      return false
    }
    if (data.visitType !== 'returning' && !data.serviceType) {
      setAlertMsg(t('select.service', undefined, currentLanguage))
      return false
    }
    return true
  }

  const validateChecklist = (): boolean => {
    setAlertMsg('')
    if (data.serviceType === 'photo-only') {
      if (!data.photoFormat) {
        setAlertMsg(t('select.photoFormat', undefined, currentLanguage))
        return false
      }
      return true
    }
    if (data.appComplete === null) {
      setAlertMsg(t('confirm.appComplete', undefined, currentLanguage))
      return false
    }
    if (data.appComplete === false) return true
    if (data.checklist.photo === null || data.checklist.citizenship === null ||
        data.checklist.id === null || data.checklist.payment === null) {
      setAlertMsg(t('confirm.checklist', undefined, currentLanguage))
      return false
    }
    return true
  }

  const submitCheckIn = async () => {
    const checklistJson = data.serviceType === 'passports'
      ? JSON.stringify(data.checklist)
      : null

    try {
      await api.checkin({
        location_id: location || 'csc',
        first_name: data.formData.firstName,
        last_name: data.formData.lastName,
        email: data.formData.email || null,
        phone: data.formData.phone,
        party_size: parseInt(data.formData.partySize, 10),
        visit_type: data.visitType,
        service_type: data.serviceType,
        photo_format: data.serviceType === 'photo-only' ? data.photoFormat : null,
        app_complete: data.serviceType === 'passports' ? data.appComplete : null,
        checklist: checklistJson,
      })
      setData(prev => ({ ...prev, step: 4 }))
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
      setAlertMsg('Check-in failed. Please try again.')
    }
  }

  const nextStep = () => {
    setAlertMsg('')
    if (data.step === 0) { set({ step: 1 }); return }
    if (data.step === 1) { set({ step: 2 }); return }
    if (data.step === 2) {
      if (!validateContact()) return
      if (data.visitType === 'returning' || data.serviceType === 'notary') {
        submitCheckIn()
        return
      }
      set({ step: 3 })
      return
    }
    if (data.step === 3) {
      if (!validateChecklist()) return
      submitCheckIn()
    }
  }

  const prevStep = () => {
    setAlertMsg('')
    if (data.step > 0) set({ step: data.step - 1 })
  }

  useEffect(() => {
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  const stepIndicator = () => {
    const steps = [0, 1, 2, 3]
    const active = data.step >= 4 ? 3 : data.step
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
            <h1 className="page-header" style={{ border: 'none', marginBottom: 0 }}>
              Passports
            </h1>
            <p className="lead" style={{ marginBottom: '2rem' }}>
              {t('kiosk.subwelcome', undefined, currentLanguage)}
            </p>
            <button className="btn btn-primary btn-lg" onClick={nextStep}
              style={{ padding: '1rem 4rem', fontSize: '1.3rem' }}>
              {t('kiosk.start', undefined, currentLanguage)}
              <span className="glyphicon glyphicon-chevron-right" style={{ marginLeft: 8, fontSize: '0.9rem' }}></span>
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
                    style={{ cursor: 'pointer', textAlign: 'center' }}
                    onClick={() => set({ visitType: vt.key })}
                    role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') set({ visitType: vt.key }) }}
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
            <div
              className={`panel ${data.visitType === 'returning' ? 'panel-primary' : 'panel-default'}`}
              style={{ cursor: 'pointer', textAlign: 'center', marginBottom: 0 }}
              onClick={() => set({ visitType: 'returning' })}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') set({ visitType: 'returning' }) }}
            >
              <div className="panel-body" style={{ padding: '1.5rem' }}>
                <span className="glyphicon glyphicon-question-sign"
                  style={{ fontSize: '1.5rem', marginRight: '0.5rem', verticalAlign: 'middle' }}></span>
                {t('step1.returning', undefined, currentLanguage)}
              </div>
            </div>
          </>
        )
      }

      case 2: {
        const showServices = data.visitType !== 'returning'
        const services: { key: ServiceType; icon: string; label: string }[] = [
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
                  <label className="control-label">{t('step2.firstName', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="text" className="form-control input-lg"
                    value={data.formData.firstName}
                    onChange={e => updateFormData('firstName', e.target.value)} />
                </div>
              </div>
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label">{t('step2.lastName', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="text" className="form-control input-lg"
                    value={data.formData.lastName}
                    onChange={e => updateFormData('lastName', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label">{t('step2.phone', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="tel" className="form-control input-lg"
                    value={data.formData.phone}
                    onChange={e => updateFormData('phone', e.target.value)} />
                </div>
              </div>
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label">
                    {t('step2.email', undefined, currentLanguage)}
                    {data.serviceType === 'photo-only' && <span style={{ color: '#E05D5D' }}> *</span>}
                  </label>
                  <input type="email" className="form-control input-lg"
                    value={data.formData.email}
                    onChange={e => updateFormData('email', e.target.value)} />
                </div>
              </div>
            </div>

            <div className="row">
              <div className="col-sm-6">
                <div className="form-group">
                  <label className="control-label">{t('step2.partySize', undefined, currentLanguage)} <span style={{ color: '#E05D5D' }}>*</span></label>
                  <input type="number" inputMode="numeric" min={1} step={1}
                    className="form-control input-lg"
                    value={data.formData.partySize}
                    onChange={e => updateFormData('partySize', e.target.value.replace(/\D/g, ''))} />
                </div>
              </div>
            </div>

            {showServices && (
              <>
                <h3 style={{ marginTop: '2rem', marginBottom: '1rem', color: '#182B49' }}>
                  {t('service.title', undefined, currentLanguage)}
                </h3>
                <div className="row">
                  {services.map(sv => (
                    <div key={sv.key} className="col-sm-4" style={{ marginBottom: '1rem' }}>
                      <div
                        className={`panel ${data.serviceType === sv.key ? 'panel-primary' : 'panel-default'}`}
                        style={{ cursor: 'pointer', textAlign: 'center' }}
                        onClick={() => set({ serviceType: sv.key })}
                        role="button" tabIndex={0}
                        onKeyDown={e => { if (e.key === 'Enter') set({ serviceType: sv.key }) }}
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
              </>
            )}
          </>
        )
      }

      case 3:
        if (data.serviceType === 'photo-only') {
          const formats: { key: PhotoFormat; icon: string; label: string }[] = [
            { key: 'digital', icon: 'hdd', label: t('photo.digital', undefined, currentLanguage) },
            { key: 'both', icon: 'refresh', label: t('photo.both', undefined, currentLanguage) },
            { key: 'printed', icon: 'picture', label: t('photo.printed', undefined, currentLanguage) },
          ]
          return (
            <>
              <h2 className="page-header" style={{ border: 'none', marginTop: 0 }}>{t('photo.format.title', undefined, currentLanguage)}</h2>
              <div className="row">
                {formats.map(pf => (
                  <div key={pf.key} className="col-sm-4" style={{ marginBottom: '1rem' }}>
                    <div
                      className={`panel ${data.photoFormat === pf.key ? 'panel-primary' : 'panel-default'}`}
                      style={{ cursor: 'pointer', textAlign: 'center' }}
                      onClick={() => set({ photoFormat: pf.key })}
                      role="button" tabIndex={0}
                      onKeyDown={e => { if (e.key === 'Enter') set({ photoFormat: pf.key }) }}
                    >
                      <div className="panel-body" style={{ padding: '2rem 0.5rem' }}>
                        <span className={`glyphicon glyphicon-${pf.icon}`}
                          style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.5rem' }}></span>
                        {pf.label}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )
        }

        return (
          <>
            <h2 className="page-header" style={{ border: 'none', marginTop: 0 }}>{t('step3.title', undefined, currentLanguage)}</h2>
            <p className="lead" style={{ marginTop: '-0.5rem' }}>{t('step3.desc', undefined, currentLanguage)}</p>

            <div className={`panel ${data.appComplete === null ? 'panel-default' : data.appComplete === false ? 'panel panel-default' : 'panel-success'}`}
              style={{ borderLeft: data.appComplete === false ? '6px solid #E05D5D' : data.appComplete === true ? '6px solid #4BB543' : 'none' }}>
              <div className="panel-body">
                <div className="row">
                  <div className="col-sm-8">
                    <strong style={{ fontSize: '1.05rem' }}>{t('step3.appComplete', undefined, currentLanguage)}</strong>
                  </div>
                  <div className="col-sm-4 text-right">
                    <div className="btn-group">
                      <button className="btn btn-sm" style={yesNoBtnStyle(data.appComplete === true)}
                        onClick={() => { set({ appComplete: true }) }}>
                        <span className="glyphicon glyphicon-ok" style={{ marginRight: 4 }}></span>
                        {t('yes', undefined, currentLanguage)}
                      </button>
                      <button className="btn btn-sm" style={yesNoBtnStyle(data.appComplete === false)}
                        onClick={() => { set({ appComplete: false, checklist: { photo: null, citizenship: null, id: null, payment: null } }) }}>
                        <span className="glyphicon glyphicon-remove" style={{ marginRight: 4 }}></span>
                        {t('no', undefined, currentLanguage)}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {data.appComplete === true && ['photo', 'citizenship', 'id', 'payment'].map(field => {
              const val = data.checklist[field as keyof typeof data.checklist]
              const question = checklistQuestions[field] ?? DEFAULT_CHECKLIST_QUESTIONS[field]
              return (
                <div key={field} className="panel panel-default"
                  style={{ borderLeft: val === false ? '6px solid #E05D5D' : 'none' }}>
                  <div className="panel-body">
                    <div className="row">
                      <div className="col-sm-8">
                        <strong>{question.title}</strong>
                        <p style={{ margin: '0.25rem 0 0', color: '#6B7C96' }}>{question.description}</p>
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
        const incomplete = data.serviceType === 'passports' && data.appComplete === false
        const name = `${data.formData.firstName} ${data.formData.lastName}`
        return (
          <div className="text-center" style={{ padding: '2rem 0' }}>
            {!incomplete && (
              <div style={{
                width: 80, height: 80, borderRadius: '50%', background: '#4BB543',
                color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '1.5rem',
              }}>
                <span className="glyphicon glyphicon-ok" style={{ fontSize: '2.5rem' }}></span>
              </div>
            )}
            {incomplete ? (
              <>
                <h2 className="page-header" style={{ border: 'none' }}>
                  {t('incomplete.thankYou', { name }, currentLanguage)}
                </h2>
                <div className="alert alert-warning" style={{ maxWidth: 500, margin: '1rem auto' }}>
                  <span className="glyphicon glyphicon-warning-sign" style={{ marginRight: 6 }}></span>
                  {t('incomplete.action', undefined, currentLanguage)}
                </div>
              </>
            ) : (
              <>
                <h2 className="page-header" style={{ border: 'none' }}>{t('success.title', undefined, currentLanguage)}</h2>
                <p className="lead">{t('success.desc', { name }, currentLanguage)}</p>
              </>
            )}
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

  return (
    <div className="layout-main" id="main-content" role="main">
      <div className="container" style={{ paddingTop: '2rem', paddingBottom: '3rem' }}>
        <ol className="breadcrumb breadcrumbs-list" aria-label="Breadcrumb">
          <li><a href="/" onClick={e => { e.preventDefault(); navigate('/') }}>Home</a></li>
          <li className="active">Check-In @ {locName}</li>
        </ol>

        <div className="row">
          <div className="col-sm-8 col-sm-offset-2">
            {data.step > 0 && data.step < 4 && stepIndicator()}

            {alertMsg && (
              <div className="alert alert-danger" role="alert" style={{ marginBottom: '1.5rem' }}>
                <span className="glyphicon glyphicon-exclamation-sign" style={{ marginRight: 6 }}></span>
                {alertMsg}
              </div>
            )}

            <div className="panel panel-default" style={{ boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
              <div className="panel-body" style={{ padding: '2.5rem' }}>
                {renderStep()}

                {data.step > 0 && data.step < 4 && (
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid #eee',
                  }}>
                    <button className="btn btn-default btn-lg" onClick={prevStep}>
                      <span className="glyphicon glyphicon-chevron-left" style={{ marginRight: 6 }}></span>
                      {t('back', undefined, currentLanguage)}
                    </button>
                    <button className="btn btn-primary btn-lg" onClick={nextStep}>
                      {data.step === 3 || (data.step === 2 && (data.visitType === 'returning' || data.serviceType === 'notary'))
                        ? t('submit', undefined, currentLanguage)
                        : t('next', undefined, currentLanguage)}
                      {data.step < 3 ? (
                        <span className="glyphicon glyphicon-chevron-right" style={{ marginLeft: 6, fontSize: '0.9rem' }}></span>
                      ) : ''}
                    </button>
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
