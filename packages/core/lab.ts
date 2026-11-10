import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type Repository,
  openRepository,
  objectPath,
  listSnapshots,
  backendAvailable,
  readObject,
} from "./repository.js";
import {
  assertSeparate,
  atomicWrite,
  contains,
  noSymlinks,
  readBounded,
  withLock,
} from "./fs.js";
import { canonical, digest, sha } from "./schema.js";
import type { FaultKind } from "../../apps/desktop/api.js";
export interface LabAction {
  kind: FaultKind;
  backend: number;
  hash?: string;
  status: "APPLIED";
}
export interface Scenario {
  version: 1;
  id: string;
  repositoryId: string;
  seed: number;
  manifestVersion: 1;
  snapshotIds?: string[];
  actions: LabAction[];
}
export interface LabHandle {
  readonly id: string;
  readonly seed: number;
}
export class IneligibleFaultTargetError extends Error {
  readonly code = "INELIGIBLE_FAULT_TARGET";
}
interface InternalLab {
  home: string;
  managed: string;
  nonce: string;
  scenario: Scenario;
  repo: Repository;
}
const capabilities = new WeakMap<LabHandle, InternalLab>();
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
async function physicalCopy(source: string, target: string) {
  await noSymlinks(source);
  await fs.mkdir(target, { mode: 0o700 });
  for (const e of await fs.readdir(source, { withFileTypes: true })) {
    if (e.isSymbolicLink()) throw new Error("Lab refuses symlink storage");
    const from = path.join(source, e.name),
      to = path.join(target, e.name);
    if (e.isDirectory()) await physicalCopy(from, to);
    else if (e.isFile()) {
      await noSymlinks(from);
      await fs.copyFile(from, to, fs.constants.COPYFILE_EXCL);
      const a = await fs.stat(from),
        b = await fs.stat(to);
      if (a.dev === b.dev && a.ino === b.ino)
        throw new Error("Lab copy must not be hardlinked");
    } else throw new Error("Unsupported lab storage entry");
  }
}
function handle(internal: InternalLab) {
  const value = Object.freeze({
    id: internal.scenario.id,
    seed: internal.scenario.seed,
  });
  capabilities.set(value, internal);
  return value;
}
export async function createFaultLab(
  repo: Repository,
  managedRoot: string,
  seed = 42,
): Promise<LabHandle> {
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffffffff)
    throw new Error("Seed must be 1..4294967295");
  const managed = await noSymlinks(managedRoot, true);
  await assertSeparate([
    managed,
    repo.home,
    repo.config.source,
    ...repo.config.roots,
  ]);
  await fs.mkdir(managed, { recursive: true, mode: 0o700 });
  const id = randomUUID(),
    home = path.join(managed, id),
    nonce = randomUUID();
  await fs.mkdir(home, { mode: 0o700 });
  for (let b = 0; b < 2; b++)
    await physicalCopy(
      repo.config.roots[b],
      path.join(home, b ? "backend-b" : "backend-a"),
    );
  const catalog = path.join(home, "catalog");
  await fs.mkdir(catalog);
  for (const dir of ["receipts", "restore-intents"])
    await fs.mkdir(path.join(catalog, dir));
  const config = {
    ...repo.config,
    roots: [path.join(home, "backend-a"), path.join(home, "backend-b")],
  };
  await atomicWrite(path.join(catalog, "repository.json"), canonical(config));
  const scenario: Scenario = {
    version: 1,
    id,
    repositoryId: repo.config.id,
    seed,
    manifestVersion: 1,
    snapshotIds: (await listSnapshots(repo)).map((s) => s.id).sort(),
    actions: [],
  };
  await atomicWrite(
    path.join(home, "lab-capability.json"),
    canonical({ version: 1, id, nonce }),
  );
  await atomicWrite(path.join(home, "scenario.json"), canonical(scenario));
  return handle({
    home,
    managed,
    nonce,
    scenario,
    repo: await openRepository(catalog),
  });
}
export async function openFaultLab(managedRoot: string, id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid lab id");
  const managed = await noSymlinks(managedRoot),
    home = await noSymlinks(path.join(managed, id));
  if (!contains(managed, home) || home === managed)
    throw new Error("Invalid lab containment");
  const marker = JSON.parse(
    (
      await readBounded(path.join(home, "lab-capability.json"), 2048)
    ).toString(),
  );
  if (marker.version !== 1 || marker.id !== id)
    throw new Error("Invalid lab marker");
  const scenario = JSON.parse(
    (
      await readBounded(path.join(home, "scenario.json"), 1024 * 1024)
    ).toString(),
  ) as Scenario;
  if (scenario.version !== 1 || scenario.id !== id)
    throw new Error("Invalid lab scenario");
  const repo = await openRepository(path.join(home, "catalog"));
  const internal = { home, managed, nonce: marker.nonce, scenario, repo };
  for (const a of scenario.actions) {
    if (a.kind === "unavailable") (repo.disabled ??= new Set()).add(a.backend);
    if (a.kind === "io-error") (repo.ioErrors ??= new Set()).add(a.backend);
  }
  return handle(internal);
}
async function checked(value: LabHandle) {
  const c = capabilities.get(value);
  if (!c)
    throw new Error(
      "Fault API accepts only an internally issued laboratory handle",
    );
  const home = await noSymlinks(c.home),
    managed = await noSymlinks(c.managed);
  if (home !== c.home || !contains(managed, home) || home === managed)
    throw new Error("Lab path escape rejected");
  const marker = JSON.parse(
    (
      await readBounded(path.join(home, "lab-capability.json"), 2048)
    ).toString(),
  );
  if (marker.nonce !== c.nonce || marker.id !== value.id)
    throw new Error("Lab capability changed");
  for (let b = 0; b < 2; b++) {
    const expected = path.join(home, b ? "backend-b" : "backend-a");
    if (c.repo.config.roots[b] !== expected) throw new Error("Lab root escape");
    await noSymlinks(expected);
  }
  return c;
}
export async function labRepository(value: LabHandle): Promise<Repository> {
  const c = await checked(value);
  return {
    ...c.repo,
    config: { ...c.repo.config, roots: [...c.repo.config.roots] },
    disabled: new Set(c.repo.disabled),
    ioErrors: new Set(c.repo.ioErrors),
  };
}
export async function scenarioRecord(value: LabHandle) {
  return structuredClone((await checked(value)).scenario);
}
export async function injectFault(
  value: LabHandle,
  kind: FaultKind,
  backend: number,
  selectedHash?: string,
) {
  const c = await checked(value);
  if (
    !["missing", "corrupt", "unavailable", "io-error", "manifest"].includes(
      kind,
    ) ||
    ![0, 1].includes(backend)
  )
    throw new Error("Invalid fault operation");
  return withLock(c.home, async () => {
    // Reload under the lock so reopened handles share the same persisted action index.
    c.scenario = JSON.parse(
      (
        await readBounded(path.join(c.home, "scenario.json"), 1024 * 1024)
      ).toString(),
    ) as Scenario;
    for (const a of c.scenario.actions) {
      if (a.kind === "unavailable")
        (c.repo.disabled ??= new Set()).add(a.backend);
      if (a.kind === "io-error") (c.repo.ioErrors ??= new Set()).add(a.backend);
    }
    let hash = selectedHash;
    if (hash !== undefined) digest.parse(hash);
    const snapshots = await listSnapshots(c.repo);
    const chunks = new Map(
      snapshots.flatMap((s) =>
        (s.manifest?.entries || []).flatMap((e) =>
          e.type === "file"
            ? e.chunks.map((chunk) => [chunk.hash, chunk] as const)
            : [],
        ),
      ),
    );
    if (kind === "missing" || kind === "corrupt" || kind === "manifest") {
      if (
        !(await backendAvailable(c.repo, backend)) ||
        c.repo.ioErrors?.has(backend)
      )
        throw new Error(
          "Target backend is unavailable or has a simulated I/O error",
        );
    }
    if (kind === "missing" || kind === "corrupt") {
      if (hash && !chunks.has(hash))
        throw new Error("Object is not referenced by lab manifests");
      // Both operations require a currently intact copy. Missing/corrupt/unreadable
      // copies cannot count as a newly applied fault, and XOR never repairs damage.
      const eligible: string[] = [];
      for (const candidate of hash ? [hash] : [...chunks.keys()].sort()) {
        try {
          await readObject(c.repo, backend, chunks.get(candidate)!);
          eligible.push(candidate);
        } catch (e) {
          if (hash)
            throw new IneligibleFaultTargetError(
              "Not an intact eligible target (already corrupted, missing or unreadable): " +
                (e as Error).message,
            );
        }
      }
      if (!eligible.length)
        throw new IneligibleFaultTargetError(
          "No intact eligible lab chunks on target backend",
        );
      const random = rng(c.scenario.seed);
      let draw = 0;
      for (let i = 0; i <= c.scenario.actions.length; i++) draw = random();
      hash = hash ?? eligible[Math.floor(draw * eligible.length)];
      const target = objectPath(c.repo.config.roots[backend], hash);
      await noSymlinks(target);
      if (!contains(c.home, target)) throw new Error("Fault target escape");
      const bytes = await readObject(c.repo, backend, chunks.get(hash)!);
      if (kind === "missing") await fs.unlink(target);
      else {
        if (!bytes.length || sha(bytes) !== hash)
          throw new Error("Not an intact eligible target");
        bytes[0] ^= 0x80;
        await atomicWrite(target, bytes);
      }
    } else if (kind === "unavailable")
      (c.repo.disabled ??= new Set()).add(backend);
    else if (kind === "io-error") (c.repo.ioErrors ??= new Set()).add(backend);
    else {
      const id = hash || snapshots.at(-1)?.id;
      if (!id || !snapshots.some((s) => s.id === id))
        throw new Error("No committed manifest");
      hash = id;
      const p = path.join(
        c.repo.config.roots[backend],
        "manifests",
        id + ".json",
      );
      await noSymlinks(p);
      await readBounded(p); // Refuse an absent or unreadable manifest copy.
      await atomicWrite(p, '{"version":999,"simulation":"damaged manifest"}');
    }
    const action: LabAction = {
      kind,
      backend,
      ...(hash ? { hash } : {}),
      status: "APPLIED",
    };
    const next = { ...c.scenario, actions: [...c.scenario.actions, action] };
    await atomicWrite(path.join(c.home, "scenario.json"), canonical(next));
    c.scenario = next;
    return action;
  });
}
export async function replayScenario(
  repo: Repository,
  managed: string,
  scenario: Scenario,
) {
  if (scenario.version !== 1 || scenario.repositoryId !== repo.config.id)
    throw new Error("Scenario repository/version mismatch");
  const current = (await listSnapshots(repo)).map((s) => s.id).sort();
  if (
    !scenario.snapshotIds ||
    canonical(scenario.snapshotIds) !== canonical(current)
  )
    throw new Error(
      "Original history changed or scenario inventory is absent; recreate the lab",
    );
  const lab = await createFaultLab(repo, managed, scenario.seed);
  for (const a of scenario.actions)
    await injectFault(lab, a.kind, a.backend, a.hash);
  return lab;
}
