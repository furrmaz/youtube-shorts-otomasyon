import { getSettings } from "./settings";

/** Panelde girilen değer > .env > varsayılan */
export async function cfg() {
  const s = await getSettings();
  const pick = (db: string, env: string | undefined, def = "") => db.trim() || env?.trim() || def;
  return {
    panelPassword: pick(s.panelPassword, process.env.PANEL_PASSWORD),
    anthropicApiKey: pick(s.anthropicApiKey, process.env.ANTHROPIC_API_KEY),
    // "claude-opus-5.5" gibi noktalı yazımlar API kimliğine (tireli) çevrilir
    claudeModel: pick(s.claudeModel, process.env.CLAUDE_MODEL, "claude-opus-5-5").toLowerCase().replace(/[.\s]+/g, "-"),
    elevenApiKey: pick(s.elevenApiKey, process.env.ELEVENLABS_API_KEY),
    elevenModelId: pick(s.elevenModelId, process.env.ELEVENLABS_MODEL_ID, "eleven_multilingual_v2"),
    falKey: pick(s.falKey, process.env.FAL_KEY),
    falModel: pick(s.falModel, process.env.FAL_MODEL, "fal-ai/flux/dev"),
    replicateToken: pick(s.replicateToken, process.env.REPLICATE_API_TOKEN),
    replicateModel: pick(s.replicateModel, process.env.REPLICATE_MODEL, "black-forest-labs/flux-schnell"),
    googleClientId: pick(s.googleClientId, process.env.GOOGLE_CLIENT_ID),
    googleClientSecret: pick(s.googleClientSecret, process.env.GOOGLE_CLIENT_SECRET),
    appUrl: pick(s.appUrl, process.env.APP_URL, "http://localhost:3000").replace(/\/+$/, ""),
  };
}
export type Config = Awaited<ReturnType<typeof cfg>>;

export const mask = (v: string) => (v ? `kayıtlı (…${v.slice(-4)})` : "");
