/**
 * Phase 7 Smoke Tests — CLI Generator (create-boringos)
 *
 * Tests that the CLI scaffolds projects correctly with both templates.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(
  import.meta.dirname ?? ".",
  "../packages/@boringos/create-boringos/dist/index.js",
);

describe("create-boringos CLI", () => {
  it("shows help with --help", () => {
    // --help with a name exits 0, without a name exits 1
    const output = execFileSync("node", [CLI_PATH, "dummy", "--help"], { encoding: "utf8" });
    expect(output).toContain("create-boringos");
    expect(output).toContain("--template");
  });

  it("scaffolds minimal template", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-test-"));
    const projectDir = join(tmp, "my-app");

    // Run CLI (will fail on npm install since packages aren't published, that's OK)
    try {
      execFileSync("node", [CLI_PATH, "my-app"], { cwd: tmp, encoding: "utf8" });
    } catch {
      // npm install failure is expected
    }

    // Verify files were created
    expect(existsSync(join(projectDir, "package.json"))).toBe(true);
    expect(existsSync(join(projectDir, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(projectDir, "src/index.ts"))).toBe(true);
    expect(existsSync(join(projectDir, ".env.example"))).toBe(true);
    expect(existsSync(join(projectDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(projectDir, "README.md"))).toBe(true);

    // Verify template variables replaced
    const pkg = readFileSync(join(projectDir, "package.json"), "utf8");
    expect(pkg).toContain('"name": "my-app"');
    expect(pkg).toContain("@boringos/core");

    const index = readFileSync(join(projectDir, "src/index.ts"), "utf8");
    expect(index).toContain("BoringOS");
    expect(index).not.toContain("{{name}}"); // no unreplaced vars
  });

  it("scaffolds full template", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-test-"));
    const projectDir = join(tmp, "full-app");

    try {
      execFileSync("node", [CLI_PATH, "full-app", "--full"], { cwd: tmp, encoding: "utf8" });
    } catch {
      // npm install failure expected
    }

    expect(existsSync(join(projectDir, "package.json"))).toBe(true);
    expect(existsSync(join(projectDir, "src/index.ts"))).toBe(true);

    const pkg = readFileSync(join(projectDir, "package.json"), "utf8");
    expect(pkg).toContain('"name": "full-app"');
    expect(pkg).toContain("@boringos/connector-slack");
    expect(pkg).toContain("@boringos/connector-google");
    expect(pkg).toContain("@boringos/pipeline");

    const index = readFileSync(join(projectDir, "src/index.ts"), "utf8");
    expect(index).toContain("createHebbsMemory");
    expect(index).toContain("slack");
    expect(index).toContain("google");
    expect(index).toContain("createBullMQQueue");
    expect(index).not.toContain("{{name}}");
  });

  it("fails for existing directory", () => {
    const tmp = mkdtempSync(join(tmpdir(), "cli-test-"));
    const projectDir = join(tmp, "exists");
    mkdirSync(projectDir, { recursive: true });

    expect(() => {
      execFileSync("node", [CLI_PATH, "exists"], { cwd: tmp, encoding: "utf8", stdio: "pipe" });
    }).toThrow();
  });
});
