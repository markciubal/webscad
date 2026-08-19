"use client";

/** localStorage-backed workspace: a flat map of filename → source. */

const FILES_KEY = "webscad:files";
const ACTIVE_KEY = "webscad:active";

export interface Workspace {
  files: Record<string, string>;
  active: string;
}

export const DEFAULT_FILE = "main.scad";

const STARTER = `// Welcome to WebSCAD — OpenSCAD in your browser.
// Edit code on the left; the model renders on the right.
// Ctrl+Enter renders, or enable auto-render in the toolbar.

$fn = 64;

module ring(r, thickness, h) {
    difference() {
        cylinder(h = h, r = r, center = true);
        cylinder(h = h + 1, r = r - thickness, center = true);
    }
}

color("steelblue")
    ring(20, 4, 8);

color("orange")
    rotate([90, 0, 0])
        ring(20, 4, 8);

color("mediumseagreen")
    rotate([0, 90, 0])
        ring(20, 4, 8);

sphere(r = 12);
`;

export function loadWorkspace(): Workspace {
  if (typeof window === "undefined") {
    return { files: { [DEFAULT_FILE]: STARTER }, active: DEFAULT_FILE };
  }
  try {
    const raw = window.localStorage.getItem(FILES_KEY);
    const files = raw ? (JSON.parse(raw) as Record<string, string>) : null;
    if (files && Object.keys(files).length > 0) {
      let active = window.localStorage.getItem(ACTIVE_KEY) || Object.keys(files)[0];
      if (!(active in files)) active = Object.keys(files)[0];
      return { files, active };
    }
  } catch {
    // corrupted storage — fall through to defaults
  }
  return { files: { [DEFAULT_FILE]: STARTER }, active: DEFAULT_FILE };
}

export function saveFiles(files: Record<string, string>) {
  try {
    window.localStorage.setItem(FILES_KEY, JSON.stringify(files));
  } catch (e) {
    console.warn("Failed to persist workspace (storage full?)", e);
  }
}

export function saveActive(name: string) {
  try {
    window.localStorage.setItem(ACTIVE_KEY, name);
  } catch {
    // non-fatal
  }
}

export function normalizeFilename(name: string): string {
  let n = name.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!n) return "";
  if (!/\.scad$/i.test(n)) n += ".scad";
  return n;
}
