import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { FinanceProvider } from "@/context/FinanceContext";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "@/pages/AuthPages";
import { AdminPage } from "@/pages/AdminPage";
import { AssistantPage } from "@/pages/AssistantPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { CardsPage, CardDetailPage } from "@/pages/CardsPage";
import { BillsPage } from "@/pages/BillsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ExpensePage, IncomePage } from "@/pages/EntryPage";
import { GoalsPage } from "@/pages/GoalsPage";
import { HouseholdPage } from "@/pages/HouseholdPage";
import { HelpPage } from "@/pages/HelpPage";
import { ImportPage } from "@/pages/ImportPage";
import { RecurrencesPage } from "@/pages/RecurrencesPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { TrashPage } from "@/pages/TrashPage";
import { SimulatorPage } from "@/pages/SimulatorPage";
import type { ReactNode } from "react";

function Private({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted">Carregando sua sessão...</div>;
  if (!session) return <Navigate to="/entrar" replace />;
  return children;
}

function LegacyEntries() {
  const [params] = useSearchParams();
  const income = params.get("tipo") === "income";
  const next = new URLSearchParams();
  if (params.get("novo") === "1") next.set("novo", "1");
  const query = next.toString();
  return <Navigate to={`${income ? "/receitas" : "/despesas"}${query ? `?${query}` : ""}`} replace />;
}

function Guest({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted">Carregando sua sessão...</div>;
  if (session) return <Navigate to="/" replace />;
  return children;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/entrar" element={<Guest><LoginPage /></Guest>} />
      <Route path="/cadastrar" element={<Guest><RegisterPage /></Guest>} />
      <Route path="/recuperar-senha" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route element={<Private><FinanceProvider><AppLayout /></FinanceProvider></Private>}>
        <Route index element={<DashboardPage />} />
        <Route path="receitas" element={<IncomePage />} />
        <Route path="despesas" element={<ExpensePage />} />
        <Route path="compromissos" element={<BillsPage />} />
        <Route path="conjunto" element={<HouseholdPage />} />
        <Route path="lancamentos" element={<LegacyEntries />} />
        <Route path="contas" element={<AccountsPage />} />
        <Route path="cartoes" element={<CardsPage />} />
        <Route path="cartoes/:id" element={<CardDetailPage />} />
        <Route path="recorrencias" element={<RecurrencesPage />} />
        <Route path="calendario" element={<CalendarPage />} />
        <Route path="simulador" element={<SimulatorPage />} />
        <Route path="metas" element={<GoalsPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="lixeira" element={<TrashPage />} />
        <Route path="importar" element={<ImportPage />} />
        <Route path="assistente" element={<AssistantPage />} />
        <Route path="ajuda" element={<HelpPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
