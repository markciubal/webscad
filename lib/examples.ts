/**
 * Bundled examples, ordered from simple to very complex.
 * Top-level keys are dropdown groups; names must be unique across groups.
 */
export const EXAMPLES: Record<string, Record<string, string>> = {
  // ======================================================================
  Basics: {
    "Primitives tour": `// The three 3D primitives (and a cone).
$fn = 48;

color("tomato")
    cube(14, center = true);

color("gold")
    translate([24, 0, 0])
        sphere(r = 9);

color("deepskyblue")
    translate([48, 0, -7])
        cylinder(h = 14, r = 7);

color("mediumseagreen")
    translate([72, 0, -7])
        cylinder(h = 14, r1 = 8, r2 = 0);   // r2 = 0 makes a cone

// a flat 2D shape is drawn as a thin sheet
color("orchid")
    translate([90, -6, 0])
        square([12, 12]);
`,

    "Transforms tour": `// translate / rotate / scale / mirror
$fn = 32;

module arrow() {
    cylinder(h = 12, r = 2);
    translate([0, 0, 12]) cylinder(h = 6, r1 = 4, r2 = 0);
}

color("gray")            arrow();                          // original
color("tomato")          translate([20, 0, 0]) arrow();
color("gold")            translate([40, 0, 0]) rotate([0, 45, 0]) arrow();
color("deepskyblue")     translate([60, 0, 0]) scale([1, 1, 1.8]) arrow();
color("mediumseagreen")  translate([80, 0, 0]) rotate([0, 45, 0]) mirror([1, 0, 0]) arrow();

// transforms compose top-down: read each line right-to-left
color("orchid")
    translate([100, 0, 0])
        rotate([0, 0, 45])
            scale([2, 0.5, 1])
                cube(10, center = true);
`,

    "Ring gimbal (starter)": `$fn = 64;

module ring(r, thickness, h) {
    difference() {
        cylinder(h = h, r = r, center = true);
        cylinder(h = h + 1, r = r - thickness, center = true);
    }
}

color("steelblue") ring(20, 4, 8);
color("orange") rotate([90, 0, 0]) ring(20, 4, 8);
color("mediumseagreen") rotate([0, 90, 0]) ring(20, 4, 8);
sphere(r = 12);
`,

    "CSG demo": `// Classic OpenSCAD CSG demo
$fn = 48;

difference() {
    union() {
        cube(30, center = true);
        sphere(20);
    }
    cylinder(h = 60, r = 10, center = true);
    rotate([90, 0, 0]) cylinder(h = 60, r = 10, center = true);
    rotate([0, 90, 0]) cylinder(h = 60, r = 10, center = true);
}
`,

    "Dice": `// A rounded die: intersection() rounds the cube,
// difference() carves the pips. Data-driven pip layout.
s = 20;
$fn = 32;

pip_layouts = [
    [[0, 0]],
    [[-1, -1], [1, 1]],
    [[-1, -1], [0, 0], [1, 1]],
    [[-1, -1], [-1, 1], [1, -1], [1, 1]],
    [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
    [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]]
];

// rotations that bring each face up to +Z; opposite faces sum to 7
face_rots = [
    [0, 0, 0],     // 1 top
    [90, 0, 0],    // 2
    [0, 90, 0],    // 3
    [0, -90, 0],   // 4
    [-90, 0, 0],   // 5
    [180, 0, 0]    // 6 bottom
];

color("ivory")
difference() {
    intersection() {
        cube(s, center = true);
        sphere(s * 0.68);
    }
    for (f = [0 : 5])
        rotate(face_rots[f])
            for (p = pip_layouts[f])
                translate([p[0] * s * 0.27, p[1] * s * 0.27, s / 2])
                    sphere(s * 0.10, $fn = 20);
}
`,
  },

  // ======================================================================
  Intermediate: {
    "Twisted vase": `// linear_extrude with twist and scale
$fn = 8;

module vase() {
    linear_extrude(height = 60, twist = 120, slices = 60, scale = 1.4)
        circle(r = 15, $fn = 6);
}

difference() {
    vase();
    translate([0, 0, 2]) scale([0.88, 0.88, 1]) vase();
}
`,

    "Donut & lathe": `// rotate_extrude examples
$fn = 64;

// torus
translate([0, 0, 20])
    rotate_extrude()
        translate([25, 0]) circle(r = 8);

// goblet profile
color("goldenrod")
rotate_extrude()
    polygon(points = [
        [0, 0], [14, 0], [15, 2], [3, 4], [3, 16],
        [12, 22], [13, 36], [10, 36], [9, 24], [1, 18], [0, 18]
    ]);
`,

    "Coffee mug": `// Hollow cylinder + a half-torus handle (partial rotate_extrude)
$fn = 64;

color("firebrick") {
    difference() {
        cylinder(h = 45, r = 18);
        translate([0, 0, 4]) cylinder(h = 45, r = 15.5);
    }

    // handle: 180-degree revolve, stood upright, ends buried in the wall
    translate([16.5, 0, 24])
        rotate([90, 0, 0])
            rotate([0, 0, -90])
                rotate_extrude(angle = 180, $fn = 48)
                    translate([10, 0])
                        circle(3.2, $fn = 24);
}

// saucer
color("gainsboro")
    translate([0, 0, -3])
        cylinder(h = 3, r1 = 26, r2 = 22);
`,

    "Chess pawn": `// Lathe a profile polygon, then stack a sphere on top.
$fn = 64;

color("burlywood") {
    rotate_extrude()
        polygon([
            [0, 0], [11, 0], [11, 2.5], [7, 5], [4.4, 10],
            [3.2, 16], [2.6, 24], [5.6, 26.5], [5.6, 28.5],
            [2.4, 30.5], [0, 30.5]
        ]);
    translate([0, 0, 34.5]) sphere(5.4);
}
`,

    "Brick (building block)": `// Parametric stud brick: cavity, studs, and under-tubes.
u = 8;          // stud pitch
nx = 4;         // studs long
ny = 2;         // studs wide
h = 9.6;        // body height
wall = 1.6;
top = 1.2;

$fn = 32;

color("crimson") {
    // hollow body
    difference() {
        cube([nx * u, ny * u, h]);
        translate([wall, wall, -0.1])
            cube([nx * u - 2 * wall, ny * u - 2 * wall, h - top + 0.1]);
    }

    // studs
    for (i = [0 : nx - 1], j = [0 : ny - 1])
        translate([(i + 0.5) * u, (j + 0.5) * u, h])
            cylinder(h = 1.8, d = 4.8, $fn = 24);

    // under-tubes at interior corners
    for (i = [0 : nx - 2], j = [0 : ny - 2])
        translate([(i + 1) * u, (j + 1) * u, 0])
            difference() {
                cylinder(h = h - top, d = 6.5);
                translate([0, 0, -0.1]) cylinder(h = h - top + 0.2, d = 4.8);
            }
}
`,

    "Honeycomb panel": `// A plate perforated with a hex grid — for loops driving difference().
w = 96; d = 64; t = 4;
hex_r = 4.2;      // hole radius (flat-to-flat / 2 when $fn = 6)
pitch = 10.4;     // horizontal spacing
rows = 5;
cols = 8;

margin_x = (w - (cols - 1) * pitch) / 2;
margin_y = (d - (rows - 1) * pitch * 0.866) / 2;

color("darkorange")
difference() {
    cube([w, d, t]);
    for (row = [0 : rows - 1], col = [0 : cols - 1]) {
        offset_x = (row % 2) * pitch / 2;
        if (offset_x + margin_x + col * pitch < w - margin_x + 0.1)
            translate([margin_x + col * pitch + offset_x,
                       margin_y + row * pitch * 0.866, -1])
                rotate([0, 0, 30])
                    cylinder(h = t + 2, r = hex_r, $fn = 6);
    }
}
`,

    "Mounting plate": `// Rounded plate using hull(), mounting holes, center slot.
w = 60; d = 40; t = 4; hole_r = 2.5; margin = 5;

difference() {
    hull() {
        for (x = [margin, w - margin], y = [margin, d - margin])
            translate([x, y, 0]) cylinder(h = t, r = margin, $fn = 32);
    }
    for (x = [margin, w - margin], y = [margin, d - margin])
        translate([x, y, -1]) cylinder(h = t + 2, r = hole_r, $fn = 24);
    translate([w / 2, d / 2, -1])
        linear_extrude(t + 2)
            hull() {
                translate([-10, 0]) circle(4, $fn = 32);
                translate([10, 0]) circle(4, $fn = 32);
            }
}
`,

    "Bolt & nut": `// Hex-head bolt with a spiral-ridged shaft, plus a matching nut.
$fn = 48;

// hex prism sized by width across flats
module hex_prism(h, waf) {
    cylinder(h = h, r = waf / sqrt(3), $fn = 6);
}

module bolt() {
    // head
    hex_prism(5.5, 13);
    // washer face
    translate([0, 0, 5.5]) cylinder(h = 1, r1 = 6.5, r2 = 5);
    // shaft with a fake thread: a bumpy circle extruded with heavy twist
    translate([0, 0, 6.5])
        linear_extrude(height = 22, twist = 700, slices = 80)
            polygon([for (a = [0 : 6 : 354])
                (4 + 0.35 * sin(a * 6)) * [cos(a), sin(a)]]);
    // chamfered tip
    translate([0, 0, 28.5]) cylinder(h = 1.6, r1 = 4, r2 = 3);
}

module nut() {
    difference() {
        hex_prism(6.5, 13);
        translate([0, 0, -1]) cylinder(h = 9, r = 4.15);
    }
}

color("silver") bolt();
color("goldenrod") translate([24, 0, 0]) nut();
`,
  },

  // ======================================================================
  Advanced: {
    "Parametric gear (simple)": `// Simple spur gear built from primitives
teeth = 16;
outer_r = 24;
tooth_h = 4;
thickness = 6;
bore_r = 5;

$fn = 64;

difference() {
    union() {
        cylinder(h = thickness, r = outer_r, center = true);
        for (i = [0 : teeth - 1]) {
            rotate([0, 0, i * 360 / teeth])
                translate([outer_r, 0, 0])
                    cube([tooth_h * 2, 360 / teeth * 0.25, thickness], center = true);
        }
    }
    cylinder(h = thickness + 2, r = bore_r, center = true);
    for (i = [0 : 5]) {
        rotate([0, 0, i * 60])
            translate([outer_r * 0.55, 0, 0])
                cylinder(h = thickness + 2, r = 4, center = true);
    }
}
`,

    "Recursive tree": `// Recursion with modules
module branch(len, depth) {
    if (depth > 0) {
        cylinder(h = len, r1 = depth * 0.7, r2 = depth * 0.5, $fn = 12);
        translate([0, 0, len]) {
            rotate([28, 0, 0]) branch(len * 0.75, depth - 1);
            rotate([-24, 0, 137]) branch(len * 0.72, depth - 1);
        }
    } else {
        color("forestgreen") sphere(2.5, $fn = 16);
    }
}

color("saddlebrown") branch(22, 5);
`,

    "Hull & shapes": `$fn = 48;

// hull() wraps children in a convex skin
hull() {
    translate([-15, -10, 0]) sphere(6);
    translate([15, -10, 0]) sphere(6);
    translate([0, 14, 0]) sphere(6);
    translate([0, 0, 22]) sphere(3);
}

// list comprehension driven columns
for (p = [for (i = [0 : 11]) [24 * cos(i * 30), 24 * sin(i * 30), i]])
    translate([p[0], p[1], 0])
        cylinder(h = 4 + p[2], r = 1.6);
`,

    "Chain links": `// Interlocking oval links: scaled tori, alternating orientation.
$fn = 40;
links = 7;
R = 8;        // ring radius
r = 2.4;      // tube radius
stretch = 1.7;
spacing = 12.5;

module link() {
    scale([1, stretch, 1])
        rotate_extrude()
            translate([R, 0])
                circle(r, $fn = 20);
}

for (i = [0 : links - 1])
    color(i % 2 == 0 ? "silver" : "goldenrod")
        translate([0, i * spacing, 0])
            rotate([0, (i % 2) * 90, 0])
                link();
`,

    "Spiral staircase": `// Loops, hull()-swept railing, parametric everything.
steps = 18;
step_angle = 21;
rise = 4.2;
inner_r = 4;
outer_r = 17;

$fn = 40;

// center column
cylinder(h = steps * rise + 12, r = 3);

// treads
for (i = [0 : steps - 1])
    rotate([0, 0, i * step_angle])
        translate([0, 0, i * rise])
            color("peru")
            linear_extrude(2.2)
                hull() {
                    translate([inner_r, 0]) circle(2.4);
                    translate([outer_r, 0]) circle(4.6);
                }

// helical handrail: hull() between consecutive spheres
rail_h = 13;
for (i = [0 : steps - 2])
    color("dimgray")
    hull() {
        rotate([0, 0, i * step_angle])
            translate([outer_r, 0, i * rise + rail_h]) sphere(1.6);
        rotate([0, 0, (i + 1) * step_angle])
            translate([outer_r, 0, (i + 1) * rise + rail_h]) sphere(1.6);
    }

// balusters every third step
for (i = [0 : 3 : steps - 1])
    rotate([0, 0, i * step_angle])
        translate([outer_r, 0, i * rise])
            color("dimgray") cylinder(h = rail_h, r = 0.9, $fn = 12);
`,

    "Ribbed vase": `// A hollow vase from ONE polygon profile — the wall thickness is
// built into the outline, so no CSG is needed at all.
h = 72;
wall = 2.6;
n = 90;                       // profile samples
floor_t = 0.06;               // floor height as a fraction of h

// silhouette: a swell plus fine vertical ripples
function router(t) = 15
    + 8 * sin(160 * t + 12)   // overall belly
    + 1.3 * sin(t * 360 * 7); // ribs

profile = concat(
    [[0, 0]],
    // up the outside
    [for (i = [0 : n]) [router(i / n), i / n * h]],
    // across the rim
    [[router(1) - wall, h]],
    // down the inside
    [for (i = [n : -1 : floor(n * floor_t)]) [router(i / n) - wall, i / n * h]],
    // inner floor
    [[0, floor_t * h]]
);

color("cadetblue")
    rotate_extrude($fn = 100)
        polygon(profile);
`,

    "Platonic solids": `// All five Platonic solids via hull() over exact vertex sets.
phi = (1 + sqrt(5)) / 2;

module from_verts(verts, s) {
    hull()
        for (v = verts)
            translate(v * s) sphere(0.02, $fn = 8);
}

// tetrahedron: alternating cube corners
tetra = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];

// octahedron: unit axes
octa = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// icosahedron: cyclic permutations of (0, ±1, ±phi)
icosa = [for (s1 = [-1, 1], s2 = [-1, 1]) each [
    [0, s1, s2 * phi], [s1, s2 * phi, 0], [s2 * phi, 0, s1]]];

// dodecahedron: cube corners + cyclic permutations of (0, ±1/phi, ±phi)
dodeca = concat(
    [for (sx = [-1, 1], sy = [-1, 1], sz = [-1, 1]) [sx, sy, sz]],
    [for (s1 = [-1, 1], s2 = [-1, 1]) each [
        [0, s1 / phi, s2 * phi], [s1 / phi, s2 * phi, 0], [s2 * phi, 0, s1 / phi]]]
);

color("tomato")          translate([0, 0, 8])   from_verts(tetra, 8);
color("gold")            translate([26, 0, 8])  cube(13, center = true);
color("mediumseagreen")  translate([52, 0, 8])  from_verts(octa, 9);
color("deepskyblue")     translate([80, 0, 8])  from_verts(dodeca, 5.5);
color("orchid")          translate([110, 0, 8]) from_verts(icosa, 7);
`,
  },

  // ======================================================================
  Showcase: {
    "Involute gear": `// A real involute spur gear, computed point-by-point with
// functions and list comprehensions, as a single polygon outline.
m = 2.5;         // module (mm of pitch diameter per tooth)
z = 20;          // tooth count
pa = 20;         // pressure angle
thickness = 8;
bore = 8;
K = 10;          // samples per flank

rp = m * z / 2;            // pitch radius
rb = rp * cos(pa);         // base circle
ra = rp + m;               // addendum (tip) radius
rr = rp - 1.25 * m;        // dedendum (root) radius

// involute of the base circle, parameter t = roll angle in degrees
function ix(t) = rb * (cos(t) + PI / 180 * t * sin(t));
function iy(t) = rb * (sin(t) - PI / 180 * t * cos(t));
function irad(t) = sqrt(ix(t) ^ 2 + iy(t) ^ 2);
function itheta(t) = atan2(iy(t), ix(t));

function polar(r, a) = [r * cos(a), r * sin(a)];

ta = sqrt((ra / rb) ^ 2 - 1) * 180 / PI;   // roll angle at the tip
tp = sqrt((rp / rb) ^ 2 - 1) * 180 / PI;   // roll angle at the pitch circle
thp = itheta(tp);                          // involute angle at the pitch point

// flank angular positions, tooth centered on angle 0
function aL(t) = itheta(t) - thp - 90 / z;
function aR(t) = -(itheta(t) - thp) + 90 / z;

outline = [for (k = [0 : z - 1]) each concat(
    [polar(rr, k * 360 / z - 180 / z)],              // root gap midpoint
    [polar(rr, k * 360 / z + aL(0))],                // root of left flank
    [for (i = [0 : K]) polar(irad(ta * i / K), k * 360 / z + aL(ta * i / K))],
    [for (i = [K : -1 : 0]) polar(irad(ta * i / K), k * 360 / z + aR(ta * i / K))],
    [polar(rr, k * 360 / z + aR(0))]                 // root of right flank
)];

color("goldenrod")
difference() {
    union() {
        linear_extrude(thickness) polygon(outline);
        cylinder(h = thickness + 5, r = bore / 2 + 5, $fn = 48);  // hub
    }
    translate([0, 0, -1]) cylinder(h = thickness + 8, d = bore, $fn = 32);
    // lightening holes
    for (i = [0 : 3])
        rotate([0, 0, 45 + i * 90])
            translate([(rr + bore / 2 + 5) / 2, 0, -1])
                cylinder(h = thickness + 2, r = 4.2, $fn = 32);
}

echo(str("pitch radius = ", rp, " mm, tip radius = ", ra, " mm"));
`,

    "Menger sponge": `// Recursive fractal: each level keeps 20 of 27 sub-cubes.
// Level 2 = 400 cubes. Try level = 3 if you're patient (8000 cubes).
level = 2;

module menger(size, l) {
    if (l == 0) {
        cube(size, center = true);
    } else {
        s = size / 3;
        for (x = [-1 : 1], y = [-1 : 1], z = [-1 : 1])
            if (abs(x) + abs(y) + abs(z) > 1)
                translate([x * s, y * s, z * s])
                    menger(s, l - 1);
    }
}

color("cornflowerblue")
    rotate([0, 0, 15])
        menger(36, level);
`,

    "Sierpinski pyramid": `// Recursive tetrahedra. Level 4 = 256 solids.
level = 4;

verts = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];

module tetra(s) {
    hull()
        for (v = verts)
            translate(v * s / 2) sphere(0.02, $fn = 6);
}

module sierpinski(s, l) {
    if (l == 0)
        tetra(s);
    else
        for (v = verts)
            translate(v * s / 4)
                sierpinski(s / 2, l - 1);
}

color("mediumspringgreen")
    // stand the pyramid on a face: rotate the [1,1,1] vertex up to +Z,
    // then spin a face toward the default camera
    rotate([0, 0, 60])
        rotate([0, -acos(1 / sqrt(3)), 0])
            rotate([0, 0, -45])
                sierpinski(48, level);
`,

    "Turbine fan": `// Twisted, tapered blades from linear_extrude(twist, scale).
blades = 9;
blade_h = 26;

$fn = 48;

module blade() {
    translate([5.5, 0, 0])
        linear_extrude(height = blade_h, twist = 46, scale = [1.08, 1], slices = 26)
            hull() {
                circle(1.5);
                translate([13.5, 0]) circle(0.6, $fn = 16);
            }
}

color("lightsteelblue")
    for (b = [0 : blades - 1])
        rotate([0, 0, b * 360 / blades])
            blade();

// hub and spinner cone
color("slategray") {
    cylinder(h = blade_h, r1 = 8, r2 = 6.2);
    translate([0, 0, blade_h]) cylinder(h = 9, r1 = 6.2, r2 = 0.8);
}

// shroud ring
color("dimgray")
    difference() {
        cylinder(h = blade_h, r = 20.5);
        translate([0, 0, -1]) cylinder(h = blade_h + 2, r = 18.6);
    }
`,

    "Project enclosure": `// A printable two-part electronics enclosure: rounded shell,
// screw posts, ventilation slots, and a lipped lid — shown side by side.
W = 70; D = 46; H = 26;      // outer size
wall = 2.4;
corner = 5;
lip = 2.2;
post_r = 3.6;
screw_r = 1.4;

$fn = 36;

// rounded slab: hull of four corner cylinders
module slab(w, d, h, r) {
    hull()
        for (x = [r, w - r], y = [r, d - r])
            translate([x, y, 0]) cylinder(h = h, r = r);
}

module screw_posts(h) {
    for (x = [corner + 1.5, W - corner - 1.5],
         y = [corner + 1.5, D - corner - 1.5])
        translate([x, y, 0])
            difference() {
                cylinder(h = h, r = post_r);
                translate([0, 0, 2]) cylinder(h = h, r = screw_r);
            }
}

module base() {
    difference() {
        slab(W, D, H - lip, corner);
        translate([wall, wall, wall])
            slab(W - 2 * wall, D - 2 * wall, H, corner - wall);
        // ventilation slots on both long sides
        for (i = [0 : 5], side = [0, 1])
            translate([14 + i * 8, side * (D - wall) - 1, 6])
                cube([3.4, wall + 2, H - 14]);
        // cable port
        translate([W - 1, D / 2 - 5, 6]) cube([wall + 2, 10, 8]);
    }
    screw_posts(H - lip);
}

module lid() {
    slab(W, D, wall, corner);
    // inner lip that drops into the base
    difference() {
        translate([wall + 0.25, wall + 0.25, wall])
            slab(W - 2 * wall - 0.5, D - 2 * wall - 0.5, lip, corner - wall);
        translate([2 * wall, 2 * wall, wall - 1])
            slab(W - 4 * wall, D - 4 * wall, lip + 2, 2);
        // clear the screw posts
        for (x = [corner + 1.5, W - corner - 1.5],
             y = [corner + 1.5, D - corner - 1.5])
            translate([x, y, wall - 1]) cylinder(h = lip + 2, r = post_r + 0.4);
    }
    // screw through-holes
    // (drilled through the whole lid)
}

module lid_drilled() {
    difference() {
        lid();
        for (x = [corner + 1.5, W - corner - 1.5],
             y = [corner + 1.5, D - corner - 1.5])
            translate([x, y, -1]) cylinder(h = wall + lip + 2, r = screw_r + 0.35);
    }
}

color("darkseagreen") base();
color("seagreen") translate([W + 14, 0, 0]) lid_drilled();
`,
  },
};

/** Look up an example's source by name across all groups. */
export function findExample(name: string): string | null {
  for (const group of Object.values(EXAMPLES)) {
    if (name in group) return group[name];
  }
  return null;
}
