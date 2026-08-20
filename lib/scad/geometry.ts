import * as THREE from "three";
import { Contour, SceneNode, Vec3 } from "./types";

/**
 * Builders for primitive geometry. Everything returns non-indexed
 * BufferGeometry with position + normal only (CSG-ready), Z-up like OpenSCAD.
 */

export function stripGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const keep = ["position", "normal"];
  for (const name of Object.keys(out.attributes)) {
    if (!keep.includes(name)) out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}

export function cubeGeometry(size: Vec3, center: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(size[0], size[1], size[2]);
  if (!center) g.translate(size[0] / 2, size[1] / 2, size[2] / 2);
  return stripGeometry(g);
}

export function sphereGeometry(r: number, segments: number): THREE.BufferGeometry {
  const rings = Math.max(2, Math.ceil(segments / 2));
  const g = new THREE.SphereGeometry(Math.max(r, 1e-9), segments, rings);
  return stripGeometry(g);
}

export function cylinderGeometry(h: number, r1: number, r2: number, center: boolean, segments: number): THREE.BufferGeometry {
  const rTop = Math.max(r2, 0);
  const rBot = Math.max(r1, 0);
  const g = new THREE.CylinderGeometry(Math.max(rTop, 1e-9), Math.max(rBot, 1e-9), Math.abs(h), segments, 1, false);
  // three cylinders run along Y; OpenSCAD runs along Z
  g.rotateX(Math.PI / 2);
  if (!center) g.translate(0, 0, Math.abs(h) / 2);
  return stripGeometry(g);
}

export function polyhedronGeometry(points: Vec3[], faces: number[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    // OpenSCAD faces are clockwise from outside; three.js wants CCW → reverse
    const f = face.slice().reverse();
    for (let i = 1; i < f.length - 1; i++) {
      const a = points[f[0]], b = points[f[i]], c = points[f[i + 1]];
      if (!a || !b || !c) continue;
      positions.push(...a, ...b, ...c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------- 2D shape helpers ----------------

function contourArea(points: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

/** Ensure outer contours are CCW and holes are CW (three.js Shape convention). */
export function normalizeContours(contours: Contour[]): { outer: [number, number][][]; holes: [number, number][][] } {
  const outer: [number, number][][] = [];
  const holes: [number, number][][] = [];
  for (const c of contours) {
    if (c.points.length < 3) continue;
    let pts = c.points;
    const area = contourArea(pts);
    if (!c.hole && area < 0) pts = pts.slice().reverse();
    if (c.hole && area > 0) pts = pts.slice().reverse();
    (c.hole ? holes : outer).push(pts);
  }
  return { outer, holes };
}

interface TriangulatedShape {
  contour: [number, number][];
  holes: [number, number][][];
  /** flat vertex list: contour points then hole points */
  vertices: [number, number][];
  /** triangles as vertex indices into `vertices` */
  triangles: [number, number, number][];
}

export function triangulateContours(contours: Contour[]): TriangulatedShape[] {
  const { outer, holes } = normalizeContours(contours);
  const shapes: TriangulatedShape[] = [];
  for (const contour of outer) {
    // assign holes inside this contour (simple containment test on first point)
    const myHoles = holes.filter((h) => pointInPolygon(h[0], contour));
    const contourV2 = contour.map(([x, y]) => new THREE.Vector2(x, y));
    const holesV2 = myHoles.map((h) => h.map(([x, y]) => new THREE.Vector2(x, y)));
    const tris = THREE.ShapeUtils.triangulateShape(contourV2, holesV2);
    const vertices: [number, number][] = [...contour, ...myHoles.flat()];
    shapes.push({
      contour,
      holes: myHoles,
      vertices,
      triangles: tris as [number, number, number][],
    });
  }
  return shapes;
}

function pointInPolygon(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------- linear_extrude ----------------

export function linearExtrudeGeometry(
  contours: Contour[], height: number, center: boolean,
  twist: number, slices: number, scale: [number, number],
): THREE.BufferGeometry {
  const shapes = triangulateContours(contours);
  const positions: number[] = [];
  const h = Math.abs(height);
  const z0 = center ? -h / 2 : 0;
  const nSlices = Math.max(1, Math.floor(slices));

  const transformAt = (t: number) => {
    // t in [0,1]; twist rotates CLOCKWISE (OpenSCAD spec: negative direction)
    const ang = (-twist * t * Math.PI) / 180;
    const sx = 1 + (scale[0] - 1) * t;
    const sy = 1 + (scale[1] - 1) * t;
    const c = Math.cos(ang), s = Math.sin(ang);
    return ([x, y]: [number, number]): [number, number] => [
      (x * c - y * s) * sx,
      (x * s + y * c) * sy,
    ];
  };

  for (const shape of shapes) {
    const rings: [number, number][][] = [shape.contour, ...shape.holes];

    // side walls
    for (let s = 0; s < nSlices; s++) {
      const t0 = s / nSlices;
      const t1 = (s + 1) / nSlices;
      const f0 = transformAt(t0);
      const f1 = transformAt(t1);
      const zA = z0 + t0 * h;
      const zB = z0 + t1 * h;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const p0 = ring[i];
          const p1 = ring[(i + 1) % ring.length];
          const a0 = f0(p0), a1 = f0(p1);
          const b0 = f1(p0), b1 = f1(p1);
          // two triangles per quad — outward for CCW outer rings
          positions.push(a0[0], a0[1], zA, a1[0], a1[1], zA, b1[0], b1[1], zB);
          positions.push(a0[0], a0[1], zA, b1[0], b1[1], zB, b0[0], b0[1], zB);
        }
      }
    }

    // caps
    const fBot = transformAt(0);
    const fTop = transformAt(1);
    for (const [i0, i1, i2] of shape.triangles) {
      const v0 = shape.vertices[i0], v1 = shape.vertices[i1], v2 = shape.vertices[i2];
      if (!v0 || !v1 || !v2) continue;
      const b0 = fBot(v0), b1 = fBot(v1), b2 = fBot(v2);
      const t0 = fTop(v0), t1 = fTop(v1), t2 = fTop(v2);
      // bottom cap faces down (reverse winding)
      positions.push(b0[0], b0[1], z0, b2[0], b2[1], z0, b1[0], b1[1], z0);
      // top cap faces up
      positions.push(t0[0], t0[1], z0 + h, t1[0], t1[1], z0 + h, t2[0], t2[1], z0 + h);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------- rotate_extrude ----------------

export function rotateExtrudeGeometry(contours: Contour[], angleDeg: number, segments: number): THREE.BufferGeometry {
  const shapes = triangulateContours(contours);
  const positions: number[] = [];
  const fullTurn = Math.abs(angleDeg) >= 360 - 1e-9;
  const angle = fullTurn ? 360 : Math.max(-360, Math.min(360, angleDeg));
  const angRad = (angle * Math.PI) / 180;
  const nSeg = Math.max(3, Math.ceil((segments * Math.abs(angle)) / 360));

  const rotate = (p: [number, number], theta: number): [number, number, number] => {
    // 2D X → radius, 2D Y → Z; revolve about Z axis
    const [x, y] = p;
    return [x * Math.cos(theta), x * Math.sin(theta), y];
  };

  for (const shape of shapes) {
    const rings: [number, number][][] = [shape.contour, ...shape.holes];
    for (let s = 0; s < nSeg; s++) {
      const th0 = (s / nSeg) * angRad;
      const th1 = ((s + 1) / nSeg) * angRad;
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const p0 = ring[i];
          const p1 = ring[(i + 1) % ring.length];
          // clamp x >= 0 (OpenSCAD requires shapes on positive X side)
          const q0: [number, number] = [Math.max(0, p0[0]), p0[1]];
          const q1: [number, number] = [Math.max(0, p1[0]), p1[1]];
          const a0 = rotate(q0, th0), a1 = rotate(q1, th0);
          const b0 = rotate(q0, th1), b1 = rotate(q1, th1);
          // ring goes CCW in XY (profile plane) → outward faces
          positions.push(...a0, ...b1, ...a1);
          positions.push(...a0, ...b0, ...b1);
        }
      }
    }

    if (!fullTurn) {
      // caps at start (theta=0) and end (theta=angRad)
      for (const [i0, i1, i2] of shape.triangles) {
        const v0 = shape.vertices[i0], v1 = shape.vertices[i1], v2 = shape.vertices[i2];
        if (!v0 || !v1 || !v2) continue;
        const s0 = rotate([Math.max(0, v0[0]), v0[1]], 0);
        const s1 = rotate([Math.max(0, v1[0]), v1[1]], 0);
        const s2 = rotate([Math.max(0, v2[0]), v2[1]], 0);
        positions.push(...s0, ...s1, ...s2);
        const e0 = rotate([Math.max(0, v0[0]), v0[1]], angRad);
        const e1 = rotate([Math.max(0, v1[0]), v1[1]], angRad);
        const e2 = rotate([Math.max(0, v2[0]), v2[1]], angRad);
        positions.push(...e0, ...e2, ...e1);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

// ---------------- 2D boolean approximations ----------------

/** Collect contours from evaluated 2D children (union = concatenate). */
export function collect2dContours(node: SceneNode, warn: (m: string) => void): Contour[] {
  switch (node.type) {
    case "shape2d":
      return node.contours;
    case "group":
    case "union": {
      const out: Contour[] = [];
      for (const c of node.children) out.push(...collect2dContours(c, warn));
      return out;
    }
    case "difference": {
      if (node.children.length === 0) return [];
      const first = collect2dContours(node.children[0], warn);
      const rest: Contour[] = [];
      for (let i = 1; i < node.children.length; i++) rest.push(...collect2dContours(node.children[i], warn));
      // approximation: subtracted outlines become holes
      const holes = rest.filter((c) => !c.hole).map((c) => ({ points: c.points, hole: true }));
      if (rest.length > 0) {
        warn("2D difference() is approximated: subtracted shapes become holes (must lie fully inside)");
      }
      return [...first, ...holes];
    }
    case "intersection": {
      warn("2D intersection() is not supported; using first child");
      return node.children.length ? collect2dContours(node.children[0], warn) : [];
    }
    case "hull": {
      const all: Contour[] = [];
      for (const c of node.children) all.push(...collect2dContours(c, warn));
      const pts = all.flatMap((c) => c.points);
      if (pts.length < 3) return [];
      return [{ points: convexHull2d(pts), hole: false }];
    }
    case "transform": {
      const inner: Contour[] = [];
      for (const c of node.children) inner.push(...collect2dContours(c, warn));
      const m = node.matrix;
      if (isNaN(m[0])) return inner; // resize on 2D — skip
      return inner.map((c) => ({
        hole: c.hole,
        points: c.points.map(([x, y]) => [
          m[0] * x + m[4] * y + m[12],
          m[1] * x + m[5] * y + m[13],
        ] as [number, number]),
      }));
    }
    case "color":
    case "highlight":
    case "background":
      return node.children.flatMap((c) => collect2dContours(c, warn));
    case "align": {
      const inner = node.children.flatMap((c) => collect2dContours(c, warn));
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const c of inner) {
        for (const [x, y] of c.points) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
      if (!isFinite(minX)) return inner;
      const offsetFor = (mode: string | null, min: number, max: number) =>
        mode === "min" ? -min : mode === "max" ? -max : mode === "center" ? -(min + max) / 2 : 0;
      const ox = offsetFor(node.x, minX, maxX);
      const oy = offsetFor(node.y, minY, maxY);
      if (ox === 0 && oy === 0) return inner;
      return inner.map((c) => ({
        hole: c.hole,
        points: c.points.map(([x, y]) => [x + ox, y + oy] as [number, number]),
      }));
    }
    case "linear_extrude":
    case "rotate_extrude":
    case "cube":
    case "sphere":
    case "cylinder":
    case "polyhedron":
    case "minkowski":
      warn(`3D object inside a 2D context ignored`);
      return [];
    default:
      return [];
  }
}

export function convexHull2d(points: [number, number][]): [number, number][] {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}
