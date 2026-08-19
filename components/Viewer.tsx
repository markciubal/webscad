"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CompiledMesh } from "@/lib/scad/compile";

const DEFAULT_COLOR = new THREE.Color(0xf5c211); // OpenSCAD gold

interface ViewerProps {
  meshes: CompiledMesh[];
  /** bump this to re-frame the camera on the model */
  frameToken: number;
}

export default function Viewer({ meshes, frameToken }: ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneState = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    modelGroup: THREE.Group;
    grid: THREE.Object3D;
  } | null>(null);
  const lastFrameToken = useRef(-1);

  // one-time scene setup
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x20242c);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100000);
    camera.up.set(0, 0, 1); // Z-up like OpenSCAD
    camera.position.set(90, -110, 80);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    // lights
    scene.add(new THREE.HemisphereLight(0xd8e2f0, 0x3a3428, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(120, -80, 200);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x8899bb, 0.5);
    fill.position.set(-120, 90, -60);
    scene.add(fill);

    // grid on XY plane (rotate default XZ grid)
    const grid = new THREE.Group();
    const gh = new THREE.GridHelper(200, 20, 0x4a5262, 0x353b47);
    gh.rotation.x = Math.PI / 2;
    grid.add(gh);
    const axes = new THREE.AxesHelper(30);
    grid.add(axes);
    scene.add(grid);

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    sceneState.current = { renderer, scene, camera, controls, modelGroup, grid };

    let disposed = false;
    const tick = () => {
      if (disposed) return;
      requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneState.current = null;
    };
  }, []);

  // update meshes
  useEffect(() => {
    const st = sceneState.current;
    if (!st) return;
    const { modelGroup } = st;

    // clear old
    for (const child of [...modelGroup.children]) {
      modelGroup.remove(child);
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    }

    const bbox = new THREE.Box3();
    let any = false;

    for (const m of meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(m.positions, 3));
      geometry.setAttribute("normal", new THREE.BufferAttribute(m.normals, 3));

      let color: THREE.Color;
      let opacity = 1;
      if (m.highlight) {
        color = new THREE.Color(0xff3355);
        opacity = 0.55;
      } else if (m.background) {
        color = new THREE.Color(0x8a8f98);
        opacity = 0.35;
      } else if (m.color) {
        color = new THREE.Color(m.color[0], m.color[1], m.color[2]);
        opacity = m.color[3];
      } else {
        color = DEFAULT_COLOR.clone();
      }

      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.55,
        metalness: 0.08,
        flatShading: false,
        side: THREE.DoubleSide,
        transparent: opacity < 1,
        opacity,
        depthWrite: opacity >= 1,
      });

      const mesh = new THREE.Mesh(geometry, material);
      modelGroup.add(mesh);
      geometry.computeBoundingBox();
      if (geometry.boundingBox && !m.background) {
        bbox.union(geometry.boundingBox);
        any = true;
      }
    }

    // reframe camera when requested (initial render or explicit fit)
    if (any && frameToken !== lastFrameToken.current) {
      lastFrameToken.current = frameToken;
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      bbox.getCenter(center);
      bbox.getSize(size);
      const radius = Math.max(size.length() / 2, 5);
      const dist = radius / Math.tan(((st.camera.fov / 2) * Math.PI) / 180);
      const dir = new THREE.Vector3(0.7, -0.85, 0.6).normalize();
      st.camera.position.copy(center.clone().add(dir.multiplyScalar(dist * 1.35)));
      st.controls.target.copy(center);
      st.camera.near = Math.max(0.01, dist / 1000);
      st.camera.far = dist * 100;
      st.camera.updateProjectionMatrix();

      // scale grid to model
      const gridSize = Math.pow(10, Math.ceil(Math.log10(Math.max(radius * 2.5, 10))));
      st.grid.scale.setScalar(gridSize / 200);
    }
  }, [meshes, frameToken]);

  return <div ref={containerRef} className="viewer-container" />;
}
