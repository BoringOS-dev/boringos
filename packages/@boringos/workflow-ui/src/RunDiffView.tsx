import { useWorkflowRun } from "./hooks.js";
import type { BlockRun, BlockRunStatus } from "./types.js";

function statusDot(status: BlockRunStatus | string): string {
  return status === "completed" ? "bg-text-green"
    : status === "failed" ? "bg-text-red"
    : status === "running" ? "bg-text-amber animate-pulse"
    : status === "skipped" ? "bg-text-tertiary"
    : status === "waiting" ? "bg-text-purple"
    : "bg-text-secondary";
}

function shallowEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Compact, aligned side-by-side view of two runs' blocks. Highlights every
 * block whose status, error, or output differs between the two runs — which
 * is the whole point of picking "diff" over "open both in tabs."
 */
export function RunDiffView({
  runIdA,
  runIdB,
  onClose,
}: { runIdA: string; runIdB: string; onClose: () => void }) {
  const a = useWorkflowRun(runIdA);
  const b = useWorkflowRun(runIdB);

  if (a.isLoading || b.isLoading) {
    return <div className="text-sm text-text-secondary p-6">Loading runs…</div>;
  }
  if (!a.data || !b.data) {
    return (
      <div className="text-sm text-text-secondary p-6">
        One of the runs could not be loaded. <button className="underline" onClick={onClose}>Close</button>
      </div>
    );
  }

  // Build a blockId-keyed map for each run so we align rows by their
  // underlying block (not by execution order — replays can differ in order
  // if the DAG has parallel branches).
  const byId = (blocks: BlockRun[]) => {
    const m = new Map<string, BlockRun>();
    for (const bl of blocks) m.set(bl.blockId, bl);
    return m;
  };
  const mapA = byId(a.data.blocks);
  const mapB = byId(b.data.blocks);
  const allIds = Array.from(new Set([...mapA.keys(), ...mapB.keys()]));

  return (
    <div className="border border-border rounded-md bg-bg">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="text-sm">
          <span className="text-text-tertiary">Comparing</span>{" "}
          <span className="font-mono text-text-primary">{runIdA.slice(0, 8)}</span>
          <span className="text-text-tertiary"> ↔ </span>
          <span className="font-mono text-text-primary">{runIdB.slice(0, 8)}</span>
        </div>
        <button onClick={onClose} className="text-xs text-text-tertiary hover:text-text-secondary">Close</button>
      </header>

      <div className="grid grid-cols-[auto_1fr_1fr] text-xs">
        <div className="contents font-semibold text-text-tertiary uppercase tracking-wide">
          <div className="px-3 py-2 border-b border-border">Block</div>
          <div className="px-3 py-2 border-b border-border border-l border-border">A · {runIdA.slice(0, 8)}</div>
          <div className="px-3 py-2 border-b border-border border-l border-border">B · {runIdB.slice(0, 8)}</div>
        </div>

        {allIds.map((blockId) => {
          const ba = mapA.get(blockId);
          const bb = mapB.get(blockId);
          const statusDiffers = (ba?.status ?? "missing") !== (bb?.status ?? "missing");
          const errorDiffers = (ba?.error ?? null) !== (bb?.error ?? null);
          const outputDiffers = !shallowEqual(ba?.output ?? null, bb?.output ?? null);
          const anyDiff = statusDiffers || errorDiffers || outputDiffers;

          return (
            <div key={blockId} className={`contents ${anyDiff ? "bg-bg-secondary" : ""}`}>
              <div className="px-3 py-2 border-b border-border font-mono text-text-primary">
                {ba?.blockName ?? bb?.blockName ?? blockId}
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide">
                  {ba?.blockType ?? bb?.blockType}
                </div>
              </div>
              <RunCell block={ba} diff={{ status: statusDiffers, error: errorDiffers, output: outputDiffers }} />
              <RunCell block={bb} diff={{ status: statusDiffers, error: errorDiffers, output: outputDiffers }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RunCell({
  block,
  diff,
}: { block: BlockRun | undefined; diff: { status: boolean; error: boolean; output: boolean } }) {
  if (!block) {
    return (
      <div className="px-3 py-2 border-b border-border border-l border-border italic text-text-tertiary">
        (not present)
      </div>
    );
  }
  return (
    <div className="px-3 py-2 border-b border-border border-l border-border space-y-1">
      <div className={`flex items-center gap-2 ${diff.status ? "text-text-amber font-semibold" : ""}`}>
        <span className={`w-2 h-2 rounded-full ${statusDot(block.status)}`} />
        <span className="uppercase tracking-wide text-[10px] font-semibold">{block.status}</span>
        {block.durationMs !== null && <span className="text-text-tertiary">{block.durationMs}ms</span>}
      </div>
      {block.error && (
        <div className={`text-text-red text-[11px] truncate ${diff.error ? "font-semibold" : ""}`} title={block.error}>
          {block.error}
        </div>
      )}
      {block.output && Object.keys(block.output).length > 0 && (
        <pre className={`text-[10px] bg-bg border border-border rounded p-1 overflow-x-auto max-h-24 ${diff.output ? "border-text-amber" : ""}`}>
          {JSON.stringify(block.output, null, 2)}
        </pre>
      )}
    </div>
  );
}
