import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { fetchMe, loadSession, setSignedOutHandler, signOut, type User } from "./lib/api";
import { AuthProvider, Shell } from "./components/Shell";
import { Loading } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Register from "./pages/Register";
import { RegistrationDetail, Registrations } from "./pages/Registrations";
import EventDays from "./pages/EventDays";
import Staff from "./pages/Staff";
import Duplicates from "./pages/Duplicates";
import Giveaway from "./pages/Giveaway";
import Winners from "./pages/Winners";
import Photos from "./pages/Photos";
import Reports from "./pages/Reports";
import Activity from "./pages/Activity";
import System from "./pages/System";
import Present from "./pages/Present";
import NotFound from "./pages/NotFound";

function AdminOnly({ user, children }: { user: User; children: React.ReactNode }) {
  return user.role === "admin" ? <>{children}</> : <Navigate to="/register" replace />;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(() => loadSession() !== null);
  const [notice, setNotice] = useState("");

  const handleSignedOut = useCallback(() => {
    setUser(null);
    setNotice("Your session has ended. Please sign in again.");
  }, []);

  useEffect(() => {
    setSignedOutHandler(handleSignedOut);
    if (!loadSession()) return;
    fetchMe()
      .then(setUser)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [handleSignedOut]);

  return (
    <BrowserRouter>
      <Routes>
        {/* The projector page handles its own sign-in state (admin session or read-only ?t= link). */}
        <Route path="/present" element={<Present />} />
        <Route path="*" element={<Protected />} />
      </Routes>
    </BrowserRouter>
  );

  function Protected() {
    if (checking) return <Loading />;
    if (!user) {
      return (
        <Login
          notice={notice}
          onSignedIn={(u) => {
            setNotice("");
            setUser(u);
          }}
        />
      );
    }
    const home = user.role === "admin" ? <Dashboard /> : <Navigate to="/register" replace />;
    return (
      <AuthProvider value={{ user, signOut: () => void signOut().finally(() => setUser(null)) }}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={home} />
            <Route path="register" element={<Register />} />
            <Route path="registrations" element={<Registrations />} />
            <Route path="registrations/:id" element={<RegistrationDetail />} />
            <Route path="event-days" element={<AdminOnly user={user}><EventDays /></AdminOnly>} />
            <Route path="staff" element={<AdminOnly user={user}><Staff /></AdminOnly>} />
            <Route path="duplicates" element={<AdminOnly user={user}><Duplicates /></AdminOnly>} />
            <Route path="giveaway" element={<AdminOnly user={user}><Giveaway /></AdminOnly>} />
            <Route path="winners" element={<AdminOnly user={user}><Winners /></AdminOnly>} />
            <Route path="photos" element={<AdminOnly user={user}><Photos /></AdminOnly>} />
            <Route path="reports" element={<AdminOnly user={user}><Reports /></AdminOnly>} />
            <Route path="activity" element={<AdminOnly user={user}><Activity /></AdminOnly>} />
            <Route path="system" element={<AdminOnly user={user}><System /></AdminOnly>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    );
  }
}
