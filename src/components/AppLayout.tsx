import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Bot, CalendarDays, CircleHelp, CreditCard, FileUp, Landmark, LayoutDashboard, LogOut, Menu, Moon, PieChart, Plus, RefreshCw, Repeat, Shield, Sparkles, Sun, Target, Users, Wallet, X } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useFinance } from "@/context/FinanceContext";
import { useTheme } from "@/context/ThemeContext";
import { useToast } from "@/context/ToastContext";
import { checkAdmin } from "@/services/admin";
import { loadHousehold, respondInvite, type HouseholdInvite } from "@/services/household";
import { saveProfileName } from "@/services/data";
import { supabase } from "@/services/supabase";
import { GuideProvider } from "@/components/GuideCoach";
import { Button, Field, Input, Modal } from "@/components/ui";
import { cx, errorMessage } from "@/lib/utils";

const items = [
  { to: "/", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/conjunto", label: "Juntos", icon: Users },
  { to: "/lancamentos", label: "Lançamentos", icon: Wallet },
  { to: "/contas", label: "Contas", icon: Landmark },
  { to: "/cartoes", label: "Cartões", icon: CreditCard },
  { to: "/recorrencias", label: "Recorrências", icon: Repeat },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
  { to: "/simulador", label: "E se eu comprar?", icon: Sparkles },
  { to: "/metas", label: "Metas", icon: Target },
  { to: "/relatorios", label: "Relatórios", icon: PieChart },
  { to: "/importar", label: "Importar extrato", icon: FileUp },
  { to: "/assistente", label: "Assistente", icon: Bot },
  { to: "/ajuda", label: "Como funciona", icon: CircleHelp },
];

export function AppLayout() {
  const { session } = useAuth();
  const { profile, refresh, loading, error } = useFinance();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState(profile?.fullName ?? "");
  const [invites, setInvites] = useState<HouseholdInvite[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (!session) {
      setAdmin(false);
      return;
    }
    void checkAdmin().then(setAdmin).catch(() => setAdmin(false));
    void loadHousehold().then((summary) => {
      setInvites(summary.invites);
      const seen = sessionStorage.getItem("contas-household-invite") ?? "";
      if (summary.invites.some((invite) => !seen.includes(invite.id))) setInviteOpen(true);
    }).catch(() => setInvites([]));
  }, [session, location.pathname]);

  async function logout() {
    await supabase.auth.signOut();
    navigate("/entrar");
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-ink">
      <div className="flex items-center justify-between px-5 py-5">
        <div>
          <p className="text-lg font-semibold">Contas</p>
          <p className="text-xs text-sidebar-muted">Clareza do seu dinheiro</p>
        </div>
        <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X size={18} /></button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3">
        {[...items, ...(admin ? [{ to: "/admin", label: "Cadastros", icon: Shield, end: false }] : [])].map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)} className={({ isActive }) => cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm", isActive ? "bg-sidebar-active text-white" : "text-sidebar-muted hover:bg-white/5 hover:text-sidebar-ink")}>
            <item.icon size={18} />
            {item.label}
            {item.to === "/conjunto" && invites.length ? <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[10px] text-white">novo</span> : null}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-4">
        <button className="w-full truncate text-left text-xs text-sidebar-muted" onClick={() => { setName(profile?.fullName ?? ""); setProfileOpen(true); }}>{profile?.fullName || session?.user.email}</button>
        <button className="mt-3 flex items-center gap-2 text-sm text-sidebar-muted" onClick={() => void logout()}><LogOut size={16} /> Sair</button>
      </div>
    </div>
  );

  return (
    <GuideProvider>
    <div className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">{sidebar}</aside>
      {open ? <div className="fixed inset-0 z-40 lg:hidden"><button className="absolute inset-0 bg-slate-950/60" onClick={() => setOpen(false)} aria-label="Fechar" /><div className="relative h-full w-72">{sidebar}</div></div> : null}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur md:px-8">
          <button className="rounded-xl border border-line p-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu size={18} /></button>
          <div className="hidden text-sm text-muted sm:block">Os números desta tela vêm dos seus lançamentos.</div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="secondary" onClick={() => navigate("/lancamentos?novo=1")}><Plus size={16} /> Lançar</Button>
            <button className="rounded-xl border border-line p-2" onClick={() => void refresh()} aria-label="Atualizar"><RefreshCw size={16} className={loading ? "animate-spin" : ""} /></button>
            <button className="rounded-xl border border-line p-2" onClick={toggle} aria-label="Alternar tema">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
        </header>
        <main className="px-4 py-6 pb-28 md:px-8">
          {loading ? <div className="py-20 text-center text-sm text-muted">Organizando seus dados...</div> : null}
          {!loading && error ? <div className="rounded-3xl border border-line bg-surface p-6 text-sm leading-6">{error}</div> : null}
          {!loading && !error ? <div className="rise"><Outlet /></div> : null}
        </main>
      </div>
      {inviteOpen && invites.length ? (
        <Modal title="Pedido para juntar as contas" onClose={() => { sessionStorage.setItem("contas-household-invite", invites.map((invite) => invite.id).join(",")); setInviteOpen(false); }}>
          <div className="space-y-4">
            {invites.map((invite) => (
              <div key={invite.id} className="space-y-3 text-sm leading-6">
                <p><strong>{invite.fromName}</strong>{invite.fromEmail ? ` (${invite.fromEmail})` : ""} quer ver com você os ganhos, os gastos e as contas futuras.</p>
                <p className="text-muted">Se você aceitar, os dois passam a ter a aba Juntos. Sua conta pessoal continua separada, e cada pessoa lança no próprio acesso.</p>
                <div className="flex gap-2">
                  <Button onClick={async () => { try { await respondInvite(invite.id, "accept"); setInvites((current) => current.filter((item) => item.id !== invite.id)); setInviteOpen(false); navigate("/conjunto"); } catch (caught) { toast(errorMessage(caught), "error"); } }}>Aceitar</Button>
                  <Button variant="secondary" onClick={async () => { try { await respondInvite(invite.id, "decline"); setInvites((current) => current.filter((item) => item.id !== invite.id)); setInviteOpen(false); } catch (caught) { toast(errorMessage(caught), "error"); } }}>Recusar</Button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
      {profileOpen ? (
        <Modal title="Sua conta" onClose={() => setProfileOpen(false)}>
          <form className="space-y-4" onSubmit={async (event) => { event.preventDefault(); await saveProfileName(name); await refresh(); setProfileOpen(false); }}>
            <Field label="Nome"><Input value={name} onChange={(event) => setName(event.target.value)} /></Field>
            <p className="text-xs text-muted">{session?.user.email}</p>
            <Button type="submit">Salvar nome</Button>
          </form>
        </Modal>
      ) : null}
    </div>
    </GuideProvider>
  );
}
