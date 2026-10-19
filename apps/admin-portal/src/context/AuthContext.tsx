// apps/admin-portal/src/context/AuthContext.tsx
"use client";

import React, { createContext, useContext, useState } from "react";
import type { Role } from "@/types/roles";

interface AuthContextType {
  role: Role;
  setRole: (role: Role) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    if (typeof window === "undefined") {
      return "center_director";
    }
    return (localStorage.getItem("mock_user_role") as Role) || "center_director";
  });

  const setRole = (newRole: Role) => {
    setRoleState(newRole);
    localStorage.setItem("mock_user_role", newRole);
  };

  return (
    <AuthContext.Provider value={{ role, setRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth phải được sử dụng trong AuthProvider");
  }
  return context;
}
