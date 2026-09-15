import { Routes, Route } from 'react-router-dom'
import { AppProvider, useApp } from './context/AppContext'
import LayoutHeader from './components/chrome/LayoutHeader'
import Navbar from './components/chrome/Navbar'
import Footer from './components/chrome/Footer'
import LocationSelect from './components/kiosk/LocationSelect'
import KioskStepper from './components/kiosk/KioskStepper'
import LoginPage from './components/dashboard/LoginPage'
import DashboardLayout from './components/dashboard/DashboardLayout'
import VisitorLog from './components/dashboard/VisitorLog'
import FormQuestionsEditor from './components/dashboard/FormQuestionsEditor'
import SubscriberList from './components/dashboard/SubscriberList'
import Reports from './components/dashboard/Reports'
import QrCode from './components/dashboard/QrCode'

function AppShell() {
  useApp()

  return (
    <div className="app-container">
      <LayoutHeader hideOnSelect={false} />
      <Navbar />

      <Routes>
        <Route path="/" element={<LocationSelect />} />
        <Route path="/kiosk/:location" element={<KioskStepper />} />
        <Route path="/mobile/:location" element={<KioskStepper />} />
        <Route path="/dashboard/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<VisitorLog />} />
          <Route path="visitor-log" element={<VisitorLog />} />
          <Route path="questions" element={<FormQuestionsEditor />} />
          <Route path="subscribers" element={<SubscriberList />} />
          <Route path="reports" element={<Reports />} />
          <Route path="qr" element={<QrCode />} />
        </Route>
      </Routes>

      <Footer />
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
