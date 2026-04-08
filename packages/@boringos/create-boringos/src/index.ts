#!/usr/bin/env node

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main() {
  const args = process.argv.slice(2);
  const name = args.find((a) => !a.startsWith("--"));
  const template = args.includes("--template")
    ? args[args.indexOf("--template") + 1] ?? "minimal"
    : args.includes("--full") ? "full" : "minimal";

  if (!name || args.includes("--help") || args.includes("-h")) {
    console.log(`
  create-boringos — scaffold a new BoringOS project

  Usage:
    npx create-boringos <project-name> [options]

  Options:
    --template <minimal|full>   Template to use (default: minimal)
    --full                      Shorthand for --template full
    --help                      Show this help

  Examples:
    npx create-boringos my-app
    npx create-boringos my-app --full
`);
    process.exit(name ? 0 : 1);
  }

  if (template !== "minimal" && template !== "full") {
    console.error(`Unknown template: ${template}. Use "minimal" or "full".`);
    process.exit(1);
  }

  const projectDir = resolve(process.cwd(), name);

  if (existsSync(projectDir)) {
    console.error(`Directory already exists: ${projectDir}`);
    process.exit(1);
  }

  console.log(`\nCreating ${name} with ${template} template...\n`);

  // Copy template files
  const templateDir = join(__dirname, "templates", template);
  copyTemplate(templateDir, projectDir, { name });

  // Detect package manager
  const pm = detectPackageManager();

  // Install dependencies
  console.log(`Installing dependencies with ${pm}...\n`);
  try {
    execSync(`${pm} install`, { cwd: projectDir, stdio: "inherit" });
  } catch {
    console.log("\nDependency installation failed. Run it manually:");
    console.log(`  cd ${name} && ${pm} install`);
  }

  console.log(`
Done! Your BoringOS app is ready.

  cd ${name}
  ${pm} run dev

Server starts on http://localhost:3000 with embedded Postgres.
Health check: http://localhost:3000/health
`);
}

function copyTemplate(src: string, dest: string, vars: Record<string, string>): void {
  mkdirSync(dest, { recursive: true });

  for (const entry of readdirSync(src)) {
    const srcPath = join(src, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyTemplate(srcPath, join(dest, entry), vars);
    } else {
      let content = readFileSync(srcPath, "utf8");
      // Replace template variables
      for (const [key, value] of Object.entries(vars)) {
        content = content.replaceAll(`{{${key}}}`, value);
      }
      // Remove .tmpl extension
      const destName = entry.endsWith(".tmpl") ? entry.slice(0, -5) : entry;
      writeFileSync(join(dest, destName), content);
    }
  }
}

function detectPackageManager(): string {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.includes("pnpm")) return "pnpm";
  if (userAgent.includes("yarn")) return "yarn";
  return "npm";
}

main();
