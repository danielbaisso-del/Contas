import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Field, Input } from "@/components/ui";
import { useTheme } from "@/context/ThemeContext";
import { supabase } from "@/services/supabase";
import { Moon, Sun } from "lucide-react";

function AuthShell({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  const { theme, toggle } = useTheme();
  return (
    <div className="grid min-h-screen bg-canvas lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-ink lg:flex">
        <div>
          <p className="text-2xl font-semibold">Contas</p>
          <p className="mt-2 text-sidebar-muted">Um gerenciador para responder, com os seus números:</p>
        </div>
        <ul className="space-y-4 text-sm leading-6">
          <li>Quanto dinheiro já está nas contas.</li>
          <li>Quanto ainda vai entrar e quanto ainda precisa sair.</li>
          <li>Quanto a fatura do cartão representa, sem contar duas vezes.</li>
          <li>Como fica o saldo em 30, 60 e 90 dias.</li>
        </ul>
        <p className="text-xs text-sidebar-muted">Nada é inventado. Cada valor nasce de um lançamento seu.</p>
      </section>
      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="text-2xl font-semibold">{title}</h1>
            <button className="rounded-xl border border-line p-2" onClick={toggle} aria-label="Alternar tema">{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
          </div>
          <p className="mb-6 text-sm leading-6 text-muted">{text}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

export function SetupPage() {
  return (
    <AuthShell title="Falta conectar o banco" text="O sistema está pronto, mas ainda não tem para onde guardar seus dados. Siga estes passos e reinicie o aplicativo.">
      <ol className="space-y-3 text-sm leading-6">
        <li>1. Crie um projeto gratuito no Supabase.</li>
        <li>2. Abra o SQL Editor e execute o arquivo <strong>supabase/migrations/001_initial.sql</strong>.</li>
        <li>3. Copie a URL do projeto e a chave <strong>anon</strong> para o arquivo <strong>.env</strong>.</li>
        <li>4. A chave <strong>service_role</strong> e a <strong>GEMINI_API_KEY</strong> ficam no mesmo arquivo, sem o prefixo VITE_.</li>
        <li>5. Rode <strong>npm run dev</strong> de novo.</li>
      </ol>
      <p className="mt-5 text-xs leading-5 text-muted">O modelo de variáveis está em .env.example. Não coloque a chave do Gemini em uma variável que comece com VITE_.</p>
    </AuthShell>
  );
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const login = email.trim().toLowerCase() === "equipe" ? "equipe@contas.app" : email.trim();
    const { error: authError } = await supabase.auth.signInWithPassword({ email: login, password });
    setLoading(false);
    if (authError) setError("Não foi possível entrar. Confira e-mail e senha, ou confirme o e-mail se o Supabase pediu isso.");
    else navigate("/");
  }
  return (
    <AuthShell title="Entrar" text="Sua sessão fica guardada neste navegador até você sair.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Usuário ou e-mail"><Input required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></Field>
        <Field label="Senha"><Input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></Field>
        {error ? <p className="text-sm text-expense">{error}</p> : null}
        <Button type="submit" loading={loading} className="w-full">Entrar</Button>
      </form>
      <p className="mt-4 text-sm text-muted"><Link className="text-accent" to="/recuperar-senha">Esqueci a senha</Link> · <Link className="text-accent" to="/cadastrar">Criar conta</Link></p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const { data, error: authError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: name } } });
    setLoading(false);
    if (authError) setError("Não foi possível criar a conta. Use uma senha com pelo menos 6 caracteres e um e-mail válido.");
    else if (!data.session) setMessage("Conta criada. Se a confirmação de e-mail estiver ligada no Supabase, abra a mensagem antes de entrar.");
    else setMessage("Conta criada. Você já pode entrar.");
  }
  return (
    <AuthShell title="Criar conta" text="Ao criar a conta, o banco separa seus dados dos de qualquer outra pessoa.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nome"><Input required value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="E-mail"><Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        <Field label="Senha" hint="Mínimo de 6 caracteres."><Input type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {error ? <p className="text-sm text-expense">{error}</p> : null}
        {message ? <p className="text-sm text-income">{message}</p> : null}
        <Button type="submit" loading={loading} className="w-full">Criar conta</Button>
      </form>
      <p className="mt-4 text-sm"><Link className="text-accent" to="/entrar">Já tenho conta</Link></p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/redefinir-senha` });
    if (authError) setError("Não foi possível enviar o e-mail. Confira o endereço e se a URL de redirecionamento está liberada no Supabase.");
    else setMessage("Se o e-mail existir, você receberá um link para escolher outra senha.");
  }
  return (
    <AuthShell title="Recuperar senha" text="O link volta para esta aplicação, na página de nova senha.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="E-mail"><Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
        {error ? <p className="text-sm text-expense">{error}</p> : null}
        {message ? <p className="text-sm leading-6 text-income">{message}</p> : null}
        <Button type="submit">Enviar link</Button>
      </form>
      <p className="mt-4 text-sm"><Link className="text-accent" to="/entrar">Voltar</Link></p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const { error: authError } = await supabase.auth.updateUser({ password });
    if (authError) setError("Abra esta página pelo link do e-mail e escolha uma senha com pelo menos 6 caracteres.");
    else navigate("/");
  }
  return (
    <AuthShell title="Nova senha" text="Escolha uma senha nova. Ela passa a valer na próxima entrada.">
      <form className="space-y-4" onSubmit={submit}>
        <Field label="Nova senha"><Input type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
        {error ? <p className="text-sm text-expense">{error}</p> : null}
        <Button type="submit">Salvar senha</Button>
      </form>
    </AuthShell>
  );
}
