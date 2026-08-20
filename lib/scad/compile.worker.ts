/// <reference lib="webworker" />
import { compileSource } from "./compile";

interface CompileRequest {
  id: number;
  source: string;
  files: Record<string, string>;
}

self.onmessage = (e: MessageEvent<CompileRequest>) => {
  const { id, source, files } = e.data;
  const result = compileSource(source, files);
  const transfers: ArrayBuffer[] = [];
  for (const m of result.meshes) {
    transfers.push(m.positions.buffer as ArrayBuffer, m.normals.buffer as ArrayBuffer);
  }
  try {
    (self as unknown as Worker).postMessage({ id, result }, transfers);
  } catch {
    // transfer failed (should not happen) — retry without transfer list
    (self as unknown as Worker).postMessage({ id, result });
  }
};

// boot handshake: lets the main thread distinguish a slow compile from a
// worker that never came up (dev-server chunk hiccups, blocked workers, …)
(self as unknown as Worker).postMessage({ ready: true });
