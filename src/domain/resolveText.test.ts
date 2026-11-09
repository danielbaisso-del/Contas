import { describe, expect, it } from "vitest";
import { resolveAmountCents, resolveOccurredOn } from "@/domain/resolveText";

describe("interpretação de valores e datas", () => {
  it("prioriza o valor escrito pela pessoa", () => {
    expect(resolveAmountCents("Recebi R$ 1.500 de um cliente", 1500)).toBe(150_000);
    expect(resolveAmountCents("Ontem gastei R$ 85 no supermercado", 85)).toBe(8_500);
    expect(resolveAmountCents("gastei 85 no mercado", 85)).toBe(8_500);
    expect(resolveAmountCents("gastei 85 no mercado", 8500)).toBe(8_500);
    expect(resolveAmountCents("paguei 1500", 1500)).toBe(150_000);
  });

  it("resolve hoje, ontem e dia do mês", () => {
    expect(resolveOccurredOn("gastei hoje no mercado", "2026-11-09", null)).toEqual({ date: "2026-11-09", assumed: false });
    expect(resolveOccurredOn("ontem gastei no mercado", "2026-11-09", null)).toEqual({ date: "2026-11-08", assumed: false });
    expect(resolveOccurredOn("pagar no dia 15", "2026-11-09", null)).toEqual({ date: "2026-11-15", assumed: false });
    expect(resolveOccurredOn("lançar o salário", "2026-11-09", null).assumed).toBe(true);
  });
});
