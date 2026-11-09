# Contas

Gerenciador financeiro pessoal. Ele responde, com os seus próprios lançamentos:

- quanto dinheiro você tem agora;
- quanto já entrou e saiu no mês;
- quanto ainda precisa pagar;
- quanto ainda vai receber;
- quanto deve sobrar em 30, 60 e 90 dias.

Os cálculos ficam no TypeScript. A inteligência artificial só interpreta frases e nunca grava nada sem a sua confirmação.

## O que você precisa

- Node.js 20 ou superior
- Uma conta gratuita no [Supabase](https://supabase.com)
- Uma conta gratuita na [Vercel](https://vercel.com) para publicar
- Uma chave gratuita do [Google AI Studio](https://aistudio.google.com/apikey) quando quiser usar o assistente

O restante do sistema funciona antes da chave do Gemini.

## 1. Instalar

```bash
npm install
copy .env.example .env
```

No PowerShell, o `copy` cria o `.env`. Preencha esse arquivo. Não commite o `.env`.

## 2. Criar o banco

1. Crie um projeto no Supabase.
2. Abra **SQL Editor**.
3. Cole todo o conteúdo de `supabase/migrations/001_initial.sql`.
4. Execute uma vez.

Esse script cria as tabelas, impede que uma pessoa veja dados de outra (Row Level Security) e cadastra as categorias iniciais quando alguém cria conta.

Em **Authentication → URL Configuration**, adicione:

- `http://localhost:5173`
- `http://localhost:5173/redefinir-senha`
- o endereço da Vercel, quando publicar, também com `/redefinir-senha`

Para uso pessoal, em **Authentication → Providers → Email**, você pode desligar “Confirm email”. Se deixar ligado, o cadastro só entra depois que você abrir o e-mail.

## 3. Variáveis

```env
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_URL=https://SEU_PROJETO.supabase.co
SUPABASE_ANON_KEY=sua_chave_anon
SUPABASE_SERVICE_ROLE_KEY=sua_chave_service_role
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash
```

Onde achar no Supabase: **Project Settings → API**.

- `anon` pode ir para o navegador. As políticas do banco protegem os dados.
- `service_role` fica só no servidor. Ela não pode ter prefixo `VITE_`.
- `GEMINI_API_KEY` também fica só no servidor. Pode deixar vazia até você querer o assistente.

## 4. Rodar

```bash
npm run dev
```

Abra `http://localhost:5173`, crie sua conta e cadastre a primeira conta bancária.

O saldo inicial é o ponto de partida **antes** dos lançamentos. Se for importar um extrato, use o saldo do dia anterior ao primeiro lançamento. Não use o saldo inicial para registrar um salário: isso é uma receita.

## 5. Como o dinheiro é contado

- **Saldo disponível:** saldo inicial mais receitas recebidas, menos despesas pagas, transferências e pagamentos de fatura.
- **Compra no cartão:** entra no gasto e na fatura, mas não sai da conta na hora.
- **Pagamento da fatura:** sai da conta e quita o cartão. Não é somado de novo como despesa.
- **Transferência:** muda o dinheiro de lugar. Não é receita nem despesa.
- **Previsão:** saldo de hoje, mais o que ainda vai entrar, menos contas e faturas até a data.
- Valores são guardados em centavos para não haver erro de arredondamento.
- Datas aparecem como dia/mês/ano e valores como R$.

A página **Como funciona**, dentro do sistema, repete essas regras perto de cada número.

## 6. Assistente

Quando a `GEMINI_API_KEY` estiver no `.env`, reinicie o `npm run dev`.

O assistente entende frases como “ontem gastei R$ 85 no supermercado” e “quanto vai sobrar no fim do mês?”. Ele mostra uma prévia. O lançamento só é criado se você confirmar. Há um limite de 30 pedidos por hora para proteger a cota gratuita.

Se o modelo padrão não existir na sua chave, troque `GEMINI_MODEL`. O servidor também tenta `gemini-2.5-flash`, `gemini-2.0-flash` e `gemini-flash-latest`.

## 7. Publicar na Vercel

1. Envie o projeto para um repositório Git.
2. Importe o repositório na Vercel. O framework é Vite.
3. Cadastre as mesmas variáveis do `.env`. As que começam com `VITE_` precisam existir **antes** do build.
4. Faça o deploy.
5. Inclua a URL publicada nas URLs permitidas do Supabase.

O arquivo `vercel.json` já entrega o aplicativo e preserva as rotas `/api/assistant` e `/api/categorize`.

## 8. Comandos

```bash
npm run dev      # aplicativo local
npm test         # testes dos cálculos
npm run build    # verificação TypeScript e build
```

## 9. Se o build local for bloqueado

Alguns Windows impedem o arquivo nativo do Rollup. O `postinstall` detecta isso e passa a usar a versão WebAssembly, só nesta máquina. Na Vercel o build nativo continua normal.
