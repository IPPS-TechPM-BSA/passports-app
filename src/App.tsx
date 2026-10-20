import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import LayoutHeader from './components/chrome/LayoutHeader'
import Navbar from './components/chrome/Navbar'
import Footer from './components/chrome/Footer'
import { loadKioskLocation } from './services/kioskLocation'
import { useKioskFullscreen } from './hooks/useKioskFullscreen'
import KioskStepper from './components/kiosk/KioskStepper'
import LoginPage from './components/dashboard/LoginPage'
import DashboardLayout from './components/dashboard/DashboardLayout'
import VisitorLog from './components/dashboard/VisitorLog'
import FormQuestionsEditor from './components/dashboard/FormQuestionsEditor'
import SurveyQuestionsEditor from './components/dashboard/SurveyQuestionsEditor'
import CustomerExperienceLog from './components/dashboard/CustomerExperienceLog'
import Reports from './components/dashboard/Reports'
import QrCode from './components/dashboard/QrCode'
import CustomerExperienceForm from './components/kiosk/CustomerExperienceForm'

// Keyed by location so switching between CSC and Bookstore starts a fresh
// check-in at the welcome screen instead of carrying a half-filled form over.
function KioskRoute() {
  const { location } = useParams<{ location: string }>()
  return <KioskStepper key={location} />
}

function AppShell() {
  useApp()
  // On a tablet the check-in card is the whole screen: no site chrome.
  const kioskFullscreen = useKioskFullscreen()

  return (
    <div className="app-container">
      {!kioskFullscreen && <LayoutHeader hideOnSelect={false} />}
      {!kioskFullscreen && <Navbar />}

      <Routes>
        {/* There is no home page: the site opens on the check-in kiosk for
            the location this browser last used (CSC by default). */}
        <Route path="/" element={<Navigate to={`/kiosk/${loadKioskLocation()}`} replace />} />
        <Route path="/kiosk/:location" element={<KioskRoute />} />
        <Route path="/mobile/:location" element={<KioskRoute />} />
        <Route path="/feedback/:location" element={<CustomerExperienceForm />} />
        <Route path="/dashboard/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<VisitorLog />} />
          <Route path="visitor-log" element={<VisitorLog />} />
          <Route path="questions" element={<FormQuestionsEditor />} />
          <Route path="survey" element={<SurveyQuestionsEditor />} />
          <Route path="experience-log" element={<CustomerExperienceLog />} />
          <Route path="reports" element={<Reports />} />
          <Route path="qr" element={<QrCode />} />
        </Route>
      </Routes>

      {!kioskFullscreen && <Footer />}
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}
