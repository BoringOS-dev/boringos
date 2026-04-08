import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONAS_DIR = join(__dirname, "personas");

const PERSONA_ROLES = [
  "ceo", "cto", "engineer", "researcher", "pm", "qa",
  "devops", "designer", "personal-assistant", "content-creator", "finance",
] as const;

const ALIASES: Record<string, string> = {
  general: "engineer",
  "product manager": "pm",
  "product-manager": "pm",
  "quality assurance": "qa",
  "ux designer": "designer",
  frontend: "engineer",
  backend: "engineer",
  "full-stack": "engineer",
  fullstack: "engineer",
  sre: "devops",
  ops: "devops",
  "data scientist": "researcher",
  analyst: "researcher",
  assistant: "personal-assistant",
  "personal assistant": "personal-assistant",
  ea: "personal-assistant",
  "chief of staff": "personal-assistant",
  content: "content-creator",
  "social media": "content-creator",
  marketing: "content-creator",
  "finance agent": "finance",
  accountant: "finance",
  bookkeeper: "finance",
};

export function resolvePersonaRole(role: string): string {
  const normalized = role.toLowerCase().trim();
  if ((PERSONA_ROLES as readonly string[]).includes(normalized)) return normalized;
  return ALIASES[normalized] ?? "default";
}

export interface PersonaBundle {
  soul: string | null;
  agents: string | null;
  heartbeat: string | null;
}

export async function loadPersonaBundle(role: string): Promise<PersonaBundle> {
  const resolved = resolvePersonaRole(role);
  const dir = join(PERSONAS_DIR, resolved);

  const load = async (file: string): Promise<string | null> => {
    try {
      return await readFile(join(dir, file), "utf8");
    } catch {
      return null;
    }
  };

  return {
    soul: await load("SOUL.md"),
    agents: await load("AGENTS.md"),
    heartbeat: await load("HEARTBEAT.md"),
  };
}

export function mergePersonaBundle(bundle: PersonaBundle): string {
  const parts = [bundle.soul, bundle.agents, bundle.heartbeat].filter(Boolean);
  return parts.join("\n\n---\n\n");
}
