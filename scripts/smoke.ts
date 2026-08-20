/* End-to-end smoke test: parse → evaluate → CSG → triangle buffers, headless. */
import { compileSource } from "../lib/scad/compile";
import { EXAMPLES } from "../lib/examples";

let failures = 0;

function check(name: string, source: string, expectTris: boolean, expectError = false) {
  const r = compileSource(source);
  const status = expectError
    ? (r.ok ? "FAIL" : "PASS")
    : r.ok ? (r.stats.triangles > 0 || !expectTris ? "PASS" : "EMPTY") : "FAIL";
  if (status !== "PASS") failures++;
  console.log(
    `${status.padEnd(6)} ${name.padEnd(32)} tris=${String(r.stats.triangles).padEnd(8)} ${r.stats.timeMs}ms` +
    (r.error ? `  ERROR: ${r.error}` : "") +
    (r.warnings.length ? `  warnings: ${r.warnings.join(" | ")}` : ""),
  );
  if (r.echo.length) console.log("       " + r.echo.join("\n       "));
}

// language feature tests
check("cube", "cube(10);", true);
check("csg difference", "difference() { cube(20, center=true); sphere(12); }", true);
check("modules+recursion", `
module tree(d) { if (d > 0) { cylinder(h=5, r=1); translate([0,0,5]) rotate([20,0,0]) tree(d-1); } }
tree(4);`, true);
check("functions", `
function fib(n) = n < 2 ? n : fib(n-1) + fib(n-2);
echo(fib(15));
cube(fib(6));`, true);
check("for + list comp", `
pts = [for (i = [0:5]) [i*3, sin(i*60)*5]];
echo(len(pts), pts[2]);
for (p = pts) translate([p[0], p[1], 0]) cube(1);`, true);
check("vector math", `
v = [1,2,3] + [4,5,6];
d = [1,2,3] * [4,5,6];
echo(v=v, dot=d, cr=cross([1,0,0],[0,1,0]), n=norm([3,4]));
cube(1);`, true);
check("linear_extrude twist", "linear_extrude(height=20, twist=90, slices=20, scale=0.5) square(8, center=true);", true);
check("rotate_extrude torus", "rotate_extrude($fn=32) translate([10,0]) circle(3, $fn=16);", true);
check("rotate_extrude partial", "rotate_extrude(angle=120, $fn=32) translate([10,0]) square([4,6]);", true);
check("polyhedron", `
polyhedron(
  points=[[0,0,0],[10,0,0],[10,10,0],[0,10,0],[5,5,10]],
  faces=[[0,1,4],[1,2,4],[2,3,4],[3,0,4],[3,2,1,0]]);`, true);
check("hull", "hull() { sphere(3); translate([15,0,0]) sphere(3); }", true);
check("2D holes", "linear_extrude(4) difference() { circle(10, $fn=32); circle(5, $fn=32); }", true);
check("mirror", "mirror([1,0,0]) translate([5,0,0]) cube(3);", true);
check("intersection_for", "intersection_for(a=[0,60]) rotate([0,0,a]) cube(10, center=true);", true);
check("modifiers", "cube(5); #translate([8,0,0]) cube(5); %translate([16,0,0]) cube(5); *cube(100);", true);
check("children()", `
module pair() { children(0); translate([10,0,0]) children(0); }
pair() cube(4);`, true);
check("special vars", "sphere(5, $fn=12); echo($fn);", true);
check("let/each/range", `
xs = [let(a=5) a, each [1,2], 9];
echo(xs);
cube(xs[3]);`, true);
check("string ops", `echo(str("a", 1, [2,3]), len("hello"), chr(65,66));cube(1);`, true);
check("assert pass", "assert(1 < 2); cube(2);", true);
check("assert fail (expected)", "assert(false, \"boom\"); cube(2);", false, true);
check("color", 'color("rebeccapurple") cube(3); color([1,0,0,0.5]) translate([5,0,0]) cube(3); color("#0f0") translate([10,0,0]) cube(3);', true);
check("resize", "resize([10, 4, 2]) cube(1);", true);

// include test uses a virtual file
{
  const r = compileSource("include <lib.scad>\nlibbox();", { "lib.scad": "module libbox() { cube(7); }" });
  const ok = r.ok && r.stats.triangles === 12;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  include-virtual-file           tris=${r.stats.triangles}`);
}

// all bundled examples must compile, in every group
for (const [group, items] of Object.entries(EXAMPLES)) {
  for (const [name, src] of Object.entries(items)) {
    check(`${group}: ${name}`, src, true);
  }
}

console.log(failures === 0 ? "\nAll smoke tests passed." : `\n${failures} smoke test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
