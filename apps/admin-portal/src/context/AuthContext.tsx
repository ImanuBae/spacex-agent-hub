"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { UserRole } from "../../lib/roles";
export interface SessionUser { id: string; email: string; name: string; role: UserRole; branchIds: string[]; active: boolean; }
interface AuthState { user: SessionUser | null; loading: boolean; error: string; reload: () => Promise<void>; }
const Context = createContext<AuthState | null>(null);
async function fetchSession(): Promise<SessionUser | null> {
  const response = await fetch("/api/session/me", { cache: "no-store" });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Không xác minh được phiên đăng nhập. Vui lòng thử lại.");
  return (await response.json()).data;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      const response = await fetch("/api/session/me", { cache: "no-store" });
      if (response.status === 401) { setUser(null); setError(""); return; }
      if (!response.ok) throw new Error("Không xác minh được phiên đăng nhập. Vui lòng thử lại.");
      setUser((await response.json()).data); setError("");
    } catch (e) { setUser(null); setError(e instanceof Error ? e.message : "Lỗi kết nối"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void fetchSession().then(value => { setUser(value); setError(""); }).catch(e => { setUser(null); setError(e.message); }).finally(() => setLoading(false));
    const timer = setInterval(() => { void reload(); }, 30000);
    const expired = () => { void reload(); };
    window.addEventListener("hub:unauthorized", expired);
    window.addEventListener("focus", expired);
    return () => { clearInterval(timer); window.removeEventListener("hub:unauthorized", expired); window.removeEventListener("focus", expired); };
  }, [reload]);
  return <Context.Provider value={{ user, loading, error, reload }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("AuthProvider required");
  return context;
}
