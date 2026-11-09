import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import path from "node:path";
import { captureSnapshot, createRepository, listSnapshots, storageAccounting } from "../packages/core/index.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

describe("durable repository", () => {
  it("captures a source into two independent backend directories", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "rewind-repository-"));
    roots.push(root);
    const source = path.join(root, "source");
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, "notes.txt"), "first capture");
    const repo = await createRepository(path.join(root, "repository"), source, [path.join(root, "backend-a"), path.join(root, "backend-b")]);
    const snapshot = await captureSnapshot(repo, "First capture");
    expect((await listSnapshots(repo)).map(row => row.id)).toEqual([snapshot]);
    expect((await fs.readdir(path.join(repo.config.roots[0], "commits")))).toHaveLength(1);
    expect((await fs.readdir(path.join(repo.config.roots[1], "commits")))).toHaveLength(1);
    expect((await storageAccounting(repo)).logicalBytes).toBeGreaterThan(0);
  });
});
