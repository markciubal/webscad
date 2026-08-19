import { CompiledMesh } from "../scad/compile";

/** Meshes that belong in an export (background/ghost geometry excluded). */
function exportable(meshes: CompiledMesh[]): CompiledMesh[] {
  return meshes.filter((m) => !m.background);
}

/** Binary STL. */
export function toBinaryStl(meshes: CompiledMesh[]): Blob {
  const solid = exportable(meshes);
  let triCount = 0;
  for (const m of solid) triCount += Math.floor(m.positions.length / 9);

  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = "WebSCAD binary STL export";
  for (let i = 0; i < Math.min(80, header.length); i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (const m of solid) {
    const p = m.positions;
    for (let t = 0; t + 8 < p.length; t += 9) {
      const ax = p[t], ay = p[t + 1], az = p[t + 2];
      const bx = p[t + 3], by = p[t + 4], bz = p[t + 5];
      const cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
      // face normal
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) { nx /= len; ny /= len; nz /= len; } else { nx = 0; ny = 0; nz = 1; }
      view.setFloat32(offset, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);
      view.setFloat32(offset + 12, ax, true);
      view.setFloat32(offset + 16, ay, true);
      view.setFloat32(offset + 20, az, true);
      view.setFloat32(offset + 24, bx, true);
      view.setFloat32(offset + 28, by, true);
      view.setFloat32(offset + 32, bz, true);
      view.setFloat32(offset + 36, cx, true);
      view.setFloat32(offset + 40, cy, true);
      view.setFloat32(offset + 44, cz, true);
      view.setUint16(offset + 48, 0, true);
      offset += 50;
    }
  }
  return new Blob([buffer], { type: "model/stl" });
}

/** ASCII STL. */
export function toAsciiStl(meshes: CompiledMesh[]): Blob {
  const solid = exportable(meshes);
  const lines: string[] = ["solid WebSCAD"];
  for (const m of solid) {
    const p = m.positions;
    for (let t = 0; t + 8 < p.length; t += 9) {
      const ax = p[t], ay = p[t + 1], az = p[t + 2];
      const bx = p[t + 3], by = p[t + 4], bz = p[t + 5];
      const cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-12) { nx /= len; ny /= len; nz /= len; }
      lines.push(`  facet normal ${nx} ${ny} ${nz}`);
      lines.push("    outer loop");
      lines.push(`      vertex ${ax} ${ay} ${az}`);
      lines.push(`      vertex ${bx} ${by} ${bz}`);
      lines.push(`      vertex ${cx} ${cy} ${cz}`);
      lines.push("    endloop");
      lines.push("  endfacet");
    }
  }
  lines.push("endsolid WebSCAD");
  return new Blob([lines.join("\n")], { type: "model/stl" });
}

/** Wavefront OBJ. */
export function toObj(meshes: CompiledMesh[]): Blob {
  const solid = exportable(meshes);
  const lines: string[] = ["# WebSCAD OBJ export"];
  let vertexBase = 1;
  solid.forEach((m, gi) => {
    lines.push(`o mesh_${gi}`);
    const p = m.positions;
    const count = Math.floor(p.length / 3);
    for (let i = 0; i < count; i++) {
      lines.push(`v ${p[i * 3]} ${p[i * 3 + 1]} ${p[i * 3 + 2]}`);
    }
    for (let t = 0; t + 2 < count; t += 3) {
      lines.push(`f ${vertexBase + t} ${vertexBase + t + 1} ${vertexBase + t + 2}`);
    }
    vertexBase += count;
  });
  return new Blob([lines.join("\n")], { type: "model/obj" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
