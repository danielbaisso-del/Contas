import type { CategoryKind } from "@/types/models";

export const DEFAULT_CATEGORIES: Array<{ name: string; kind: CategoryKind; color: string }> = [
  { name: "Salário", kind: "income", color: "#0f766e" },
  { name: "Freelance", kind: "income", color: "#0369a1" },
  { name: "Outras receitas", kind: "income", color: "#334155" },
  { name: "Alimentação", kind: "expense", color: "#b45309" },
  { name: "Mercado", kind: "expense", color: "#15803d" },
  { name: "Moradia", kind: "expense", color: "#1d4ed8" },
  { name: "Contas da casa", kind: "expense", color: "#7c3aed" },
  { name: "Transporte", kind: "expense", color: "#0369a1" },
  { name: "Saúde", kind: "expense", color: "#be123c" },
  { name: "Educação", kind: "expense", color: "#1d4ed8" },
  { name: "Lazer", kind: "expense", color: "#7c3aed" },
  { name: "Assinaturas", kind: "expense", color: "#b45309" },
  { name: "Compras", kind: "expense", color: "#334155" },
  { name: "Outros", kind: "expense", color: "#64748b" },
];
