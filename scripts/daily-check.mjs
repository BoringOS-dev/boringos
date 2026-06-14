// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Daily repository health check — build, typecheck, and tests.
// Exit with status 0 if all pass, 1 if any fail.
//
// Usage: node scripts/daily-check.mjs
// Output: summary report to stdout + exit code.

import { execSync } from "node:child_process";

const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

const results = [];

function runCheck(name, command) {
  console.log(`\n${cyan(`[${new Date().toISOString()}]`)} Running: ${name}...`);
  const start = Date.now();
  try {
    execSync(command, { stdio: "inherit" });
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${green("✓")} ${name} passed (${duration}s)`);
    results.push({ name, status: "pass", duration });
    return true;
  } catch (err) {
    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`${red("✗")} ${name} failed (${duration}s)`);
    results.push({ name, status: "fail", duration });
    return false;
  }
}

async function main() {
  console.log(cyan("=".repeat(60)));
  console.log(cyan("  BoringOS Daily Health Check"));
  console.log(cyan("=".repeat(60)));

  const allPassed = [
    runCheck("Build", "pnpm -r build"),
    runCheck("Type check", "pnpm -r typecheck"),
    runCheck("Tests", "pnpm test:run"),
  ].every((x) => x);

  console.log(`\n${cyan("=".repeat(60))}`);
  console.log(cyan("  Summary"));
  console.log(cyan("=".repeat(60)));

  results.forEach((r) => {
    const statusIcon = r.status === "pass" ? green("✓") : red("✗");
    const statusText = r.status === "pass" ? green("PASS") : red("FAIL");
    console.log(`${statusIcon} ${r.name.padEnd(15)} ${statusText.padEnd(12)} ${r.duration}s`);
  });

  const passCount = results.filter((r) => r.status === "pass").length;
  const failCount = results.filter((r) => r.status === "fail").length;

  console.log(`\n${cyan("Results:")} ${green(`${passCount} passed`)}, ${failCount > 0 ? red(`${failCount} failed`) : green("0 failed")}`);
  console.log(cyan("=".repeat(60)));

  if (!allPassed) {
    console.log(`\n${yellow("⚠")}  Daily check did not pass. Review failures above.`);
    process.exit(1);
  }

  console.log(`\n${green("✓")} Daily health check passed!`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
