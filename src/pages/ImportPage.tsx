import { useMemo, useState } from "react";
import { Button, Field, PageHeader, Select } from "@/components/ui";
import { useFinance } from "@/context/FinanceContext";
import { useToast } from "@/context/ToastContext";
import { findDuplicate } from "@/finance/engine";
import { formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { parseCsvStatement, parseOfxStatement, type ParsedMovement } from "@/lib/statements";
import { errorMessage } from "@/lib/utils";
import { suggestCategories } from "@/services/ai";
import { importStatement } from "@/services/data";

interface Row extends ParsedMovement {
  include: boolean;
  categoryId: string;
  duplicate: string | null;
}

export function ImportPage() {
  const { data, refresh } = useFinance();
  const toast = useToast();
  const [accountId, setAccountId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const duplicates = useMemo(() => rows.filter((row) => row.duplicate).length, [rows]);

  async function read(file: File) {
    const buffer = await file.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buffer);
    const ofx = /<OFX|<STMTTRN/i.test(text) || file.name.toLowerCase().endsWith(".ofx");
    if (ofx && !/<STMTTRN/i.test(text)) text = new TextDecoder("iso-8859-1").decode(buffer);
    const parsed = ofx ? parseOfxStatement(text) : parseCsvStatement(text);
    if (!parsed.length && !ofx) {
      const latin = new TextDecoder("iso-8859-1").decode(buffer);
      const retry = parseCsvStatement(latin);
      if (retry.length) return retry;
    }
    return parsed;
  }

  return (
    <div>
      <PageHeader title="Importar extrato" description="Aceita CSV e OFX. Nada entra na conta antes da sua revisão. Itens parecidos com lançamentos existentes ficam desmarcados." />
      <div className="mb-4 grid gap-4 rounded-3xl border border-line bg-surface p-5 md:grid-cols-2">
        <Field label="Conta de destino" hint="O extrato representa dinheiro que já se moveu, então os itens entram como pagos ou recebidos.">
          <Select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Selecione</option>{data.accounts.filter((account) => !account.archived).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</Select>
        </Field>
        <Field label="Arquivo CSV ou OFX">
          <input className="block text-sm" type="file" accept=".csv,.ofx,.qfx,.txt" onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file || !accountId) { toast("Escolha a conta antes do arquivo.", "error"); return; }
            const parsed = await read(file);
            setRows(parsed.map((item) => ({ ...item, include: true, categoryId: "", duplicate: findDuplicate(data.transactions, accountId, item.occurredOn, item.amountCents, item.description, item.externalId) })).map((item) => ({ ...item, include: !item.duplicate })));
          }} />
        </Field>
      </div>
      {rows.length ? (
        <div className="rounded-3xl border border-line bg-surface p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">{rows.length} linha(s), {duplicates} possível(is) duplicata(s).</p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={async () => {
                try {
                  const result = await suggestCategories([...new Set(rows.map((row) => row.description))]);
                  setRows((current) => current.map((row) => ({ ...row, categoryId: data.categories.find((category) => category.name === result.suggestions[row.description])?.id ?? row.categoryId })));
                  toast("Sugestões aplicadas onde a categoria foi reconhecida.");
                } catch (error) { toast(errorMessage(error), "error"); }
              }}>Sugerir categorias</Button>
              <Button loading={loading} onClick={async () => {
                setLoading(true);
                try {
                  const selected = rows.filter((row) => row.include);
                  if (!selected.length) throw new Error("Marque ao menos um lançamento.");
                  await importStatement(accountId, selected.map((row) => ({ occurredOn: row.occurredOn, description: row.description, amountCents: row.amountCents, type: row.type, categoryId: row.categoryId || null, externalId: row.externalId })));
                  toast("Extrato importado.");
                  setRows([]);
                  await refresh();
                } catch (error) { toast(errorMessage(error), "error"); } finally { setLoading(false); }
              }}>Importar marcados</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs text-muted"><tr><th></th><th>Data</th><th>Descrição</th><th>Valor</th><th>Categoria</th><th>Aviso</th></tr></thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.externalId ?? row.description}-${index}`} className="border-t border-line">
                    <td className="py-2"><input type="checkbox" checked={row.include} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, include: event.target.checked } : item))} /></td>
                    <td>{formatDateBR(row.occurredOn)}</td>
                    <td>{row.description}</td>
                    <td className={row.type === "income" ? "text-income" : "text-expense"}>{formatBRL(row.amountCents)}</td>
                    <td><Select value={row.categoryId} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, categoryId: event.target.value } : item))}><option value="">Sem categoria</option>{data.categories.filter((category) => category.kind === row.type).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></td>
                    <td className="text-xs text-warning">{row.duplicate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
