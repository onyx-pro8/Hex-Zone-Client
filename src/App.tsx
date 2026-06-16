import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { registerGuestSessionAuthNavigate } from "./lib/guestSessionAuthRedirect";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Navbar from "./components/Navbar";
import { Footer } from "./components/Footer";
import { Sidebar } from "./components/layout/Sidebar";
import { AppHeader } from "./components/layout/AppHeader";
import { PageCard } from "./components/layout/PageCard";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import CreateAccount from "./pages/CreateAccount";
import DeviceManager from "./pages/DeviceManager";
import Messages from "./pages/Messages";
import Settings from "./pages/Settings";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import EmergencyLog from "./pages/EmergencyLog";
import ApiDocs from "./pages/ApiDocs";
import QrInvite from "./pages/QrInvite";
import JoinWithQr from "./pages/JoinWithQr";
import GuestArrival from "./pages/GuestArrival";
import GuestArrivalScan from "./pages/GuestArrivalScan";
import GuestAccess from "./pages/GuestAccess";
import GuestAccessQr from "./pages/GuestAccessQr";
import GuestArrivalMessagesAdmin from "./pages/GuestArrivalMessagesAdmin";
import GuestPasses from "./pages/GuestPasses";
import GuestProtectedRoute from "./components/guest/GuestProtectedRoute";
import GuestDashboard from "./pages/guest/GuestDashboard";
import GuestMessages from "./pages/guest/GuestMessages";
import { AppStateProvider } from "./state/app/AppStateContext";
import { useMessageFeatureBootstrap } from "./hooks/useMessageFeatureBootstrap";
import { useLocationSync } from "./hooks/useLocationSync";
import { AlarmNotificationsHost } from "./components/AlarmNotificationsHost";

function MessageFeatureBootstrap() {
  const { token } = useAuth();
  useMessageFeatureBootstrap(token);
  return null;
}

function LocationSync() {
  const { token } = useAuth();
  useLocationSync(token);
  return null;
}

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

const MEMBER_SHELL_PATHS = new Set([
  "/dashboard",
  "/messages",
  "/members",
  "/emergency-log",
  "/settings",
  "/devices",
  "/guest-passes",
  "/guest-arrival-messages",
  "/guest-access-qr",
  "/qr",
  "/api",
]);

function RoutesView() {
  return (
    <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/access" element={<GuestAccess />} />
        <Route
          path="/guest/dashboard"
          element={
            <GuestProtectedRoute>
              <GuestDashboard />
            </GuestProtectedRoute>
          }
        />
        <Route
          path="/guest/messages"
          element={
            <GuestProtectedRoute>
              <GuestMessages />
            </GuestProtectedRoute>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<CreateAccount />} />
        <Route path="/join" element={<JoinWithQr />} />
        <Route path="/guest-arrival/scan" element={<GuestArrivalScan />} />
        <Route path="/guest-arrival" element={<GuestArrival />} />
        <Route path="/api" element={<ApiDocs />} />
        <Route
          path="/devices"
          element={
            <ProtectedRoute>
              <DeviceManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/messages"
          element={
            <ProtectedRoute>
              <Messages />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/members"
          element={
            <ProtectedRoute>
              <Members />
            </ProtectedRoute>
          }
        />
        <Route
          path="/emergency-log"
          element={
            <ProtectedRoute>
              <EmergencyLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/qr"
          element={
            <ProtectedRoute>
              <QrInvite />
            </ProtectedRoute>
          }
        />
        <Route
          path="/guest-access-qr"
          element={
            <ProtectedRoute>
              <GuestAccessQr />
            </ProtectedRoute>
          }
        />
        <Route
          path="/guest-arrival-messages"
          element={
            <ProtectedRoute>
              <GuestArrivalMessagesAdmin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/guest-passes"
          element={
            <ProtectedRoute>
              <GuestPasses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
  );
}

function Shell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = useAuth();
  useEffect(() => {
    registerGuestSessionAuthNavigate(navigate);
    return () => registerGuestSessionAuthNavigate(null);
  }, [navigate]);

  const useMemberShell = Boolean(token) && MEMBER_SHELL_PATHS.has(pathname);

  if (useMemberShell) {
    const contentFullBleed = pathname === "/dashboard";
    return (
      <div className="flex min-h-screen bg-[#F3F7FD] text-[#0F2C5C]">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col md:pl-64">
          <AppHeader />
          <main
            className={[
              "min-w-0 flex-1 overflow-x-hidden",
              contentFullBleed
                ? ""
                : "px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8",
            ].join(" ")}
          >
            {contentFullBleed ? (
              <RoutesView />
            ) : (
              <PageCard>
                <RoutesView />
              </PageCard>
            )}
          </main>
        </div>
      </div>
    );
  }

  const guestWideLayout = pathname.startsWith("/guest/");
  const dashboardFullBleed = pathname === "/dashboard";
  return (
    <div className="flex min-h-screen min-w-0 flex-col overflow-x-hidden bg-[#F3F7FD] text-[#0F2C5C]">
      <Navbar />
      <main
        className={[
          "mx-auto flex-1 pt-28",
          dashboardFullBleed
            ? "w-full min-w-0 max-w-none px-0"
            : guestWideLayout
              ? "w-full min-w-0 max-w-none px-4 sm:px-6 lg:px-10"
              : "max-w-7xl px-5",
        ].join(" ")}
      >
        <RoutesView />
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <MessageFeatureBootstrap />
        <LocationSync />
        <AlarmNotificationsHost />
        <Shell />
      </AppStateProvider>
    </AuthProvider>
  );
}
