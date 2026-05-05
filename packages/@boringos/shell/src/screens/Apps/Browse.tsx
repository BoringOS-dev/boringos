// SPDX-License-Identifier: BUSL-1.1
//
// Browse tab — curated marketplace listings. v1 uses MOCK_LISTINGS;
// Phase 4 swaps this for a real fetch against the marketplace backend.

import { useMemo, useState } from "react";

import { installRuntime } from "../../runtime/install-runtime.js";
import { MOCK_LISTINGS } from "./mockListings.js";
import type { MarketplaceListing } from "./types.js";

export function Browse() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");

  const categories = useMemo(
    () => ["All", ...new Set(MOCK_LISTINGS.map((l) => l.category))],
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return MOCK_LISTINGS.filter((l) => {
      if (category !== "All" && l.category !== category) return false;
      if (!q) return true;
      return (
        l.name.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q)
      );
    });
  }, [query, category]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="flex-1 max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
        >
          {categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 py-8 text-center">
          No apps match.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((l) => (
            <ListingCard key={l.id} listing={l} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ListingCard({ listing }: { listing: MarketplaceListing }) {
  const installed = installRuntime.isInstalled(listing.id);

  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{listing.name}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {listing.publisher}
            {listing.verified && (
              <span className="ml-2 text-emerald-700 font-medium">verified</span>
            )}
            {listing.firstParty && (
              <span className="ml-2 text-blue-700 font-medium">first-party</span>
            )}
          </div>
        </div>
        <span className="text-[10px] font-mono text-slate-400 shrink-0">
          {listing.category}
        </span>
      </div>

      <p className="text-xs text-slate-600 flex-1 mb-3">
        {listing.description}
      </p>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-400">{listing.license}</span>
        <button
          type="button"
          disabled
          title="Install lands in C5 (install pipeline)"
          className={`text-xs px-2.5 py-1 rounded-md ${
            installed
              ? "bg-emerald-50 text-emerald-700 cursor-default"
              : "bg-slate-100 text-slate-500 cursor-not-allowed"
          }`}
        >
          {installed ? "Installed" : "Install"}
        </button>
      </div>
    </li>
  );
}
