import { describe, expect, it } from "vitest";
import { chunkStream } from "../packages/core/chunker.js";
import { canonical, safeRelative, sha } from "../packages/core/index.js";

async function chunks(input: Buffer, block = 8191) {
  async function* source() {
    for (let offset = 0; offset < input.length; offset += block) {
      yield input.subarray(offset, offset + block);
    }
  }
  const output: Buffer[] = [];
  for await (const chunk of chunkStream(source())) output.push(chunk);
  return output;
}

describe("storage primitives", () => {
  it("serializes metadata canonically and rejects unsafe paths", () => {
    expect(canonical({ z: 1, a: { b: 3, a: 2 } })).toBe('{"a":{"a":2,"b":3},"z":1}');
    expect(() => safeRelative("../outside")).toThrow();
    expect(() => safeRelative("folder/file.txt")).not.toThrow();
  });

  it("keeps content-defined chunking independent of stream partitioning", async () => {
    const input = Buffer.from("repeated backup data ".repeat(10000));
    const first = await chunks(input, 8191);
    const second = await chunks(input, 113);
    expect(first.map(sha)).toEqual(second.map(sha));
    expect(Buffer.concat(first)).toEqual(input);
  });
});
