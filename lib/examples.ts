export const EXAMPLES: Record<string, string> = {
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

  "Parametric gear": `// Simple spur gear built from primitives
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
    // lightening holes
    for (i = [0 : 5]) {
        rotate([0, 0, i * 60])
            translate([outer_r * 0.55, 0, 0])
                cylinder(h = thickness + 2, r = 4, center = true);
    }
}
`,

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

  "Plate with text holes": `// Mounting plate using 2D → 3D workflow
w = 60; d = 40; t = 4; hole_r = 2.5; margin = 5;

difference() {
    // rounded plate via hull of corner cylinders
    hull() {
        for (x = [margin, w - margin], y = [margin, d - margin])
            translate([x, y, 0]) cylinder(h = t, r = margin, $fn = 32);
    }
    // mounting holes
    for (x = [margin, w - margin], y = [margin, d - margin])
        translate([x, y, -1]) cylinder(h = t + 2, r = hole_r, $fn = 24);
    // center slot
    translate([w / 2, d / 2, -1])
        linear_extrude(t + 2)
            hull() {
                translate([-10, 0]) circle(4, $fn = 32);
                translate([10, 0]) circle(4, $fn = 32);
            }
}
`,
};
