import { createContext, useContext } from "react";
import { NavLink, Outlet } from "react-router-dom";
import type { User } from "../lib/api";
import { Logo } from "./ui";

const AuthCtx = createContext<{ user: User; signOut: () => void } | null>(null);
export const AuthProvider = AuthCtx.Provider;
export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}

const STAFF_NAV = [
  { to: "/register", label: "Register" },
  { to: "/registrations", label: "My registrations" },
];
const ADMIN_NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/register", label: "Register" },
  { to: "/registrations", label: "Registrations" },
  { to: "/event-days", label: "Event days" },
  { to: "/staff", label: "Staff" },
  { to: "/duplicates", label: "Duplicates" },
  { to: "/giveaway", label: "Giveaway" },
  { to: "/winners", label: "Winners" },
  { to: "/photos", label: "Photos" },
  { to: "/reports", label: "Reports" },
  { to: "/activity", label: "Activity" },
  { to: "/system", label: "System" },
];

export function Shell() {
  const { user, signOut } = useAuth();
  const nav = user.role === "admin" ? ADMIN_NAV : STAFF_NAV;
  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between gap-3 py-4">
        <div className="flex items-center gap-3">
          <Logo imgClass="h-11 w-auto max-w-[7rem]" />
          <div>
            <p className="font-display text-lg font-bold leading-tight">GUC TCS</p>
            <p className="text-[10px] uppercase tracking-[0.25em] text-gold-400">15th Anniversary</p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-right">
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-tight">{user.full_name}</p>
            <p className="text-[11px] text-white/50">{user.role === "admin" ? "Administrator" : "Media staff"}</p>
          </div>
          <button onClick={signOut} className="min-h-11 rounded-lg border border-white/15 px-3 text-sm hover:border-gold-400">
            Sign out
          </button>
        </div>
      </header>
      <nav aria-label="Main" className="-mx-4 mb-6 flex gap-1 overflow-x-auto border-y border-white/10 px-4 py-2 sm:mx-0 sm:rounded-xl sm:border sm:px-2">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={"end" in n}
            className={({ isActive }) =>
              `whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${isActive ? "bg-gold-500 font-semibold text-ink-950" : "text-white/70 hover:text-white"}`
            }
          >
            {n.label}
          </NavLink>
        ))}
        {user.role === "admin" && (
          <a href="/present" target="_blank" rel="noreferrer" className="ml-auto whitespace-nowrap rounded-lg px-3 py-2 text-sm text-gold-400 hover:text-gold-300">
            Open projector ↗
          </a>
        )}
      </nav>
      <Outlet />
    </div>
  );
}
