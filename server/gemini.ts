import { HttpError } from "./http";

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export async function geminiJson(prompt: string, system: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    throw new HttpError(503, "A chave GEMINI_API_KEY ainda não está no servidor. O resto do sistema funciona. Coloque a chave no .env, sem o prefixo VITE_, e reinicie.");
  }
  const models = unique([process.env.GEMINI_MODEL ?? "", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]);
  let lastError = "A IA não respondeu.";
  for (const model of models) {
    let response: Response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
      });
    } catch {
      lastError = `O modelo ${model} demorou para responder.`;
      continue;
    }
    const payload = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      promptFeedback?: { blockReason?: string };
      error?: { message?: string };
    } | null;
    if (response.status === 404) {
      lastError = `O modelo ${model} não está disponível nesta chave.`;
      continue;
    }
    if (response.status === 429) throw new HttpError(429, "A cota gratuita do Gemini acabou por enquanto. Espere um pouco e tente de novo.");
    if (!response.ok) {
      lastError = "O Gemini recusou o pedido. Confira se a chave gratuita está ativa.";
      continue;
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text) {
      if (payload?.promptFeedback?.blockReason) throw new HttpError(422, "A IA bloqueou essa mensagem. Reformule o pedido.");
      throw new HttpError(422, "A IA voltou sem conteúdo.");
    }
    return text;
  }
  throw new HttpError(502, lastError);
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new HttpError(422, "Não entendi a resposta da IA. Tente uma frase mais direta.");
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
    } catch {
      throw new HttpError(422, "Não entendi a resposta da IA. Tente uma frase mais direta.");
    }
  }
}
