// SPDX-License-Identifier: BUSL-1.1
//
// Capability grouping for the install-time permission prompt.
// Pure helper — no React.

export interface CapabilityCategory {
  label: string;
  matches: (cap: string) => boolean;
}

/**
 * Categories the permission prompt groups capabilities into. Order
 * matters: a capability is placed in the first category that matches.
 */
export const CAPABILITY_CATEGORIES: readonly CapabilityCategory[] = [
  {
    label: "Data",
    matches: (c) => c.startsWith("entities."),
  },
  {
    label: "Agents & Workflows",
    matches: (c) =>
      c.startsWith("agents.") ||
      c.startsWith("agents:") ||
      c.startsWith("workflows.") ||
      c.startsWith("workflows:") ||
      c.startsWith("events:"),
  },
  {
    label: "UI",
    matches: (c) => c.startsWith("slots:") || c.startsWith("actions:expose"),
  },
  {
    label: "Integrations",
    matches: (c) =>
      c.startsWith("connectors") ||
      c.startsWith("auth:") ||
      c.startsWith("network:") ||
      c.startsWith("webhooks:"),
  },
  { label: "Inbox", matches: (c) => c.startsWith("inbox:") },
  { label: "Memory", matches: (c) => c.startsWith("memory:") },
] as const;

export interface CapabilityGroup {
  label: string;
  items: string[];
}

/**
 * Group capabilities into the prompt's display categories. Returns
 * only non-empty groups, plus a synthetic "Other" group for any
 * capability that doesn't match a known category.
 */
export function groupCapabilities(caps: readonly string[]): CapabilityGroup[] {
  const groups: CapabilityGroup[] = CAPABILITY_CATEGORIES.map((c) => ({
    label: c.label,
    items: [],
  }));
  const other: string[] = [];

  for (const cap of caps) {
    let placed = false;
    for (let i = 0; i < CAPABILITY_CATEGORIES.length; i++) {
      if (CAPABILITY_CATEGORIES[i]!.matches(cap)) {
        groups[i]!.items.push(cap);
        placed = true;
        break;
      }
    }
    if (!placed) other.push(cap);
  }

  if (other.length > 0) groups.push({ label: "Other", items: other });
  return groups.filter((g) => g.items.length > 0);
}
