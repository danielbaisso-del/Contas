import { describe, expect, it } from "vitest";
import { conductSimple } from "@/domain/simpleEntry";

describe("lançamento simples", () => {
  it("entende nome, valor e data de um gasto na mesma frase", () => {
    const result = conductSimple("gastei 80 de mercado hoje", null, "2026-11-11");
    expect(result.ready).toBe(true);
    expect(result.state?.kind).toBe("paid");
    expect(result.state?.description).toBe("Mercado");
    expect(result.state?.amountCents).toBe(8000);
    expect(result.state?.occurredOn).toBe("2026-11-11");
  });

  it("pergunta só o nome e não pede o valor de novo", () => {
    const first = conductSimple("recebi 3200 hoje", null, "2026-11-11");
    expect(first.ready).toBe(false);
    expect(first.question).toMatch(/nome/i);
    expect(first.state?.amountCents).toBe(320000);
    const second = conductSimple("salário", first.state, "2026-11-11", "recebi 3200 hoje");
    expect(second.ready).toBe(true);
    expect(second.state?.description?.toLowerCase()).toContain("sal");
    expect(second.state?.amountCents).toBe(320000);
    expect(second.state?.occurredOn).toBe("2026-11-11");
  });

  it("trata parcela de um valor e parcela do total", () => {
    const each = conductSimple("geladeira em 3 parcelas de 200 hoje", null, "2026-11-11");
    expect(each.ready).toBe(true);
    expect(each.state?.installments).toBe(3);
    expect(each.state?.perInstallment).toBe(true);
    expect(each.state?.amountCents).toBe(20000);
    const total = conductSimple("sofá 600 em 3 vezes hoje", null, "2026-11-11");
    expect(total.ready).toBe(true);
    expect(total.state?.installments).toBe(3);
    expect(total.state?.perInstallment).toBe(false);
    expect(total.state?.amountCents).toBe(60000);
  });

  it("uma frase nova não reaproveita o valor antigo", () => {
    const open = conductSimple("recebi 3200 hoje", null, "2026-11-11").state;
    const next = conductSimple("gastei 80 de mercado hoje", open, "2026-11-11", "recebi 3200 hoje");
    expect(next.ready).toBe(true);
    expect(next.state?.kind).toBe("paid");
    expect(next.state?.amountCents).toBe(8000);
    expect(next.state?.description).toBe("Mercado");
  });

  it("pergunta quantas vezes quando só diz que é parcelado", () => {
    const first = conductSimple("notebook parcelado de 900 hoje", null, "2026-11-11");
    expect(first.ready).toBe(false);
    expect(first.question).toMatch(/quantas vezes/i);
    const second = conductSimple("3", first.state, "2026-11-11");
    expect(second.ready).toBe(true);
    expect(second.state?.installments).toBe(3);
    expect(second.state?.occurredOn).toBe("2026-11-11");
    expect(second.state?.amountCents).toBe(90000);
  });
});
