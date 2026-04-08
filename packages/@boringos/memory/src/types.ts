import type { SkillProvider } from "@boringos/shared";

// ── MemoryProvider — the universal memory interface ──────────────────────────

export interface MemoryProvider extends SkillProvider {
  readonly name: string;

  remember(content: string, meta?: MemoryMeta): Promise<string>;
  recall(query: string, options?: RecallOptions): Promise<RecallResult[]>;
  prime(context: string, options?: PrimeOptions): Promise<string | null>;
  forget(memoryId: string): Promise<void>;
  ping(): Promise<boolean>;
}

// ── Supporting types ─────────────────────────────────────────────────────────

export interface MemoryMeta {
  entityId?: string;
  importance?: number;
  tags?: string[];
  scope?: string;
}

export interface RecallOptions {
  entityId?: string;
  limit?: number;
  scope?: string;
  minScore?: number;
}

export interface PrimeOptions {
  entityId?: string;
  limit?: number;
}

export interface RecallResult {
  id: string;
  content: string;
  score: number;
  meta?: MemoryMeta;
  createdAt?: Date;
}
