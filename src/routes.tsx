import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/context/AuthContext";
import { FinanceProvider } from "@/context/FinanceContext";
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from "@/pages/AuthPages";
import { AdminPage } from "@/pages/AdminPage";
import { CalculatorPage } from "@/pages/CalculatorPage";
import { HomePage } from "@/pages/HomePage";
import { HouseholdPage } from "@/pages/HouseholdPage";
import { PeriodChartPage } from "@/pages/PeriodChartPage";
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
        <Route index element={<HomePage />} />
        <Route path="conjunto" element={<HouseholdPage />} />
        <Route path="grafico" element={<PeriodChartPage />} />
        <Route path="calculadora" element={<CalculatorPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
