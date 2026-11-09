import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { todayISO } from "@/lib/dates";
import { errorMessage } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { loadWorkspace } from "@/services/data";
import { syncRecurrences } from "@/services/sync";
import type { FinanceData, Profile } from "@/types/models";

const empty: FinanceData = { accounts: [], categories: [], cards: [], transactions: [], recurrences: [], invoices: [], goals: [], contributions: [] };

interface FinanceValue {
  loading: boolean;
  error: string | null;
  data: FinanceData;
  profile: Profile | null;
  refresh: () => Promise<void>;
  today: string;
}

const FinanceContext = createContext<FinanceValue>({
  loading: true,
  error: null,
  data: empty,
  profile: null,
  refresh: async () => undefined,
  today: todayISO(),
});

export function FinanceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<FinanceData>(empty);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  const today = todayISO();

  const refresh = useCallback(async () => {
    if (!session?.user.id) return;
    if (!ready) setLoading(true);
    try {
      let workspace = await loadWorkspace(session.user.id);
      try {
        const created = await syncRecurrences(workspace.data, today);
        if (created > 0) {
          workspace = await loadWorkspace(session.user.id);
          toast(`${created} lançamento(s) recorrente(s) foram preparados até os próximos 12 meses.`);
        }
      } catch (syncError) {
        toast(errorMessage(syncError, "Não consegui atualizar as recorrências."), "error");
      }
      setData(workspace.data);
      setProfile(workspace.profile);
      setError(null);
      setReady(true);
    } catch (loadError) {
      const message = errorMessage(loadError);
      if (!ready) setError(message);
      else toast(message, "error");
    } finally {
      setLoading(false);
    }
  }, [ready, session?.user.id, today, toast]);

  useEffect(() => {
    void refresh();
  }, [session?.user.id]);

  const value = useMemo(() => ({ loading: loading && !ready, error, data, profile, refresh, today }), [loading, ready, error, data, profile, refresh, today]);
  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

export function useFinance() {
  return useContext(FinanceContext);
}
