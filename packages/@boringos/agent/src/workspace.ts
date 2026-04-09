import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { slugify } from "@boringos/shared";

const exec = promisify(execFile);

export interface WorkspaceConfig {
  gitRoot: string;
  branchTemplate?: string;
  baseRef?: string;
}

export interface WorkspaceResult {
  cwd: string;
  branch: string;
  created: boolean;
}

/**
 * Provision a git worktree for a task.
 * Creates an isolated branch + directory for the agent to work in.
 */
export async function provisionWorkspace(
  config: WorkspaceConfig,
  task: { identifier?: string; title: string },
): Promise<WorkspaceResult> {
  const template = config.branchTemplate ?? "bos/{{identifier}}-{{slug}}";
  const identifier = task.identifier ?? "task";
  const slug = slugify(task.title).slice(0, 40);

  const branch = template
    .replace("{{identifier}}", identifier)
    .replace("{{slug}}", slug);

  const worktreeDir = join(config.gitRoot, ".boringos", "worktrees", slugify(branch));

  // Check if worktree already exists
  if (existsSync(worktreeDir)) {
    return { cwd: worktreeDir, branch, created: false };
  }

  // Create worktree directory
  mkdirSync(join(config.gitRoot, ".boringos", "worktrees"), { recursive: true });

  const baseRef = config.baseRef ?? "HEAD";

  try {
    // Create new branch from base ref
    await exec("git", ["worktree", "add", "-b", branch, worktreeDir, baseRef], {
      cwd: config.gitRoot,
    });
    return { cwd: worktreeDir, branch, created: true };
  } catch {
    // Branch might already exist
    try {
      await exec("git", ["worktree", "add", worktreeDir, branch], {
        cwd: config.gitRoot,
      });
      return { cwd: worktreeDir, branch, created: false };
    } catch {
      // Fallback — just use the git root
      return { cwd: config.gitRoot, branch: "main", created: false };
    }
  }
}

/**
 * Clean up a git worktree.
 */
export async function cleanupWorkspace(gitRoot: string, worktreePath: string): Promise<void> {
  try {
    await exec("git", ["worktree", "remove", "--force", worktreePath], { cwd: gitRoot });
  } catch {
    // Cleanup failure is non-fatal
  }
}
