import { z } from "zod";
import { suggestCategory } from "@/domain/resolveText";
import { mapCategory } from "@/services/mappers";
import { geminiJson, parseModelJson } from "./gemini";
import { HttpError, readJson, sendJson, type NodeRequest, type NodeResponse } from "./http";
import { consumeAiQuota, requireUser, userClient } from "./supabase";

const responseSchema = z.object({
  items: z.array(z.object({ description: z.string(), category: z.string() })).default([]),
});

export async function handleCategorize(req: NodeRequest, res: NodeResponse): Promise<void> {
  try {
    if (req.method !== "POST") throw new HttpError(405, "Use POST.");
    const user = await requireUser(req);
    const body = await readJson(req);
    const descriptions = Array.isArray(body.descriptions) ? body.descriptions.map((item) => String(item).slice(0, 140)).slice(0, 60) : [];
    if (!descriptions.length) throw new HttpError(400, "Não há descrições para categorizar.");
    const client = userClient(user.token);
    const categoriesResult = await client.from("categories").select("*").eq("kind", "expense");
    if (categoriesResult.error) throw new HttpError(500, "Não consegui ler suas categorias.");
    const categories = (categoriesResult.data ?? []).map((row) => mapCategory(row as Record<string, unknown>));
    await consumeAiQuota(user.id);
    const prompt = `Categorize cada descrição usando somente uma destas categorias: ${categories.map((category) => category.name).join(", ")}.
Se nenhuma servir, use "".
Responda JSON: {"items":[{"description":"","category":""}]}
Descrições:
${descriptions.map((description, index) => `${index + 1}. ${description}`).join("\n")}`;
    const parsed = responseSchema.safeParse(parseModelJson(await geminiJson(prompt, "Você só categoriza extratos. Não invente categoria fora da lista. Responda JSON.")));
    const suggestions: Record<string, string> = {};
    for (const description of descriptions) {
      const fromModel = parsed.success ? parsed.data.items.find((item) => item.description.trim() === description.trim())?.category : "";
      const category = suggestCategory(description, categories, "expense", fromModel);
      if (category) suggestions[description] = category.name;
    }
    sendJson(res, 200, { suggestions });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não consegui sugerir categorias.";
    sendJson(res, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? message : "Não consegui sugerir categorias." });
  }
}
