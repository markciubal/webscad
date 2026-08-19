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
  (self as unknown as Worker).postMessage({ id, result }, transfers);
};
