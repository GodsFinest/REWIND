import { FolderOpen } from "lucide-react";
import type { CopyState, RecoveryState, SnapshotSummary } from "./api";
export const statusInfo: Record<
  RecoveryState,
  { label: string; short: string; color: string }
> = {
  VERIFIED_RECOVERABLE: {
    label: "Verified recoverable",
    short: "Verified",
    color: "good",
  },
  PRESENT_BUT_UNVERIFIED: {
    label: "Present, unverified",
    short: "Unverified",
    color: "neutral",
  },
  UNKNOWN: { label: "Possibly recoverable", short: "Unknown", color: "warn" },
  KNOWN_UNRECOVERABLE: {
    label: "Known unrecoverable",
    short: "Lost",
    color: "bad",
  },
  INVALID_METADATA: {
    label: "Invalid metadata",
    short: "Invalid",
    color: "bad",
  },
};
export const copyLabels: Record<CopyState, string> = {
  VERIFIED_OK: "Verified bytes",
  CORRUPT: "Hash mismatch",
  MISSING: "Missing",
  BACKEND_UNAVAILABLE: "Unavailable",
  NOT_YET_VERIFIED: "Not verified",
  IO_ERROR: "Read error",
};
export const stateKeys = Object.keys(statusInfo) as RecoveryState[];
export function bytes(n: number) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(n)) / Math.log(1024)), 4);
  return `${(n / 1024 ** i).toLocaleString(undefined, { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}
export function date(s?: string) {
  return s
    ? new Date(s).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not yet scanned";
}
export function short(s: string) {
  return s.slice(0, 10);
}
export function Status({
  state,
  compact = false,
}: {
  state?: RecoveryState;
  compact?: boolean;
}) {
  const info = statusInfo[state ?? "PRESENT_BUT_UNVERIFIED"];
  return (
    <span className={`status ${info.color}`}>
      <i />
      {compact ? info.short : info.label}
    </span>
  );
}
export function Empty({
  icon: Icon = FolderOpen,
  title,
  children,
}: {
  icon?: typeof FolderOpen;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Icon size={28} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function SnapshotSelect({
  snapshots,
  value,
  onChange,
  disabled = false,
}: {
  snapshots: SnapshotSummary[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Selected snapshot"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled || !snapshots.length}
    >
      {!snapshots.length && <option value="">No snapshots yet</option>}
      {snapshots.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label || short(s.id)} · {date(s.createdAt)}
        </option>
      ))}
    </select>
  );
}
export function saveJSON(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
