"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type UserContextValue = {
  user: User | null;
  tenantId: string | null;
  loading: boolean;
};

const UserContext = createContext<UserContextValue>({
  user: null,
  tenantId: null,
  loading: true,
});

export function UserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null);
      if (data.user) {
        fetch("/api/bootstrap")
          .then((r) => (r.ok ? r.json() : null))
          .then((d: { tenantId?: string } | null) => {
            setTenantId(d?.tenantId ?? null);
          })
          .finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user ?? null);
        if (session?.user) {
          fetch("/api/bootstrap")
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { tenantId?: string } | null) => {
              setTenantId(d?.tenantId ?? null);
            });
        } else {
          setTenantId(null);
        }
      },
    );

    return () => listener.subscription.unsubscribe();
  }, []);

  return (
    <UserContext.Provider value={{ user, tenantId, loading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
