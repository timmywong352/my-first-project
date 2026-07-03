import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Toaster } from "@/components/ui/sonner";
import LoginPage from "@/pages/Login";
import AgentDashboard from "@/pages/AgentDashboard";
import AdminDashboard from "@/pages/AdminDashboard";
import WidgetDemo from "@/pages/WidgetDemo";
import { Loader2 } from "lucide-react";
import "@/App.css";

function ProtectedRoute({ children, adminOnly = false }) {
  const { user } = useAuth();
  if (user === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }
  if (user === false) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/dashboard" replace />;
  return children;
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<WidgetDemo />} />
            <Route path="/widget-demo" element={<WidgetDemo />} />
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/dashboard"
              element={<ProtectedRoute><AgentDashboard /></ProtectedRoute>}
            />
            <Route
              path="/admin"
              element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <Toaster position="top-right" />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
