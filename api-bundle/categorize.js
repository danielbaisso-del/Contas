// server/categorize.ts
import { z } from "zod";

// src/lib/money.ts
var moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL"
});

// src/lib/utils.ts
function normalizeText(value) {
  return value.normalize("NFD").replace(new RegExp("\\p{Diacritic}", "gu"), "").toLowerCase().trim();
}
function matchByName(items, name) {
  if (!name?.trim()) return null;
  const target = normalizeText(name);
  return items.find((item) => normalizeText(item.name) === target) ?? items.find((item) => {
    const current = normalizeText(item.name);
    return current.includes(target) || target.includes(current);
  }) ?? null;
}

// src/domain/resolveText.ts
var EXPENSE_HINTS = [
  { category: "Mercado", words: ["mercado", "supermercado", "feira", "hortifruti"] },
  { category: "Alimenta\xE7\xE3o", words: ["restaurante", "ifood", "lanche", "almoco", "jantar", "padaria", "cafe", "comida"] },
  { category: "Transporte", words: ["uber", "combustivel", "gasolina", "onibus", "metro", "estacionamento"] },
  { category: "Moradia", words: ["aluguel", "condominio"] },
  { category: "Contas da casa", words: ["luz", "energia", "agua", "internet", "telefone"] },
  { category: "Assinaturas", words: ["netflix", "spotify", "assinatura", "mensalidade"] },
  { category: "Sa\xFAde", words: ["farmacia", "medico", "hospital", "consulta"] },
  { category: "Lazer", words: ["cinema", "show", "viagem"] },
  { category: "Educa\xE7\xE3o", words: ["curso", "faculdade", "escola", "livro"] }
];
var INCOME_HINTS = [
  { category: "Sal\xE1rio", words: ["salario", "holerite"] },
  { category: "Freelance", words: ["freelance", "cliente"] }
];
function suggestCategory(text2, categories, type, modelName) {
  const matchedModel = matchByName(categories.filter((category) => category.kind === type), modelName);
  if (matchedModel) return matchedModel;
  const normalized = normalizeText(text2);
  const hints = type === "income" ? INCOME_HINTS : EXPENSE_HINTS;
  const hint = hints.find((item) => item.words.some((word) => normalized.includes(normalizeText(word))));
  if (!hint) return null;
  return matchByName(categories.filter((category) => category.kind === type), hint.category);
}

// src/services/mappers.ts
function text(row, key) {
  const value = row[key];
  return value == null ? "" : String(value);
}
function mapCategory(row) {
  return {
    id: text(row, "id"),
    name: text(row, "name"),
    kind: text(row, "kind"),
    color: text(row, "color") || "#1d4ed8"
  };
}

// server/http.ts
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function readHeader(req, name) {
  const headers = req.headers;
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
function jsonRecord(value) {
  if (!value.trim()) return {};
  if (value.length > 6e4) throw new HttpError(413, "O pedido est\xE1 grande demais.");
  return JSON.parse(value);
}
async function readJson(req) {
  try {
    if (typeof req.body === "string") return jsonRecord(req.body);
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(req.body)) return jsonRecord(req.body.toString("utf8"));
    if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) return req.body;
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return jsonRecord(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "N\xE3o consegui ler o pedido.");
  }
}
function sendJson(res, status, body) {
  if (typeof res.status === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
function envValue(...keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

// server/gemini.ts
function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
async function geminiJson(prompt, system) {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    throw new HttpError(503, "A chave GEMINI_API_KEY ainda n\xE3o est\xE1 no servidor. O resto do sistema funciona. Coloque a chave no .env, sem o prefixo VITE_, e reinicie.");
  }
  const models = unique([process.env.GEMINI_MODEL ?? "", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]);
  let lastError = "A IA n\xE3o respondeu.";
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      })
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 404) {
      lastError = `O modelo ${model} n\xE3o est\xE1 dispon\xEDvel nesta chave.`;
      continue;
    }
    if (response.status === 429) throw new HttpError(429, "A cota gratuita do Gemini acabou por enquanto. Espere um pouco e tente de novo.");
    if (!response.ok) {
      lastError = "O Gemini recusou o pedido. Confira se a chave gratuita est\xE1 ativa.";
      continue;
    }
    const text2 = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text2) {
      if (payload?.promptFeedback?.blockReason) throw new HttpError(422, "A IA bloqueou essa mensagem. Reformule o pedido.");
      throw new HttpError(422, "A IA voltou sem conte\xFAdo.");
    }
    return text2;
  }
  throw new HttpError(502, lastError);
}
function parseModelJson(text2) {
  const trimmed = text2.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new HttpError(422, "N\xE3o entendi a resposta da IA. Tente uma frase mais direta.");
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      throw new HttpError(422, "N\xE3o entendi a resposta da IA. Tente uma frase mais direta.");
    }
  }
}

// server/supabase.ts
import { createClient } from "@supabase/supabase-js";
function supabaseUrl() {
  return envValue("SUPABASE_URL", "VITE_SUPABASE_URL");
}
function anonKey() {
  return envValue("SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY");
}
async function requireUser(req) {
  const header = readHeader(req, "authorization");
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Fa\xE7a login novamente.");
  const url = supabaseUrl();
  const anon = anonKey();
  if (!url || !anon) throw new HttpError(500, "Configure a URL e a chave anon do Supabase no servidor.");
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Sua sess\xE3o expirou. Entre novamente.");
  return { id: data.user.id, email: data.user.email ?? "", token };
}
function userClient(token) {
  const url = supabaseUrl();
  const anon = anonKey();
  if (!url || !anon) throw new HttpError(500, "Configure a URL e a chave anon do Supabase no servidor.");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
}
function adminClient() {
  const url = supabaseUrl();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new HttpError(503, "Configure SUPABASE_SERVICE_ROLE_KEY s\xF3 no servidor. Ela limita o uso da IA e n\xE3o vai para o navegador.");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
async function consumeAiQuota(userId) {
  const admin = adminClient();
  const since = new Date(Date.now() - 60 * 60 * 1e3).toISOString();
  const usage = await admin.from("ai_usage").select("id", { count: "exact", head: true }).eq("user_id", userId).gte("created_at", since);
  if (usage.error) throw new HttpError(500, "N\xE3o consegui verificar o limite de uso da IA.");
  if ((usage.count ?? 0) >= 30) {
    throw new HttpError(429, "Voc\xEA chegou a 30 pedidos de IA nesta hora. Esse limite protege a cota gratuita.");
  }
  const inserted = await admin.from("ai_usage").insert({ user_id: userId });
  if (inserted.error) throw new HttpError(500, "N\xE3o consegui registrar o uso da IA.");
}

// server/categorize.ts
var responseSchema = z.object({
  items: z.array(z.object({ description: z.string(), category: z.string() })).default([])
});
async function handleCategorize(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    const user = await requireUser(req);
    const body = await readJson(req);
    const descriptions = Array.isArray(body.descriptions) ? body.descriptions.map((item) => String(item).slice(0, 140)).slice(0, 60) : [];
    if (!descriptions.length) throw new HttpError(400, "N\xE3o h\xE1 descri\xE7\xF5es para categorizar.");
    const client = userClient(user.token);
    const categoriesResult = await client.from("categories").select("*").eq("kind", "expense");
    if (categoriesResult.error) throw new HttpError(500, "N\xE3o consegui ler suas categorias.");
    const categories = (categoriesResult.data ?? []).map((row) => mapCategory(row));
    await consumeAiQuota(user.id);
    const prompt = `Categorize cada descri\xE7\xE3o usando somente uma destas categorias: ${categories.map((category) => category.name).join(", ")}.
Se nenhuma servir, use "".
Responda JSON: {"items":[{"description":"","category":""}]}
Descri\xE7\xF5es:
${descriptions.map((description, index) => `${index + 1}. ${description}`).join("\n")}`;
    const parsed = responseSchema.safeParse(parseModelJson(await geminiJson(prompt, "Voc\xEA s\xF3 categoriza extratos. N\xE3o invente categoria fora da lista. Responda JSON.")));
    const suggestions = {};
    for (const description of descriptions) {
      const fromModel = parsed.success ? parsed.data.items.find((item) => item.description.trim() === description.trim())?.category : "";
      const category = suggestCategory(description, categories, "expense", fromModel);
      if (category) suggestions[description] = category.name;
    }
    sendJson(res, 200, { suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "N\xE3o consegui sugerir categorias.";
    sendJson(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? message : "N\xE3o consegui sugerir categorias." });
  }
}
export {
  handleCategorize
};
