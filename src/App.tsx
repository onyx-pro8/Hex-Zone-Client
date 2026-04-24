import { Navigate, Route, Routes } from "react-router-dom";
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
import { AppStateProvider } from "./state/app/AppStateContext";

function ProtectedRoute({ children }: { children: JSX.Element }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <AppStateProvider>
        <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
          <Navbar />
          <main className="mx-auto max-w-7xl px-5 pt-28 flex-1">
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<CreateAccount />} />
              <Route path="/join" element={<JoinWithQr />} />
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
          <Footer />
        </div>
      </AppStateProvider>
    </AuthProvider>
  );
}
