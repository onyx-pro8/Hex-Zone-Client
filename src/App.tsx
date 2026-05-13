import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { registerGuestSessionAuthNavigate } from "./lib/guestSessionAuthRedirect";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import Navbar from "./components/Navbar";
import { Footer } from "./components/Footer";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import CreateAccount from "./pages/CreateAccount";
import DeviceManager from "./pages/DeviceManager";
import Messages from "./pages/Messages";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import ApiDocs from "./pages/ApiDocs";
import QrInvite from "./pages/QrInvite";
import JoinWithQr from "./pages/JoinWithQr";
import GuestArrival from "./pages/GuestArrival";
import GuestArrivalScan from "./pages/GuestArrivalScan";
import GuestAccess from "./pages/GuestAccess";
import GuestAccessQr from "./pages/GuestAccessQr";
import GuestPasses from "./pages/GuestPasses";
import GuestProtectedRoute from "./components/guest/GuestProtectedRoute";
import GuestDashboard from "./pages/guest/GuestDashboard";
import GuestMessages from "./pages/guest/GuestMessages";
import { AppStateProvider } from "./state/app/AppStateContext";
import { useMessageFeatureBootstrap } from "./hooks/useMessageFeatureBootstrap";

function MessageFeatureBootstrap() {
  const { token } = useAuth();
  useMessageFeatureBootstrap(token);
  return null;
}

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function AppMain() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    registerGuestSessionAuthNavigate(navigate);
    return () => registerGuestSessionAuthNavigate(null);
  }, [navigate]);
  const guestWideLayout = pathname.startsWith("/guest/");
  const dashboardFullBleed = pathname === "/dashboard";
  return (
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
          path="/members"
          element={
            <ProtectedRoute>
              <Members />
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
    </main>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <MessageFeatureBootstrap />
        <div className="min-h-screen bg-slate-950 text-slate-100 flex min-w-0 flex-col overflow-x-hidden">
          <Navbar />
          <AppMain />
          <Footer />
        </div>
      </AppStateProvider>
    </AuthProvider>
  );
}
