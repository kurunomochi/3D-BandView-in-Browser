import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export function mountModelViewer(container, url) {
  if (!/^\/uploads\/models\/[0-9a-f-]{36}\.glb$/.test(url)) return;
  container.className = "model-viewer";
  container.innerHTML = `<div class="model-heading"><div><p class="eyebrow">EXPLORE IN 3D</p><h2>换个角度，看看作品</h2></div><span class="model-tag">交互预览</span></div>
    <div class="model-stage"><div class="model-start"><span aria-hidden="true">◇</span><p>拖动旋转，走近一点，再看看细节。</p><button type="button" class="btn" data-load>加载 3D 模型</button></div></div>
    <p class="model-status" role="status">点击后加载模型，首次打开可能需要一点时间。</p>
    <div class="model-tools" hidden><button type="button" data-reset>重置视角</button><button type="button" data-fullscreen>全屏查看</button><label>移动速度 <input data-speed type="range" min="1" max="10" value="3" aria-label="移动速度"></label></div>
    <div class="model-movement" hidden aria-label="移动视角"><button type="button" data-move="left">← 左移</button><button type="button" data-move="forward">前进 ↑</button><button type="button" data-move="right">右移 →</button><button type="button" data-move="up">上升 ＋</button><button type="button" data-move="back">后退 ↓</button><button type="button" data-move="down">下降 −</button></div>
    <p class="model-help">鼠标左键拖动旋转 · 右键拖动平移 · 滚轮缩放<br>点击画面后使用 W/A/S/D 或方向键移动，Q 下降、E 上升，R 重置。手机支持单指旋转、双指缩放和平移。</p>`;
  const stage = container.querySelector(".model-stage");
  const status = container.querySelector(".model-status");
  const loadButton = container.querySelector("[data-load]");
  loadButton.onclick = async () => {
    loadButton.disabled = true;
    status.textContent = "正在加载模型…";
    let renderer,
      controls,
      observer,
      resize,
      frame = 0,
      loaded;
    const listeners = [];
    const on = (target, type, fn, options) => {
      target.addEventListener(type, fn, options);
      listeners.push(() => target.removeEventListener(type, fn, options));
    };
    const dispose = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      resize?.disconnect();
      listeners.forEach((remove) => remove());
      controls?.dispose();
      loaded?.scene.traverse((object) => {
        object.geometry?.dispose();
        const materials = object.material
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : [];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value?.isTexture) {
              value.source?.data?.close?.();
              value.dispose();
            }
          }
          material.dispose();
        }
      });
      renderer?.dispose();
    };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color("#e8ede5");
      const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x60705b, 2.4));
      const sun = new THREE.DirectionalLight(0xfff1dd, 3);
      sun.position.set(4, 7, 5);
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xe0edff, 1.5);
      fill.position.set(-4, 3, -5);
      scene.add(fill);
      const loader = new GLTFLoader();
      loaded = await loader.loadAsync(url, (event) => {
        status.textContent = event.total
          ? `正在加载模型 ${Math.round((event.loaded / event.total) * 100)}%`
          : `正在加载模型 ${(event.loaded / 1048576).toFixed(1)} MB…`;
      });
      if (!container.isConnected) {
        dispose();
        return;
      }
      const box = new THREE.Box3().setFromObject(loaded.scene);
      if (box.isEmpty()) throw new Error("empty scene");
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z);
      if (!Number.isFinite(extent) || extent <= 0)
        throw new Error("invalid bounds");
      loaded.scene.position.sub(center);
      scene.add(loaded.scene);
      const grid = new THREE.GridHelper(extent * 3, 24, 0x82927e, 0xbac5b5);
      grid.position.y = -size.y / 2 - extent * 0.002;
      scene.add(grid);
      stage.replaceChildren(renderer.domElement);
      renderer.domElement.tabIndex = 0;
      renderer.domElement.setAttribute(
        "aria-label",
        "3D 作品视图，可拖动旋转或使用键盘移动",
      );
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.minDistance = extent * 0.001;
      controls.maxDistance = extent * 100;
      const reset = () => {
        controls.target.set(0, 0, 0);
        const distance =
          (extent /
            (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
            Math.min(camera.aspect, 1)) *
          1.3;
        camera.position.copy(
          new THREE.Vector3(1, 0.65, 1.2).normalize().multiplyScalar(distance),
        );
        camera.near = extent / 10000;
        camera.far = extent * 1000;
        camera.updateProjectionMatrix();
        controls.update();
      };
      const fit = () => {
        const width = stage.clientWidth,
          height = stage.clientHeight;
        renderer.setSize(width, height, false);
        camera.aspect = width / Math.max(1, height);
        camera.updateProjectionMatrix();
      };
      fit();
      reset();
      resize = new ResizeObserver(fit);
      resize.observe(stage);
      const forward = new THREE.Vector3(),
        right = new THREE.Vector3(),
        delta = new THREE.Vector3();
      const move = (direction, distance) => {
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        delta.set(0, 0, 0);
        if (direction === "forward") delta.copy(forward);
        if (direction === "back") delta.copy(forward).negate();
        if (direction === "left") delta.copy(right).negate();
        if (direction === "right") delta.copy(right);
        if (direction === "up") delta.copy(camera.up);
        if (direction === "down") delta.copy(camera.up).negate();
        delta.multiplyScalar(distance);
        camera.position.add(delta);
        controls.target.add(delta);
      };
      const keys = new Set();
      const map = {
        KeyW: "forward",
        ArrowUp: "forward",
        KeyS: "back",
        ArrowDown: "back",
        KeyA: "left",
        ArrowLeft: "left",
        KeyD: "right",
        ArrowRight: "right",
        KeyQ: "down",
        KeyE: "up",
      };
      const speed = () =>
        (extent * Number(container.querySelector("[data-speed]").value)) / 8;
      on(renderer.domElement, "pointerdown", () =>
        renderer.domElement.focus({ preventScroll: true }),
      );
      on(renderer.domElement, "keydown", (e) => {
        if (map[e.code]) {
          e.preventDefault();
          keys.add(e.code);
        }
        if (e.code === "KeyR") {
          e.preventDefault();
          reset();
        }
      });
      on(window, "keyup", (e) => keys.delete(e.code));
      on(renderer.domElement, "blur", () => keys.clear());
      on(window, "blur", () => keys.clear());
      container.querySelector("[data-reset]").onclick = reset;
      container
        .querySelectorAll("[data-move]")
        .forEach(
          (button) =>
            (button.onclick = () => move(button.dataset.move, speed() * 0.3)),
        );
      container.querySelector("[data-fullscreen]").onclick = async () => {
        try {
          if (document.fullscreenElement === container)
            await document.exitFullscreen();
          else await container.requestFullscreen();
        } catch {
          status.textContent = "当前浏览器不支持全屏，可以直接在页面中查看。";
        }
      };
      container.querySelector(".model-tools").hidden = false;
      container.querySelector(".model-movement").hidden = false;
      let visible = true,
        previous = 0;
      const render = (time) => {
        frame = 0;
        if (!visible || document.hidden) {
          previous = 0;
          return;
        }
        const dt = previous ? Math.min((time - previous) / 1000, 0.05) : 0;
        previous = time;
        for (const key of keys) move(map[key], speed() * dt);
        controls.update();
        renderer.render(scene, camera);
        frame = requestAnimationFrame(render);
      };
      const resume = () => {
        keys.clear();
        if (!frame) frame = requestAnimationFrame(render);
      };
      observer = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) resume();
      });
      observer.observe(stage);
      on(document, "visibilitychange", resume);
      on(renderer.domElement, "webglcontextlost", (e) => {
        e.preventDefault();
        visible = false;
        status.textContent = "显卡上下文已中断，请刷新页面重新加载模型。";
      });
      on(window, "pagehide", (e) => {
        if (!e.persisted) dispose();
      });
      on(container, "model-dispose", dispose);
      status.textContent = "模型已加载，可以自由观察。";
      resume();
    } catch (error) {
      console.warn("Model viewer unavailable", error);
      dispose();
      container.querySelector(".model-tools").hidden = true;
      container.querySelector(".model-movement").hidden = true;
      stage.innerHTML =
        '<p class="model-failed">模型暂时无法显示。请确认浏览器支持 WebGL 2，或刷新页面重试。压缩扩展或不完整的模型需要重新导出普通 GLB。</p>';
      status.textContent = "加载失败，不影响其他图片和视频的浏览。";
    }
  };
}
