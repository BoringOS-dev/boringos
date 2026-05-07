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
// - Tenant menu + user card restored in A4 against the new
//   AuthProvider (was dropped in A3 because auth wasn't lifted yet).
// - Plain Tailwind classes (no custom design tokens). Branded styling
//   lands in A9 via the BrandProvider.

import { useState } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../auth/AuthProvider.js";
import { useBrand } from "../branding/BrandProvider.js";
import { useSlot } from "../slots/context.js";

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const WORKSPACE_ITEMS: NavItem[] = [
  { to: "/home", label: "Home", icon: "⌂" },
  { to: "/copilot", label: "Copilot", icon: "◇" },
  { to: "/inbox", label: "Inbox", icon: "✉" },
  { to: "/calendar", label: "Calendar", icon: "▦" },
  { to: "/tasks", label: "Tasks", icon: "☑" },
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
  const { user, logout, switchTenant } = useAuth();
  const { brand } = useBrand();
  const [showTenantMenu, setShowTenantMenu] = useState(false);

  const hasMultipleTenants = (user?.tenants?.length ?? 0) > 1;

  // App-contributed nav entries. Sorted by label.
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
      {/* Brand / tenant header — A9 BrandProvider personalizes the brand half */}
      <div className="px-2 pb-3 relative">
        <button
          type="button"
          onClick={() => hasMultipleTenants && setShowTenantMenu((v) => !v)}
          className={`flex items-center gap-2 w-full text-left rounded-md px-1 py-1 ${
            hasMultipleTenants ? "hover:bg-slate-100 cursor-pointer" : ""
          }`}
        >
          {brand.logoUrl ? (
            <img
              src={brand.logoUrl}
              alt={brand.productName}
              className="w-5 h-5 object-contain"
            />
          ) : (
            <span className="text-lg" style={{ color: brand.primaryColor }}>
              ◉
            </span>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-900 truncate">
              {user?.tenantName ?? brand.productName}
            </h2>
            {brand.productTagline && (
              <p className="text-[10px] text-slate-400 truncate">
                {brand.productTagline}
              </p>
            )}
          </div>
          {hasMultipleTenants && (
            <span className="text-[10px] text-slate-400">▼</span>
          )}
        </button>

        {showTenantMenu && user?.tenants && (
          <div className="absolute left-2 right-2 top-full mt-1 rounded-md border border-slate-200 bg-white shadow-md z-50">
            {user.tenants.map((t) => (
              <button
                key={t.tenantId}
                type="button"
                onClick={() => {
                  void switchTenant(t.tenantId);
                  setShowTenantMenu(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors ${
                  t.tenantId === user.tenantId
                    ? "font-medium text-blue-600"
                    : "text-slate-700"
                }`}
              >
                {t.tenantName}
                <span className="ml-2 text-xs text-slate-400">{t.role}</span>
              </button>
            ))}
          </div>
        )}
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

      {user && (
        <div className="mt-auto border-t border-slate-200 pt-3 px-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-slate-900 truncate">
                {user.name}
              </div>
              <div className="text-xs text-slate-400 truncate">{user.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-2 w-full text-left px-2 py-1 rounded text-xs text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
          >
            Sign out
          </button>
        </div>
      )}
    </aside>
  );
}
