import { readdir, readFile, symlink, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { eq, and } from "drizzle-orm";
import type { Db } from "@boringos/db";
import { companySkills, agentSkills } from "@boringos/db";

export interface SkillSyncConfig {
  cacheDir: string;
}

export interface InjectedSkill {
  key: string;
  path: string;
  skillId: string;
}

const TRUST_EXTENSIONS: Record<string, string[]> = {
  markdown_only: [".md", ".txt"],
  assets: [".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".png", ".jpg", ".svg"],
  scripts_executables: [], // allow all
};

/**
 * Sync a skill from its source to the cache directory.
 */
export async function syncSkill(
  skill: { id: string; sourceType: string; sourceConfig: Record<string, unknown>; trustLevel: string },
  config: SkillSyncConfig,
): Promise<string> {
  const skillDir = join(config.cacheDir, skill.id);
  await mkdir(skillDir, { recursive: true });

  switch (skill.sourceType) {
    case "local_path": {
      const sourcePath = skill.sourceConfig.path as string;
      // Copy files respecting trust level
      await copyWithTrust(sourcePath, skillDir, skill.trustLevel);
      break;
    }
    case "github": {
      const repo = skill.sourceConfig.repo as string;
      const path = skill.sourceConfig.path as string ?? ".";
      const ref = skill.sourceConfig.ref as string ?? "main";
      // Download from GitHub API
      const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`;
      const res = await fetch(url, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });
      if (res.ok) {
        const items = await res.json() as Array<{ name: string; download_url: string; type: string }>;
        for (const item of items) {
          if (item.type === "file" && isAllowedByTrust(item.name, skill.trustLevel)) {
            const content = await fetch(item.download_url).then((r) => r.text());
            const { writeFile } = await import("node:fs/promises");
            await writeFile(join(skillDir, item.name), content);
          }
        }
      }
      break;
    }
    case "url": {
      const url = skill.sourceConfig.url as string;
      const res = await fetch(url);
      if (res.ok) {
        const content = await res.text();
        const filename = basename(new URL(url).pathname) || "skill.md";
        const { writeFile } = await import("node:fs/promises");
        await writeFile(join(skillDir, filename), content);
      }
      break;
    }
  }

  return skillDir;
}

/**
 * Inject skills into an agent's working directory.
 * Creates symlinks from cache to {workDir}/.claude/skills/{key}/
 */
export async function injectSkills(
  db: Db,
  agentId: string,
  workDir: string,
  config: SkillSyncConfig,
): Promise<InjectedSkill[]> {
  const links = await db.select({
    skillId: agentSkills.skillId,
    key: companySkills.key,
  }).from(agentSkills)
    .innerJoin(companySkills, eq(agentSkills.skillId, companySkills.id))
    .where(and(eq(agentSkills.agentId, agentId), eq(agentSkills.state, "active")));

  const skillsDir = join(workDir, ".claude", "skills");
  await mkdir(skillsDir, { recursive: true });

  const injected: InjectedSkill[] = [];

  for (const link of links) {
    const cachePath = join(config.cacheDir, link.skillId);
    if (!existsSync(cachePath)) continue;

    const targetPath = join(skillsDir, link.key);
    try {
      if (existsSync(targetPath)) await rm(targetPath, { recursive: true });
      await symlink(cachePath, targetPath);
      injected.push({ key: link.key, path: targetPath, skillId: link.skillId });
    } catch {
      // Symlink failure — skip this skill
    }
  }

  return injected;
}

function isAllowedByTrust(filename: string, trustLevel: string): boolean {
  const allowed = TRUST_EXTENSIONS[trustLevel];
  if (!allowed || allowed.length === 0) return true; // scripts_executables allows all
  return allowed.some((ext) => filename.endsWith(ext));
}

async function copyWithTrust(src: string, dest: string, trustLevel: string): Promise<void> {
  if (!existsSync(src)) return;
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && isAllowedByTrust(entry.name, trustLevel)) {
      const content = await readFile(join(src, entry.name));
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(dest, entry.name), content);
    }
  }
}
