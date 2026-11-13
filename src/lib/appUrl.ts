const PUBLISHED_ORIGIN = "https://contas-ivory.vercel.app";

export function authRedirect(path: string): string {
  const host = window.location.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  const configured = import.meta.env.VITE_APP_URL?.replace(/\/$/, "");
  const origin = local ? configured || PUBLISHED_ORIGIN : window.location.origin;
  return `${origin}${path}`;
}
