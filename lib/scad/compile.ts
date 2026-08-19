import { Evaluator } from "./evaluator";
import { compileScene } from "./csg";
import { ScadError } from "./types";

export interface CompiledMesh {
  positions: Float32Array;
  normals: Float32Array;
  color: [number, number, number, number] | null;
  highlight: boolean;
  background: boolean;
}

export interface CompileOutput {
  ok: boolean;
  meshes: CompiledMesh[];
  echo: string[];
  warnings: string[];
  error: string | null;
  errorLine: number | null;
  stats: { vertices: number; triangles: number; timeMs: number };
}

/** Full pipeline: source → AST → scene tree → CSG → triangle buffers. */
export function compileSource(source: string, files: Record<string, string> = {}): CompileOutput {
  const t0 = Date.now();
  try {
    const evaluator = new Evaluator(files);
    const { root, echo, warnings } = evaluator.run(source);
    const { specs, warnings: geoWarnings } = compileScene(root);

    const meshes: CompiledMesh[] = [];
    let vertices = 0;
    for (const s of specs) {
      const pos = s.geometry.attributes.position;
      if (!pos || pos.count < 3) continue;
      if (!s.geometry.attributes.normal) s.geometry.computeVertexNormals();
      const positions = new Float32Array(pos.array as Float32Array);
      const normals = new Float32Array(s.geometry.attributes.normal.array as Float32Array);
      vertices += pos.count;
      meshes.push({ positions, normals, color: s.color, highlight: s.highlight, background: s.background });
    }

    return {
      ok: true,
      meshes,
      echo,
      warnings: [...warnings, ...geoWarnings],
      error: null,
      errorLine: null,
      stats: { vertices, triangles: Math.floor(vertices / 3), timeMs: Date.now() - t0 },
    };
  } catch (e) {
    const err = e as ScadError;
    return {
      ok: false,
      meshes: [],
      echo: [],
      warnings: [],
      error: err.message || String(e),
      errorLine: err.pos?.line ?? null,
      stats: { vertices: 0, triangles: 0, timeMs: Date.now() - t0 },
    };
  }
}
