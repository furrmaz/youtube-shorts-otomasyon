export const AUTH_COOKIE = "panel_auth";

export async function expectedToken(): Promise<string> {
  const pw = process.env.PANEL_PASSWORD || "";
  const data = new TextEncoder().encode(`shorts-panel:${pw}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
