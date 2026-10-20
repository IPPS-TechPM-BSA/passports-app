import { useEffect, useState } from 'react'
import { useApp } from '../../context/AppContext'
import { t } from '../../services/translations'

interface QrCardProps {
  heading: string
  url: string
  icon: string
  printNote: string
  printHeading: string
  printLabel: string
}

function QrCard({ heading, url, icon, printNote, printHeading, printLabel }: QrCardProps) {
  const openPrintView = () => {
    const w = window.open('', '_blank', 'width=400,height=600')
    if (!w) return
    w.document.write(`
      <html><head><title>${printHeading}</title>
      <style>
        body { display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; font-family: sans-serif; }
        .qr-wrap { text-align: center; padding: 2rem; }
        img { max-width: 280px; }
        p { margin-top: 1rem; font-size: 0.9rem; color: #555; word-break: break-all; }
      </style>
      </head><body>
      <div class="qr-wrap">
        <h2>${printHeading}</h2>
        <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(url)}" alt="QR Code" />
        <p>${printNote}</p>
        <p>${url}</p>
      </div>
      </body></html>
    `)
    w.document.close()
  }

  return (
    <div className="row" style={{ marginBottom: '2rem' }}>
      <div className="col-sm-6 col-sm-offset-3">
        <div className="panel panel-default" style={{ textAlign: 'center', padding: '2rem' }}>
          <div className="panel-body">
            <h3>
              <span className={`glyphicon glyphicon-${icon}`} style={{ marginRight: 8 }}></span>
              {heading}
            </h3>
            <div style={{ margin: '1.5rem 0' }}>
              {url && (
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`}
                  alt="QR Code"
                  style={{ maxWidth: '100%', height: 'auto' }}
                />
              )}
            </div>
            <p style={{ fontSize: '0.85rem', color: '#6B7C96', wordBreak: 'break-all' }}>{url}</p>
            <button className="btn btn-default" onClick={openPrintView}>
              <span className="glyphicon glyphicon-print" style={{ marginRight: 6 }}></span>
              {printLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function QrCode() {
  const { auth, currentLanguage } = useApp()
  const [baseUrl, setBaseUrl] = useState('')
  const locId = auth?.locationId || 'csc'
  const locName = locId === 'bookstore' ? 'Bookstore' : 'CSC'
  const lang = currentLanguage

  useEffect(() => {
    setBaseUrl(`${window.location.protocol}//${window.location.host}`)
  }, [])

  return (
    <>
      <h2 className="page-header">{t('qr.title', undefined, lang)}</h2>
      <p className="lead">{t('qr.desc', { location: locName }, lang)}</p>

      <QrCard
        heading={t('qr.heading', { location: locName }, lang)}
        url={baseUrl ? `${baseUrl}/mobile/${locId}` : ''}
        icon="phone"
        printHeading={`${locName} Check-In`}
        printNote="Scan to check in on your phone"
        printLabel={t('qr.print', undefined, lang)}
      />

      <QrCard
        heading={t('qr.surveyHeading', { location: locName }, lang)}
        url={baseUrl ? `${baseUrl}/feedback/${locId}` : ''}
        icon="comment"
        printHeading={`${locName} Customer Experience Form`}
        printNote="Scan to share your feedback"
        printLabel={t('qr.print', undefined, lang)}
      />
    </>
  )
}
