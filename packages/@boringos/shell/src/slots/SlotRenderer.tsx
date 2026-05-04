// SPDX-License-Identifier: BUSL-1.1
//
// SlotRenderer — renders all contributions to a "component" slot
// family (pages, dashboardWidgets, entityDetailPanels, settingsPanels).
//
// Action / handler / tool families (entityActions, copilotTools,
// commandActions, inboxHandlers) are not rendered here — they're
// surfaced by domain-specific UI (action bars, command bar, etc.) that
// uses the useSlot hook directly. Those land in A3+ and aren't shaped
// like generic component lists.
//
// The component is type-safe via the F generic: rendering "pages" is
// only valid for NavSlot contributions; rendering "dashboardWidgets"
// only for DashboardWidget; etc.

import { Fragment, createElement, type ReactNode } from "react";

import { useSlot } from "./context.js";
import type { SlotContribution } from "./types.js";

/**
 * The subset of slot families that have a `component` field whose
 * contributions are renderable as React components.
 */
type ComponentSlotFamily =
  | "pages"
  | "dashboardWidgets"
  | "entityDetailPanels"
  | "settingsPanels";

interface SlotRendererProps<F extends ComponentSlotFamily> {
  /** The slot family to render. */
  family: F;

  /** Optional: render only the contribution with this slot id. */
  id?: string;

  /** Optional: render only contributions from a specific app. */
  appId?: string;

  /**
   * Optional: extra props forwarded to each rendered component.
   * Used by entityDetailPanels (which receive `{ entity }`) and any
   * other slot whose component type accepts props.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentProps?: Record<string, any>;

  /** Rendered if no contributions match. */
  empty?: ReactNode;
}

/**
 * Renders every matching contribution to a component-shaped slot family.
 *
 * @example
 *   <SlotRenderer family="dashboardWidgets" />
 *   <SlotRenderer family="entityDetailPanels" componentProps={{ entity }} />
 *   <SlotRenderer family="pages" id="pipeline" empty={<NotFound />} />
 */
export function SlotRenderer<F extends ComponentSlotFamily>({
  family,
  id,
  appId,
  componentProps,
  empty = null,
}: SlotRendererProps<F>): ReactNode {
  const contributions = useSlot(family, { id, appId });

  if (contributions.length === 0) return <>{empty}</>;

  return (
    <>
      {contributions.map((c) => (
        <SlotItem
          key={`${c.appId}/${c.slotId}`}
          contribution={c}
          componentProps={componentProps}
        />
      ))}
    </>
  );
}

function SlotItem<F extends ComponentSlotFamily>({
  contribution,
  componentProps,
}: {
  contribution: SlotContribution<F>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  componentProps?: Record<string, any>;
}): ReactNode {
  // Each component-shaped slot exposes its renderable as `.slot.component`
  // (NavSlot, DashboardWidget, EntityDetailPanel, SettingsPanel all share
  // this shape per the SDK's slots.ts). We coerce to a callable ReactNode
  // factory and invoke with forwarded props.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slot = contribution.slot as any;
  const Component = slot.component;

  if (typeof Component !== "function") {
    return (
      <Fragment>
        {/* Defensive: an app contributed a slot without a callable component */}
      </Fragment>
    );
  }

  return createElement(Component as (props: unknown) => ReactNode, {
    ...(componentProps ?? {}),
  });
}
