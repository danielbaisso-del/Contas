export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface NodeRequest {
  method?: string;
  url?: string;
  headers: Headers | Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface NodeResponse {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
  status?: (code: number) => { json: (body: unknown) => void };
}

export function readHeader(req: NodeRequest, name: string): string {
  const headers = req.headers;
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name) ?? "";
  const value = (headers as Record<string, string | string[] | undefined>)[name] ?? (headers as Record<string, string | string[] | undefined>)[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export async function readJson(req: NodeRequest): Promise<Record<string, unknown>> {
  try {
    if (typeof req.body === "string") return req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
    if (req.body && typeof req.body === "object") return req.body as Record<string, unknown>;
    const chunks: Buffer[] = [];
    for await (const chunk of req as unknown as AsyncIterable<Uint8Array | string>) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.length > 60_000) throw new HttpError(413, "O pedido está grande demais.");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Não consegui ler o pedido.");
  }
}

export function sendJson(res: NodeResponse, status: number, body: unknown): void {
  if (typeof res.status === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

export function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return "";
}

export type { NodeRequest, NodeResponse };
