import * as fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AppState,
  Request,
  Scope,
  Progress,
  ReceiptSummary,
} from "./api.js";
import {
  analyzeFrontier,
  entryState,
  captureSnapshot,
  canonical,
  createDemo,
  createFaultLab,
  createRepository,
  diffSnapshots,
  editDemo,
  explain,
  fileRows,
  injectFault,
  labRepository,
  listSnapshots,
  loadScan,
  openFaultLab,
  openRepository,
  planRepair,
  rebuildCatalog,
  replayScenario,
  restoreSnapshot,
  scanHealth,
  scenarioRecord,
  verifyReceipt,
  type LabHandle,
  type Repository,
} from "../../packages/core/index.js";
import {
  atomicWrite,
  exists,
  noSymlinks,
  readBounded,
  type OperationOptions,
} from "../../packages/core/fs.js";
import { requestSchema } from "../../packages/core/requests.js";
import { planRecovery } from "../../packages/core/recovery.js";
export class DesktopService {
  private original?: Repository;
  private lab?: LabHandle;
  private labId?: string;
  constructor(
    readonly managed: string,
    private progress: (p: Progress) => void = () => {},
    private evidenceFile?: string,
  ) {}
  async init() {
    await noSymlinks(this.managed, true);
    await fs.mkdir(this.managed, { recursive: true, mode: 0o700 });
    try {
      const saved = JSON.parse(
        (
          await readBounded(path.join(this.managed, "active.json"), 8192)
        ).toString(),
      );
      this.original = await openRepository(saved.repository);
      if (saved.labId) {
        this.lab = await openFaultLab(
          path.join(this.managed, "labs"),
          saved.labId,
        );
        this.labId = saved.labId;
      }
    } catch {
      /* initial setup or inaccessible prior repo; UI offers safe setup */
    }
  }
  private async persist() {
    if (this.original)
      await atomicWrite(
        path.join(this.managed, "active.json"),
        canonical({
          repository: this.original.home,
          labId: this.labId || null,
        }),
      );
  }
  private async repo(scope: Scope = "original") {
    if (scope === "lab") {
      if (!this.lab) throw new Error("Create an isolated laboratory first");
      return labRepository(this.lab);
    }
    if (!this.original) throw new Error("Create a repository first");
    return this.original;
  }
  async state(
    scope: Scope = "original",
    offset = 0,
    search = "",
    snapshotId?: string,
    filter?: AppState["files"][number]["state"],
  ): Promise<AppState> {
    const empty: AppState = {
      ready: false,
      scope,
      snapshots: [],
      files: [],
      totalFiles: 0,
      offset: 0,
      stats: {
        logicalBytes: 0,
        uniqueBytes: 0,
        physicalBytes: 0,
        metadataBytes: 0,
        dedupSavings: 0,
        chunks: 0,
      },
      receipts: [],
      warnings: [],
      invalidMetadata: [],
    };
    if (!this.original) return empty;
    if (scope === "lab" && !this.lab) scope = "original";
    const repo = await this.repo(scope);
    const records = await listSnapshots(repo),
      scan = await loadScan(repo),
      snapshots = analyzeFrontier(records, scan).reverse();
    const chosen = records.find((s) => s.id === snapshotId) || records.at(-1);
    const { storageAccounting } = await import(
      "../../packages/core/repository.js"
    );
    const receipts: ReceiptSummary[] = [];
    for (const r of [
      this.original,
      ...(this.lab ? [await this.repo("lab")] : []),
    ])
      for (const name of await fs.readdir(path.join(r.home, "receipts"))) {
        if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
        try {
          const v = JSON.parse(
            (await readBounded(path.join(r.home, "receipts", name))).toString(),
          );
          receipts.push({
            id: v.id,
            destination: v.destination,
            snapshotId: v.snapshotId,
            status: v.status,
            files: v.files,
            bytes: v.bytes,
            createdAt: v.createdAt,
          });
        } catch {
          /* invalid receipt is not a success */
        }
      }
    const interrupted: string[] = [];
    for (const r of [
      this.original,
      ...(this.lab ? [await this.repo("lab")] : []),
    ])
      for (const name of await fs.readdir(path.join(r.home, "restore-intents")))
        if (/^[a-f0-9-]{36}\.json$/.test(name))
          interrupted.push(
            "Interrupted restore intent " +
              name.slice(0, -5) +
              " retained. Use CLI reconcile to independently verify a published destination or inspect incomplete staging.",
          );
    const page = fileRows(chosen, scan, offset, search, filter);
    for (const row of page.files) {
      (row as AppState["files"][number]).versions = [...records]
        .reverse()
        .flatMap((record) => {
          const entry = record.manifest?.entries.find(
            (e) => e.path === row.path,
          );
          return entry
            ? [
                {
                  snapshotId: record.id,
                  state: entryState(entry, scan),
                  hash: entry.type === "file" ? entry.hash : undefined,
                },
              ]
            : [];
        });
    }
    let evaluation: unknown;
    for (const p of this.evidenceFile ? [this.evidenceFile] : [])
      if (await exists(p)) {
        try {
          evaluation = JSON.parse((await readBounded(p)).toString());
          break;
        } catch {
          /* absent evidence */
        }
      }
    return {
      ...empty,
      ready: true,
      scope,
      repository: {
        id: repo.config.id,
        source: repo.config.source,
        roots: repo.config.roots,
        isDemo: repo.config.isDemo,
      },
      snapshots,
      ...page,
      offset,
      stats: await storageAccounting(repo),
      scan: scan
        ? {
            id: scan.id,
            at: scan.at,
            deep: scan.deep,
            durationMs: scan.durationMs,
            counts: scan.counts,
          }
        : undefined,
      lab: this.lab ? await scenarioRecord(this.lab) : undefined,
      receipts: receipts.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      warnings: [
        ...interrupted,
        "Two directories on one disk do not protect against disk failure.",
        "Live capture is not a globally atomic filesystem snapshot.",
        "Health evidence describes scan time; restore verifies bytes again.",
        ...records
          .flatMap(
            (r) =>
              r.manifest?.skipped.map(
                (s) => `Skipped ${s.path}: ${s.reason}`,
              ) || [],
          )
          .slice(0, 50),
      ],
      newestVerified: snapshots.find((s) => s.state === "VERIFIED_RECOVERABLE")
        ?.id,
      invalidMetadata: records.filter((r) => !r.manifest).map((r) => r.id),
      evaluation,
    };
  }
  async request(raw: Request, signal?: AbortSignal): Promise<unknown> {
    const request = requestSchema.parse(raw);
    const options: OperationOptions = { signal, onProgress: this.progress };
    switch (request.action) {
      case "state":
        return this.state(
          request.scope,
          request.offset,
          request.search,
          request.snapshotId,
          request.filter,
        );
      case "demo": {
        const root = path.join(this.managed, "demos", randomUUID());
        this.original = await createDemo(root, options);
        this.lab = undefined;
        this.labId = undefined;
        await scanHealth(this.original, true, options);
        await this.persist();
        return this.state();
      }
      case "setup": {
        this.original = await createRepository(
          path.join(this.managed, "repositories", randomUUID()),
          request.source,
          request.roots,
        );
        this.lab = undefined;
        this.labId = undefined;
        await this.persist();
        return this.state();
      }
      case "capture": {
        const r = await this.repo();
        const id = await captureSnapshot(
          r,
          request.label || "Local capture",
          options,
        );
        await scanHealth(r, true, options);
        return { id };
      }
      case "demo-edit": {
        const r = await this.repo();
        await editDemo(r, (await listSnapshots(r)).length + 1);
        return { edited: true };
      }
      case "scan":
        return scanHealth(
          await this.repo(request.scope),
          request.deep,
          options,
        );
      case "plan-recovery": {
        const r = await this.repo(request.scope);
        const scan = await scanHealth(r, true, options);
        return {
          ...(await planRecovery(r, scan)),
          scope: request.scope,
          repositoryId: r.config.id,
          scan: { id: scan.id, at: scan.at, deep: true },
        };
      }
      case "create-lab": {
        this.lab = await createFaultLab(
          await this.repo(),
          path.join(this.managed, "labs"),
          request.seed,
        );
        this.labId = this.lab.id;
        await scanHealth(await this.repo("lab"), true, options);
        await this.persist();
        return this.state("lab");
      }
      case "fault": {
        if (!this.lab) throw new Error("No lab");
        const action = await injectFault(
          this.lab,
          request.kind,
          request.backend,
          request.hash,
        );
        await scanHealth(await this.repo("lab"), true, options);
        return action;
      }
      case "replay-lab": {
        if (!this.lab) throw new Error("No lab");
        this.lab = await replayScenario(
          await this.repo(),
          path.join(this.managed, "labs"),
          await scenarioRecord(this.lab),
        );
        this.labId = this.lab.id;
        await scanHealth(await this.repo("lab"), true, options);
        await this.persist();
        return this.state("lab");
      }
      case "scenario":
        if (!this.lab) throw new Error("No lab");
        return scenarioRecord(this.lab);
      case "explain": {
        const r = await this.repo(request.scope);
        return explain(r, request.snapshotId, request.path, await loadScan(r));
      }
      case "diff":
        return diffSnapshots(
          await this.repo(request.scope),
          request.before,
          request.after,
        );
      case "restore":
        return restoreSnapshot(
          await this.repo(request.scope),
          request.snapshotId,
          path.join(request.parent, request.name),
          request.paths,
          options,
        );
      case "verify": {
        const r = await this.receiptRepository(request.id);
        return verifyReceipt(r, request.id);
      }
      case "rebuild":
        await rebuildCatalog(await this.repo(request.scope));
        return { rebuilt: true };
      case "repair-plan": {
        const r = await this.repo(request.scope);
        const scan = await scanHealth(r, true, options);
        return planRepair(r, scan, request.target, request.budget);
      }
    }
  }
  private async receiptRepository(id: string) {
    for (const r of [
      this.original,
      ...(this.lab ? [await this.repo("lab")] : []),
    ])
      if (r && (await exists(path.join(r.home, "receipts", id + ".json"))))
        return r;
    throw new Error("Receipt not found");
  }
  async output(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid receipt id");
    const r = await this.receiptRepository(id);
    const receipt = JSON.parse(
      (
        await readBounded(path.join(r.home, "receipts", id + ".json"))
      ).toString(),
    );
    return receipt.destination as string;
  }
}
