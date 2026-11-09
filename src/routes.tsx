import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { FinanceProvider } from "@/context/FinanceContext";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "@/pages/AuthPages";
import { AssistantPage } from "@/pages/AssistantPage";
import { AccountsPage } from "@/pages/AccountsPage";
import { CalendarPage } from "@/pages/CalendarPage";
import { CardsPage, CardDetailPage } from "@/pages/CardsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { GoalsPage } from "@/pages/GoalsPage";
import { HelpPage } from "@/pages/HelpPage";
import { ImportPage } from "@/pages/ImportPage";
import { RecurrencesPage } from "@/pages/RecurrencesPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { SimulatorPage } from "@/pages/SimulatorPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import type { ReactNode } from "react";

function Private({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-sm text-muted">Carregando sua sessão...</div>;
  if (!session) return <Navigate to="/entrar" replace />;
  return children;
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
        <Route path="lancamentos" element={<TransactionsPage />} />
        <Route path="contas" element={<AccountsPage />} />
        <Route path="cartoes" element={<CardsPage />} />
        <Route path="cartoes/:id" element={<CardDetailPage />} />
        <Route path="recorrencias" element={<RecurrencesPage />} />
        <Route path="calendario" element={<CalendarPage />} />
        <Route path="simulador" element={<SimulatorPage />} />
        <Route path="metas" element={<GoalsPage />} />
        <Route path="relatorios" element={<ReportsPage />} />
        <Route path="importar" element={<ImportPage />} />
        <Route path="assistente" element={<AssistantPage />} />
        <Route path="ajuda" element={<HelpPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
