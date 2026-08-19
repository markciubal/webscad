import * as THREE from "three";
import { Brush, Evaluator as CsgEvaluator, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { ConvexGeometry } from "three/examples/jsm/geometries/ConvexGeometry.js";
import { SceneNode } from "./types";
import {
  collect2dContours, cubeGeometry, cylinderGeometry, linearExtrudeGeometry,
  polyhedronGeometry, rotateExtrudeGeometry, sphereGeometry, stripGeometry,
  triangulateContours,
} from "./geometry";

export interface MeshSpec {
  geometry: THREE.BufferGeometry;
  color: [number, number, number, number] | null;
  highlight: boolean;
  background: boolean;
}

export interface CompileResult {
  specs: MeshSpec[];
  warnings: string[];
}

const csg = new CsgEvaluator();
csg.attributes = ["position", "normal"];
csg.useGroups = false;

export function compileScene(root: SceneNode): CompileResult {
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (warnings.length < 50 && !warnings.includes(m)) warnings.push(m);
  };
  const specs = compileNode(root, warn);
  return { specs, warnings };
}

function compileChildren(children: SceneNode[], warn: (m: string) => void): MeshSpec[] {
  const out: MeshSpec[] = [];
  for (const c of children) out.push(...compileNode(c, warn));
  return out;
}

function compileNode(node: SceneNode, warn: (m: string) => void): MeshSpec[] {
  switch (node.type) {
    case "group":
    case "union":
      return compileChildren(node.children, warn);

    case "cube":
      return [spec(cubeGeometry(node.size, node.center))];
    case "sphere":
      return [spec(sphereGeometry(node.r, node.segments))];
    case "cylinder":
      return [spec(cylinderGeometry(node.h, node.r1, node.r2, node.center, node.segments))];
    case "polyhedron":
      return [spec(polyhedronGeometry(node.points, node.faces))];

    case "shape2d": {
      // bare 2D shape in 3D context: render as a flat sheet at z=0
      const shapes = triangulateContours(node.contours);
      const positions: number[] = [];
      for (const s of shapes) {
        for (const [i0, i1, i2] of s.triangles) {
          const a = s.vertices[i0], b = s.vertices[i1], c = s.vertices[i2];
          if (!a || !b || !c) continue;
          positions.push(a[0], a[1], 0, b[0], b[1], 0, c[0], c[1], 0);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      return [spec(g)];
    }

    case "linear_extrude": {
      const contours = node.children.flatMap((c) => collect2dContours(c, warn));
      if (contours.length === 0) return [];
      return [spec(linearExtrudeGeometry(contours, node.height, node.center, node.twist, node.slices, node.scale))];
    }

    case "rotate_extrude": {
      const contours = node.children.flatMap((c) => collect2dContours(c, warn));
      if (contours.length === 0) return [];
      return [spec(rotateExtrudeGeometry(contours, node.angle, node.segments))];
    }

    case "transform": {
      const specs = compileChildren(node.children, warn);
      const m = node.matrix;
      if (isNaN(m[0])) {
        // resize sentinel: [NaN, sx, sy, sz, autoX, autoY, autoZ, ...]
        return applyResize(specs, [m[1], m[2], m[3]], [m[4] !== 0, m[5] !== 0, m[6] !== 0]);
      }
      const mat = new THREE.Matrix4().fromArray(m);
      for (const s of specs) applyMatrixFixed(s.geometry, mat);
      return specs;
    }

    case "color": {
      const specs = compileChildren(node.children, warn);
      for (const s of specs) {
        if (s.color === null) s.color = node.color;
      }
      return specs;
    }

    case "highlight": {
      const specs = compileChildren(node.children, warn);
      for (const s of specs) s.highlight = true;
      return specs;
    }

    case "background": {
      const specs = compileChildren(node.children, warn);
      for (const s of specs) s.background = true;
      return specs;
    }

    case "difference": {
      if (node.children.length === 0) return [];
      const first = compileChildren([node.children[0]], warn);
      const rest = compileChildren(node.children.slice(1), warn);
      const passthrough = [
        ...first.filter((s) => s.background),
        ...rest.filter((s) => s.background),
        // highlighted subtracted parts stay visible as ghosts
        ...rest.filter((s) => s.highlight && !s.background).map(ghostCopy),
      ];
      const a = csgMerge(first.filter((s) => !s.background), warn);
      const b = csgMerge(rest.filter((s) => !s.background), warn);
      if (!a) return passthrough;
      if (!b) return [a, ...passthrough];
      const result = csgOp(a, b, SUBTRACTION, warn);
      return result ? [result, ...passthrough] : passthrough;
    }

    case "intersection": {
      const operands = node.children
        .map((c) => compileChildren([c], warn))
        .map((specs) => ({
          passthrough: specs.filter((s) => s.background),
          merged: csgMerge(specs.filter((s) => !s.background), warn),
        }));
      const passthrough = operands.flatMap((o) => o.passthrough);
      const merged = operands.map((o) => o.merged).filter((x): x is MeshSpec => x !== null);
      if (merged.length === 0) return passthrough;
      let acc = merged[0];
      for (let i = 1; i < merged.length; i++) {
        const r = csgOp(acc, merged[i], INTERSECTION, warn);
        if (!r) return passthrough;
        acc = r;
      }
      return [acc, ...passthrough];
    }

    case "hull": {
      const specs = compileChildren(node.children, warn);
      const solid = specs.filter((s) => !s.background);
      if (solid.length === 0) return specs.filter((s) => s.background);
      const points: THREE.Vector3[] = [];
      for (const s of solid) {
        const pos = s.geometry.attributes.position;
        if (!pos) continue;
        const stride = Math.max(1, Math.floor(pos.count / 20000)); // cap hull input size
        for (let i = 0; i < pos.count; i += stride) {
          points.push(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
        }
      }
      if (points.length < 4) return specs;
      try {
        const g = stripGeometry(new ConvexGeometry(points));
        const out = spec(g);
        out.color = solid.find((s) => s.color)?.color ?? null;
        out.highlight = solid.some((s) => s.highlight);
        return [out, ...specs.filter((s) => s.background)];
      } catch {
        warn("hull() failed (degenerate input?)");
        return specs;
      }
    }

    case "minkowski":
      // evaluator already downgraded minkowski → union + warning
      return compileChildren(node.children, warn);
  }
}

function spec(geometry: THREE.BufferGeometry): MeshSpec {
  return { geometry, color: null, highlight: false, background: false };
}

function ghostCopy(s: MeshSpec): MeshSpec {
  return { geometry: s.geometry.clone(), color: s.color, highlight: true, background: false };
}

/** Apply a matrix; if it inverts orientation (negative determinant), fix winding. */
function applyMatrixFixed(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  g.applyMatrix4(m);
  if (m.determinant() < 0) {
    const pos = g.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i += 3) {
      // swap vertex 1 and 2 of each triangle
      for (let k = 0; k < 3; k++) {
        const a = (i + 1) * 3 + k;
        const b = (i + 2) * 3 + k;
        const tmp = arr[a];
        arr[a] = arr[b];
        arr[b] = tmp;
      }
    }
    pos.needsUpdate = true;
    g.deleteAttribute("normal");
    g.computeVertexNormals();
  }
}

function applyResize(specs: MeshSpec[], newsize: [number, number, number], auto: [boolean, boolean, boolean]): MeshSpec[] {
  if (specs.length === 0) return specs;
  const bbox = new THREE.Box3();
  for (const s of specs) {
    s.geometry.computeBoundingBox();
    if (s.geometry.boundingBox) bbox.union(s.geometry.boundingBox);
  }
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const dims = [size.x, size.y, size.z];
  const scales = [1, 1, 1];
  let firstScale = 0;
  for (let i = 0; i < 3; i++) {
    if (newsize[i] > 0 && dims[i] > 1e-12) {
      scales[i] = newsize[i] / dims[i];
      if (firstScale === 0) firstScale = scales[i];
    }
  }
  for (let i = 0; i < 3; i++) {
    if (newsize[i] === 0 || !(newsize[i] > 0)) {
      scales[i] = auto[i] && firstScale !== 0 ? firstScale : 1;
    }
  }
  const m = new THREE.Matrix4().makeScale(scales[0], scales[1], scales[2]);
  for (const s of specs) applyMatrixFixed(s.geometry, m);
  return specs;
}

/** CSG-union a list of specs into a single spec (needed as a boolean operand). */
function csgMerge(specs: MeshSpec[], warn: (m: string) => void): MeshSpec | null {
  const valid = specs.filter((s) => {
    const p = s.geometry.attributes.position;
    return p && p.count >= 3;
  });
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  let acc = valid[0];
  for (let i = 1; i < valid.length; i++) {
    const r = csgOp(acc, valid[i], ADDITION, warn);
    if (!r) return acc;
    acc = r;
  }
  return acc;
}

function csgOp(a: MeshSpec, b: MeshSpec, op: number, warn: (m: string) => void): MeshSpec | null {
  try {
    const brushA = new Brush(a.geometry);
    brushA.updateMatrixWorld();
    const brushB = new Brush(b.geometry);
    brushB.updateMatrixWorld();
    const result = csg.evaluate(brushA, brushB, op);
    const g = result.geometry;
    g.deleteAttribute("uv");
    return {
      geometry: g,
      color: a.color ?? b.color,
      highlight: a.highlight || b.highlight,
      background: false,
    };
  } catch (e) {
    warn(`CSG operation failed: ${(e as Error).message}`);
    return op === SUBTRACTION || op === ADDITION ? a : null;
  }
}
