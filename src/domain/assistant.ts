import { z } from "zod";

export const paymentMethodSchema = z.enum(["pix", "debit", "credit", "cash", "boleto", "transfer", "other"]);

export const transactionDraftSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount_cents: z.number().int().positive().max(100_000_000_00),
  type: z.enum(["income", "expense"]),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  status: z.enum(["planned", "pending", "paid", "received"]),
  category_id: z.string().uuid().nullable().optional(),
  account_id: z.string().uuid().nullable().optional(),
  card_id: z.string().uuid().nullable().optional(),
  payment_method: paymentMethodSchema.nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  installments: z.number().int().min(1).max(48).optional(),
});

export const transferDraftSchema = z.object({
  description: z.string().trim().min(2).max(140),
  amount_cents: z.number().int().positive().max(100_000_000_00),
  occurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
});

export const intentSchema = z.object({
  action: z.enum(["chat", "clarify", "create_transaction", "create_transfer", "query"]),
  message: z.string().optional().nullable(),
  missing: z.array(z.string()).optional().nullable(),
  draft: z
    .object({
      description: z.string().optional().nullable(),
      amount_cents: z.number().optional().nullable(),
      type: z.enum(["income", "expense"]).optional().nullable(),
      occurred_on: z.string().optional().nullable(),
      due_on: z.string().optional().nullable(),
      category_name: z.string().optional().nullable(),
      account_name: z.string().optional().nullable(),
      card_name: z.string().optional().nullable(),
      payment_method: paymentMethodSchema.optional().nullable(),
      notes: z.string().optional().nullable(),
      status: z.enum(["planned", "pending", "paid", "received"]).optional().nullable(),
      installments: z.number().optional().nullable(),
    })
    .optional()
    .nullable(),
  transfer: z
    .object({
      description: z.string().optional().nullable(),
      amount_cents: z.number().optional().nullable(),
      occurred_on: z.string().optional().nullable(),
      from_account_name: z.string().optional().nullable(),
      to_account_name: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  query: z
    .object({
      metric: z.enum(["available_balance", "month_overview", "forecast", "category_total", "upcoming", "can_afford", "account_balance"]).optional().nullable(),
      category_name: z.string().optional().nullable(),
      account_name: z.string().optional().nullable(),
      month: z.string().optional().nullable(),
      months: z.number().optional().nullable(),
      days: z.number().optional().nullable(),
      amount_cents: z.number().optional().nullable(),
      installments: z.number().optional().nullable(),
      payment: z.enum(["cash", "credit"]).optional().nullable(),
      starting_on: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

export type TransactionDraft = z.infer<typeof transactionDraftSchema>;
export type TransferDraft = z.infer<typeof transferDraftSchema>;
export type Intent = z.infer<typeof intentSchema>;

export type Confirmation =
  | { kind: "transaction" | "card_purchase" | "bank_installments"; title: string; lines: string[]; draft: TransactionDraft }
  | { kind: "transfer"; title: string; lines: string[]; draft: TransferDraft };

export interface AssistantResponse {
  reply: string;
  confirmation: Confirmation | null;
}
