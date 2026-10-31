import { lazy, Suspense, type ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LangProvider } from './i18n'
import { StoreProvider, useStore } from './store'
import { PrefsProvider } from './prefs'
import { LocationProvider } from './location'
import { Skeleton, ToastProvider } from './components/ui'
import Shell from './components/Shell'
// pilgrim core: Home, Services, Crowd and Emergency ship in the main bundle so they open instantly
import HomePage from './pages/pilgrim/HomePage'
import ServicesPage from './pages/pilgrim/ServicesPage'
import CrowdPage from './pages/pilgrim/CrowdPage'
import EmergencyPage from './pages/pilgrim/EmergencyPage'

// everything else is split into chunks; the service worker precaches them, so they still work offline.
// Pilgrims never download admin code until they open it.
const MapPage = lazy(() => import('./pages/pilgrim/MapPage'))
const ParkingPage = lazy(() => import('./pages/pilgrim/ParkingPage'))
const MissingPage = lazy(() => import('./pages/pilgrim/MissingPage'))
const FamilyPage = lazy(() => import('./pages/pilgrim/FamilyPage'))
const OnboardingPage = lazy(() => import('./pages/pilgrim/OnboardingPage'))
const LoginPage = lazy(() => import('./pages/pilgrim/LoginPage'))
const ProfilePage = lazy(() => import('./pages/pilgrim/ProfilePage'))
const AlertsPage = lazy(() => import('./pages/pilgrim/AlertsPage'))
const FacilitiesPage = lazy(() => import('./pages/pilgrim/FacilitiesPage'))
const GhatsPage = lazy(() => import('./pages/pilgrim/GhatsPage'))
const PlaceDetailPage = lazy(() => import('./pages/pilgrim/PlaceDetailPage'))
const LocationsAdminPage = lazy(() => import('./pages/admin/LocationsAdminPage'))
const VideoAnalysisAdminPage = lazy(() => import('./pages/admin/VideoAnalysisAdminPage'))
const StaffPage = lazy(() => import('./pages/staff/StaffPage'))
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'))
const CrowdAdminPage = lazy(() => import('./pages/admin/CrowdAdminPage'))
const ParkingAdminPage = lazy(() => import('./pages/admin/ParkingAdminPage'))
const ReportsAdminPage = lazy(() => import('./pages/admin/ReportsAdminPage'))
const AlertsAdminPage = lazy(() => import('./pages/admin/AlertsAdminPage'))
const DevicesAdminPage = lazy(() => import('./pages/admin/DevicesAdminPage'))
const AuditAdminPage = lazy(() => import('./pages/admin/AuditAdminPage'))

function RequireRole({ min, children }: { min: 'volunteer' | 'staff' | 'admin'; children: ReactElement }) {
  const { user, token } = useStore()
  const rank = { pilgrim: 0, volunteer: 1, staff: 2, admin: 3 }
  if (token && !user) return <div className="page"><Skeleton rows={3} /></div>
  if (!user || rank[user.role] < rank[min]) return <Navigate to="/admin/login" replace />
  return children
}

const fallback = <div className="page"><Skeleton rows={4} /></div>

export default function App() {
  return (
    <PrefsProvider>
      <LangProvider>
        <StoreProvider>
          <LocationProvider>
            <ToastProvider>
              <BrowserRouter>
                <Suspense fallback={fallback}>
                  <Routes>
                    <Route path="/welcome" element={<OnboardingPage />} />
                    <Route element={<Shell />}>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/map" element={<MapPage />} />
                      <Route path="/crowd" element={<CrowdPage />} />
                      <Route path="/parking" element={<ParkingPage />} />
                      <Route path="/services" element={<ServicesPage />} />
                      <Route path="/facilities" element={<FacilitiesPage />} />
                      <Route path="/ghats" element={<GhatsPage />} />
                      <Route path="/places/:id" element={<PlaceDetailPage />} />
                      <Route path="/family" element={<FamilyPage />} />
                      <Route path="/missing" element={<MissingPage />} />
                      <Route path="/emergency" element={<EmergencyPage />} />
                      <Route path="/alerts" element={<AlertsPage />} />
                      <Route path="/profile" element={<ProfilePage />} />
                      <Route path="/more" element={<Navigate to="/profile" replace />} />
                      <Route path="/login" element={<LoginPage />} />
                      <Route path="/staff" element={<RequireRole min="volunteer"><StaffPage /></RequireRole>} />
                    </Route>
                    <Route path="/admin/login" element={<AdminLogin />} />
                    <Route path="/admin" element={<RequireRole min="volunteer"><AdminLayout /></RequireRole>}>
                      <Route index element={<DashboardPage />} />
                      <Route path="crowd" element={<CrowdAdminPage />} />
                      <Route path="parking" element={<ParkingAdminPage />} />
                      <Route path="reports" element={<ReportsAdminPage />} />
                      <Route path="alerts" element={<AlertsAdminPage />} />
                      <Route path="locations" element={<LocationsAdminPage />} />
                      <Route path="video" element={<RequireRole min="staff"><VideoAnalysisAdminPage /></RequireRole>} />
                      <Route path="devices" element={<RequireRole min="admin"><DevicesAdminPage /></RequireRole>} />
                      <Route path="audit" element={<RequireRole min="admin"><AuditAdminPage /></RequireRole>} />
                    </Route>
                    <Route path="*" element={<Navigate to="/" replace />} />
                  </Routes>
                </Suspense>
              </BrowserRouter>
            </ToastProvider>
          </LocationProvider>
        </StoreProvider>
      </LangProvider>
    </PrefsProvider>
  )
}
