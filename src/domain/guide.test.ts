import { describe, expect, it } from "vitest";
import { isSkip } from "@/domain/guide";

describe("guia da IA", () => {
  it("reconhece quando a pessoa quer passar para a próxima pergunta", () => {
    expect(isSkip("só isso")).toBe(true);
    expect(isSkip("Não tenho")).toBe(true);
    expect(isSkip("pode seguir")).toBe(true);
  });

  it("não pula quando a frase traz um valor", () => {
    expect(isSkip("não, o salário foi R$ 3.200")).toBe(false);
    expect(isSkip("paguei R$ 150 de internet")).toBe(false);
  });
});
