// SPDX-License-Identifier: BUSL-1.1
//
// Shell sidebar — fixed nav + app-contributed nav from the slot registry.
// Lifted from boringos-crm/packages/web/src/components/Sidebar.tsx.
//
// Differences vs the CRM original:
// - CRM-specific NAV_ITEMS removed. The shell ships a fixed set of
//   shell-mandatory entries (Home, Copilot, Inbox, Tasks, Drive, etc.).
// - App-contributed nav entries are read from the slot registry via
//   useSlot("pages") and rendered between the "Workspace" and "Tools"
//   groups.
// - Tenant menu + user menu removed for A3 — they depend on auth,
//   which lands in A4. They'll come back then.
// - Plain Tailwind classes (no custom design tokens). Branded styling
//   lands in A9 via the BrandProvider.

import { NavLink } from "react-router-dom";

import { useSlot } from "../slots/context.js";

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { to: "/home", label: "Home", icon: "☀" },
  { to: "/copilot", label: "Copilot", icon: "◇" },
  { to: "/inbox", label: "Inbox", icon: "✉" },
  { to: "/tasks", label: "Tasks", icon: "☑" },
  { to: "/approvals", label: "Approvals", icon: "→" },
];

const TOOL_ITEMS: NavItem[] = [
  { to: "/agents", label: "Agents", icon: "⁂" },
  { to: "/workflows", label: "Workflows", icon: "⇒" },
  { to: "/drive", label: "Drive", icon: "≡" },
  { to: "/connectors", label: "Connectors", icon: "⌆" },
  { to: "/apps", label: "Apps", icon: "▣" },
];

const ADMIN_ITEMS: NavItem[] = [
  { to: "/activity", label: "Activity", icon: "☰" },
  { to: "/team", label: "Team", icon: "☶" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

const linkClasses = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
    isActive
      ? "bg-slate-100 text-slate-900 font-medium"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
  }`;

function NavGroup({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} className={linkClasses}>
          <span className="w-[18px] text-center text-[15px] shrink-0">
            {item.icon}
          </span>
          <span className="flex-1">{item.label}</span>
        </NavLink>
      ))}
    </>
  );
}

function GroupHeading({ children }: { children: string }) {
  return (
    <div className="mt-4 mb-1 px-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {children}
      </div>
    </div>
  );
}

export function Sidebar() {
  // App-contributed nav entries. Sorted by `order` ascending; ties by label.
  const appPages = useSlot("pages");
  const appNavItems: { appId: string; nav: NavItem }[] = appPages
    .map((c) => ({
      appId: c.appId,
      nav: {
        to: `/${c.appId}/${c.slotId}`,
        label: c.slot.id,
        icon: "◈",
      },
    }))
    .sort((a, b) => a.nav.label.localeCompare(b.nav.label));

  return (
    <aside className="w-[248px] bg-slate-50 border-r border-slate-200 p-2 flex flex-col shrink-0 overflow-y-auto">
      {/* Brand header — A9 will replace this with BrandProvider */}
      <div className="px-3 pt-2 pb-3">
        <h2 className="text-sm font-semibold text-slate-900">BoringOS</h2>
      </div>

      <nav className="flex flex-col gap-0.5 flex-1">
        <NavGroup items={WORKSPACE_ITEMS} />

        {appNavItems.length > 0 && (
          <>
            <GroupHeading>Apps</GroupHeading>
            {appNavItems.map(({ appId, nav }) => (
              <NavLink key={`${appId}/${nav.to}`} to={nav.to} className={linkClasses}>
                <span className="w-[18px] text-center text-[15px] shrink-0">
                  {nav.icon}
                </span>
                <span className="flex-1">{nav.label}</span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {appId}
                </span>
              </NavLink>
            ))}
          </>
        )}

        <GroupHeading>Tools</GroupHeading>
        <NavGroup items={TOOL_ITEMS} />

        <GroupHeading>Admin</GroupHeading>
        <NavGroup items={ADMIN_ITEMS} />
      </nav>

      {/* User card lands in A4 with auth */}
    </aside>
  );
}
