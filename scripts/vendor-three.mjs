import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
const files = [
  "build/three.module.js",
  "build/three.core.js",
  "LICENSE",
  "examples/jsm/controls/OrbitControls.js",
  "examples/jsm/loaders/GLTFLoader.js",
  "examples/jsm/utils/BufferGeometryUtils.js",
  "examples/jsm/utils/SkeletonUtils.js",
];
for (const file of files) {
  const target = path.join("public/vendor/three", file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join("node_modules/three", file), target);
}
console.log("Vendored Three.js 0.186.1 and required addons with MIT license.");
