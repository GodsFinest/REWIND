import { parentPort, workerData } from "node:worker_threads";
import { DesktopService } from "./service.js";
import type { Request } from "./api.js";
const port = parentPort!;
let controller: AbortController | undefined;
let queued = 0,
  cancelGeneration = 0;
let lastProgress = 0;
const service = new DesktopService(
  workerData.managed,
  (p) => {
    const now = Date.now();
    if (now - lastProgress >= 50) {
      lastProgress = now;
      port.postMessage({ progress: p });
    }
  },
  workerData.evidenceFile,
);
const ready = service.init();
let queue = Promise.resolve();
port.on(
  "message",
  (message: {
    id: number;
    request?: Request;
    cancel?: boolean;
    output?: string;
  }) => {
    if (message.cancel) {
      cancelGeneration++;
      controller?.abort();
      return;
    }
    if (queued >= 64) {
      port.postMessage({ id: message.id, error: "Too many queued operations" });
      return;
    }
    const generation = cancelGeneration;
    queued++;
    queue = queue.then(async () => {
      controller = new AbortController();
      if (generation !== cancelGeneration) controller.abort();
      try {
        await ready;
        const result = message.output
          ? await service.output(message.output)
          : await service.request(message.request!, controller.signal);
        port.postMessage({ id: message.id, result });
      } catch (e) {
        port.postMessage({ id: message.id, error: (e as Error).message });
      } finally {
        queued--;
        controller = undefined;
      }
    });
  },
);
