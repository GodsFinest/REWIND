export type Scope = "original" | "lab";
export interface RecoveryRecommendation {
  scope: Scope;
  repositoryId: string;
  scan: { id: string; at: string; deep: true };
  newestComplete?: string;
  eligibleVersions: {
    path: string;
    snapshotId: string;
    hash: string;
    size: number;
  }[];
  warning: string;
}
export type RecoveryState =
  | "VERIFIED_RECOVERABLE"
  | "PRESENT_BUT_UNVERIFIED"
  | "UNKNOWN"
  | "KNOWN_UNRECOVERABLE"
  | "INVALID_METADATA";
export type CopyState =
  | "VERIFIED_OK"
  | "CORRUPT"
  | "MISSING"
  | "BACKEND_UNAVAILABLE"
  | "NOT_YET_VERIFIED"
  | "IO_ERROR";
export type FaultKind =
  | "missing"
  | "corrupt"
  | "unavailable"
  | "io-error"
  | "manifest";
export interface SnapshotSummary {
  id: string;
  createdAt: string;
  label: string;
  files: number;
  bytes: number;
  state?: RecoveryState;
  counts?: Record<RecoveryState, number>;
  degraded?: string[];
}
export interface FileRow {
  path: string;
  type: "file" | "directory";
  size: number;
  hash?: string;
  chunks: number;
  state: RecoveryState;
  snapshotId: string;
  versions?: { snapshotId: string; state: RecoveryState; hash?: string }[];
}
export interface CopyEvidence {
  backend: string;
  state: CopyState;
  detail?: string;
}
export interface ChunkEvidence {
  hash: string;
  size: number;
  start: number;
  end: number;
  copies: CopyEvidence[];
  affectedVersions: number;
}
export interface Explanation {
  snapshotId: string;
  path: string;
  hash?: string;
  state: RecoveryState;
  reason: string;
  chunks: ChunkEvidence[];
  alternatives: { snapshotId: string; state: RecoveryState }[];
}
export interface ReceiptSummary {
  id: string;
  destination: string;
  snapshotId: string;
  status: string;
  files: number;
  bytes: number;
  createdAt: string;
  verified?: boolean;
}
export interface AppState {
  ready: boolean;
  scope: Scope;
  repository?: { id: string; source: string; roots: string[]; isDemo: boolean };
  snapshots: SnapshotSummary[];
  files: FileRow[];
  totalFiles: number;
  offset: number;
  stats: {
    logicalBytes: number;
    uniqueBytes: number;
    physicalBytes: number;
    metadataBytes: number;
    dedupSavings: number;
    chunks: number;
  };
  scan?: {
    id: string;
    at: string;
    deep: boolean;
    durationMs: number;
    counts: Record<string, number>;
  };
  lab?: { id: string; seed: number; actions: unknown[] };
  receipts: ReceiptSummary[];
  warnings: string[];
  newestVerified?: string;
  invalidMetadata: string[];
  evaluation?: unknown;
}
export type Request =
  | {
      action: "state";
      scope?: Scope;
      offset?: number;
      search?: string;
      snapshotId?: string;
      filter?: RecoveryState;
    }
  | { action: "demo" }
  | { action: "setup"; source: string; roots: [string, string] }
  | { action: "capture"; label?: string }
  | { action: "demo-edit" }
  | { action: "scan"; scope: Scope; deep: boolean }
  | { action: "plan-recovery"; scope: Scope }
  | { action: "create-lab"; seed: number }
  | { action: "fault"; kind: FaultKind; backend: number; hash?: string }
  | { action: "replay-lab" }
  | { action: "explain"; scope: Scope; snapshotId: string; path: string }
  | { action: "diff"; scope: Scope; before: string; after: string }
  | {
      action: "restore";
      scope: Scope;
      snapshotId: string;
      parent: string;
      name: string;
      paths?: string[];
    }
  | { action: "verify"; id: string }
  | { action: "rebuild"; scope: Scope }
  | { action: "repair-plan"; scope: Scope; target: number; budget: number }
  | { action: "scenario" };
export interface Progress {
  phase: string;
  completed: number;
  total?: number;
  detail?: string;
}
export interface Bridge {
  request<T = AppState>(request: Request): Promise<T>;
  pickFolder(): Promise<string | null>;
  openOutput(id: string): Promise<void>;
  cancel(): Promise<void>;
  onProgress(callback: (progress: Progress) => void): () => void;
}
declare global {
  interface Window {
    rewind: Bridge;
  }
}
