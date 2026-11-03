import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { GammaCorrectionShader } from "three/examples/jsm/shaders/GammaCorrectionShader.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import {
  CONFIG,
  FinalPass,
  SNOISE,
  PLANET_FRAGMENT,
  GLOW,
  CLOUD_FRAGMENT,
  MOTES,
  STARS,
  MARKERS,
} from "./shaders";

const BASE =
  "https://api.getlayers.ai/storage/v1/object/public/public/assets/ascend-d9857ad1f2";
const STOPS_X = [
  { p: 0, v: 0 },
  { p: 0.32, v: -3.1 },
  { p: 0.64, v: 3.2 },
  { p: 1, v: 0 },
];
const STOPS_Y = [
  { p: 0, v: -4.5 },
  { p: 0.32, v: 0.55 },
  { p: 0.64, v: 0.45 },
  { p: 1, v: 0.15 },
];
const STOPS_S = [
  { p: 0, v: 2.15 },
  { p: 0.32, v: 1.0 },
  { p: 0.64, v: 0.92 },
  { p: 1, v: 1.12 },
];
const clamp = THREE.MathUtils.clamp;
const hexToVec3 = (hex: string) =>
  new THREE.Vector3(...new THREE.Color(hex).toArray());
function sample(stops: typeof STOPS_X, p: number) {
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i].p) {
      const a = stops[i - 1],
        b = stops[i];
      const t = clamp((p - a.p) / (b.p - a.p), 0, 1);
      return THREE.MathUtils.lerp(a.v, b.v, t * t * (3 - 2 * t));
    }
  }
  return stops[stops.length - 1].v;
}
const splitShader = (source: string) => {
  const [vertex, fragment] = source.split("// fragment:");
  return {
    vertexShader: vertex.replace(/^\/\/ vertex:\s*/, ""),
    fragmentShader: fragment.trim(),
  };
};

export function createPlanet(
  canvas: HTMLCanvasElement,
  reduced: boolean,
  ready: () => void,
) {
  let disposed = false,
    failed = false,
    frame = 0;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const trackMaterial = (material: THREE.Material) => {
    materials.add(material);
    Object.values(material).forEach((value) => {
      if (value instanceof THREE.Texture) textures.add(value);
    });
  };
  const trackObject = (object: THREE.Object3D) =>
    object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        geometries.add(child.geometry);
        (Array.isArray(child.material)
          ? child.material
          : [child.material]
        ).forEach(trackMaterial);
      }
    });
  const disposeObject = (object: THREE.Object3D) =>
    object.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (Array.isArray(child.material)
          ? child.material
          : [child.material]
        ).forEach((material) => {
          Object.values(material).forEach((value) => {
            if (value instanceof THREE.Texture) value.dispose();
          });
          material.dispose();
        });
      }
    });
  const renderer = new THREE.WebGL1Renderer({ canvas, antialias: true });
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(
    40,
    innerWidth / innerHeight,
    0.1,
    200,
  );
  camera.position.set(0, 0, 8);
  [1, 2, 3].forEach((layer) => camera.layers.enable(layer));
  scene.add(camera);
  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  ambient.layers.set(3);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  sun.position.set(0, 10, 2);
  sun.layers.set(3);
  scene.add(sun);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, {
    enableDamping: true,
    dampingFactor: 0.06,
    enablePan: false,
    enabled: false,
    autoRotate: true,
    autoRotateSpeed: CONFIG.autoRotate,
    minDistance: 3.5,
    maxDistance: 16,
  });
  const torus = new EffectComposer(renderer);
  torus.renderToScreen = false;
  torus.addPass(new RenderPass(scene, camera));
  torus.addPass(new ShaderPass(GammaCorrectionShader));
  torus.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.22,
      0.2,
      0,
    ),
  );
  torus.addPass(new ShaderPass(CopyShader));
  const bloom = new EffectComposer(renderer);
  bloom.renderToScreen = false;
  bloom.addPass(new RenderPass(scene, camera));
  bloom.addPass(
    new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      0.5,
      0.6,
      0,
    ),
  );
  bloom.addPass(new ShaderPass(GammaCorrectionShader));
  const final = new EffectComposer(renderer);
  final.addPass(new RenderPass(scene, camera));
  const finalPass = new ShaderPass(FinalPass);
  final.addPass(finalPass);
  finalPass.uniforms.bloomTexture.value = bloom.renderTarget1.texture;
  finalPass.uniforms.torusTexture.value = torus.renderTarget1.texture;
  // The reference declares a halo input but creates its halo in the scene.
  const empty = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  empty.needsUpdate = true;
  textures.add(empty);
  finalPass.uniforms.haloTexture.value = empty;
  const world = new THREE.Group();
  scene.add(world);
  world.position.set(0, -4.5, 0);
  world.scale.setScalar(2.15);
  const planetGroup = new THREE.Group(),
    cloudGroup = new THREE.Group();
  planetGroup.rotation.z = cloudGroup.rotation.z = CONFIG.tilt;
  cloudGroup.visible = false;
  world.add(planetGroup, cloudGroup);
  const planetTime = { value: 0 },
    cloudTime = { value: 0 },
    starTime = { value: 0 },
    markerTime = { value: 0 };
  const resolution = {
    value: new THREE.Vector2(
      innerWidth * devicePixelRatio,
      innerHeight * devicePixelRatio,
    ),
  };
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      ...splitShader(GLOW),
      uniforms: {
        uGlow: { value: hexToVec3(CONFIG.glowColor) },
        uIntensity: { value: CONFIG.glowIntensity },
      },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.scale.setScalar(CONFIG.planetRadius * 2.3);
  glow.layers.set(3);
  world.add(glow);
  function points(
    count: number,
    source: string,
    uniforms: Record<string, THREE.IUniform>,
    position: (i: number) => THREE.Vector3,
    extra: Record<string, (i: number) => number>,
  ) {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) position(i).toArray(positions, i * 3);
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    for (const [name, get] of Object.entries(extra))
      geometry.setAttribute(
        name,
        new THREE.Float32BufferAttribute(
          Array.from({ length: count }, (_, i) => get(i)),
          1,
        ),
      );
    const material = new THREE.ShaderMaterial({
      ...splitShader(source),
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const object = new THREE.Points(geometry, material);
    object.layers.set(3);
    object.frustumCulled = false;
    trackObject(object);
    return object;
  }
  const randomSphere = (radius: number) =>
    new THREE.Vector3().setFromSphericalCoords(
      radius,
      Math.acos(2 * Math.random() - 1),
      Math.random() * Math.PI * 2,
    );
  const stars = points(
    CONFIG.starCount,
    STARS,
    {
      uTime: starTime,
      uSize: { value: CONFIG.starSize },
      uFlicker: { value: CONFIG.starFlicker },
      uColor: { value: hexToVec3(CONFIG.starColor) },
      uRes: resolution,
    },
    () => randomSphere(90),
    {
      seed: () => Math.random() * Math.PI * 2,
      bright: () => 0.35 + Math.random() * 0.65,
    },
  );
  scene.add(stars);
  const motesTime = { value: 0 };
  const motes = points(
    CONFIG.atmoCount,
    MOTES,
    {
      uTime: motesTime,
      uRes: resolution,
      uColor: { value: hexToVec3(CONFIG.atmoColor) },
    },
    () =>
      new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ),
    {
      size: () => CONFIG.atmoSize * (0.4 + Math.random()),
      seed: () => Math.random(),
    },
  );
  (motes.material as THREE.ShaderMaterial).depthTest = false;
  scene.add(motes);
  motes.onBeforeRender = () => {
    finalPass.uniforms.iTime.value = motesTime.value;
  };
  const cloudMeshes: THREE.Mesh[] = [];
  const draco = new DRACOLoader();
  draco.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.5/",
  );
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  let loaded = false,
    entryStart = 0;
  let curP = 0,
    curX = 0,
    curY = -4.5,
    curS = 2.15,
    spinPhase = 0,
    last = performance.now();

  function render(now: number) {
    if (disposed || failed || !loaded) return;
    const dt = reduced ? 0 : Math.min((now - last) / 1000, 0.05);
    last = now;
    planetTime.value += dt / 12;
    cloudTime.value += dt / 20;
    starTime.value += dt;
    markerTime.value += dt;
    motesTime.value = reduced ? 0 : (now / 1000) * CONFIG.atmoSpeed * 8;
    if (!reduced) {
      const target = clamp(
        scrollY /
          Math.max(1, document.documentElement.scrollHeight - innerHeight),
        0,
        1,
      );
      curP += (target - curP) * Math.min(1, dt * 4.5);
      const k = Math.min(1, dt * 3.2);
      curX +=
        (sample(STOPS_X, curP) * clamp(innerWidth / 1200, 0.5, 1) - curX) * k;
      curY += (sample(STOPS_Y, curP) - curY) * k;
      curS += (sample(STOPS_S, curP) - curS) * k;
      spinPhase += dt * CONFIG.spin;
    }
    const t = clamp((now - entryStart) / 1900, 0, 1),
      entryY = reduced ? 0 : -6.5 * Math.pow(1 - t, 3);
    world.position.set(curX, curY + entryY, 0);
    world.scale.setScalar(curS);
    planetGroup.rotation.y =
      CONFIG.initRotation + spinPhase + curP * Math.PI * 1.6;
    cloudMeshes.forEach(
      (mesh, i) =>
        (mesh.rotation.y +=
          dt * [CONFIG.cloud1Spin, CONFIG.cloud2Spin, CONFIG.cloud3Spin][i]),
    );
    glow.quaternion.copy(camera.quaternion);
    motes.position.copy(camera.position);
    controls.update();
    camera.layers.set(1);
    torus.render();
    camera.layers.set(2);
    bloom.render();
    camera.layers.set(3);
    final.render();
    if (!canvas.classList.contains("ready")) ready();
    if (!reduced) frame = requestAnimationFrame(render);
  }
  function resize() {
    if (disposed) return;
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    [torus, bloom, final].forEach((composer) => {
      composer.setPixelRatio(devicePixelRatio);
      composer.setSize(innerWidth, innerHeight);
    });
    resolution.value.set(
      innerWidth * devicePixelRatio,
      innerHeight * devicePixelRatio,
    );
    if (reduced) render(performance.now());
  }
  const contextLost = (event: Event) => {
    event.preventDefault();
    failed = true;
    cancelAnimationFrame(frame);
    canvas.classList.remove("ready");
  };
  addEventListener("resize", resize);
  canvas.addEventListener("webglcontextlost", contextLost);
  const timeout = setTimeout(() => {
    if (!loaded) {
      failed = true;
      canvas.classList.remove("ready");
    }
  }, 20000);
  async function load() {
    const assets = await Promise.allSettled([
      loader.loadAsync(`${BASE}/planet-lights.glb`),
      loader.loadAsync(`${BASE}/planet.glb`),
      new THREE.TextureLoader().loadAsync(`${BASE}/planet-clouds.png`),
    ]);
    if (
      disposed ||
      failed ||
      assets.some((asset) => asset.status === "rejected")
    ) {
      assets.forEach((asset) => {
        if (asset.status === "fulfilled") {
          if (asset.value instanceof THREE.Texture) asset.value.dispose();
          else disposeObject(asset.value.scene);
        }
      });
      clearTimeout(timeout);
      failed = true;
      return;
    }
    const nightAsset = (
      assets[0] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof loader.loadAsync>>
      >
    ).value;
    const planetAsset = (
      assets[1] as PromiseFulfilledResult<
        Awaited<ReturnType<typeof loader.loadAsync>>
      >
    ).value;
    const clouds = (assets[2] as PromiseFulfilledResult<THREE.Texture>).value;
    trackObject(nightAsset.scene);
    trackObject(planetAsset.scene);
    textures.add(clouds);
    let mesh:
      THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> | undefined;
    let nightTex: THREE.Texture | null = null;
    planetAsset.scene.traverse((object) => {
      if (!mesh && object instanceof THREE.Mesh) mesh = object;
    });
    nightAsset.scene.traverse((object) => {
      if (!nightTex && object instanceof THREE.Mesh)
        nightTex = (object.material as THREE.MeshStandardMaterial).map;
    });
    if (!mesh || !nightTex) {
      failed = true;
      clearTimeout(timeout);
      return;
    }
    mesh.geometry.computeBoundingSphere();
    mesh.scale.setScalar(
      CONFIG.planetRadius / mesh.geometry.boundingSphere!.radius,
    );
    const material = mesh.material.clone();
    Object.assign(material, { metalness: 0, roughness: 1, envMapIntensity: 0 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        time: planetTime,
        noiseScale: { value: 30 },
        speedX: { value: 1.5 },
        speedY: { value: 2 },
        speedZ: { value: 2.5 },
        nightBlendTexture: { value: nightTex },
      });
      const names = [
        "rimPower",
        "nightLights",
        "terrainDepth",
        "terrainShade",
        "oceanGlint",
        "oceanDeep",
        "oceanFlow",
        "oceanFlowSpeed",
        "oceanFlowScale",
      ] as const;
      names.forEach(
        (name) => (shader.uniforms[name] = { value: CONFIG[name] }),
      );
      shader.uniforms.rimColor = { value: hexToVec3(CONFIG.rimColor) };
      shader.vertexShader =
        "varying vec2 vCustomUv;\n" +
        shader.vertexShader.replace(
          "void main() {",
          "void main() { vCustomUv = uv;",
        );
      shader.fragmentShader =
        `varying vec2 vCustomUv; uniform float time, noiseScale, speedX, speedY, speedZ; uniform vec3 rimColor; uniform sampler2D nightBlendTexture; uniform float ${names.join(",")};\n${SNOISE}\n` +
        shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          PLANET_FRAGMENT,
        );
    };
    Object.assign(material, { extensions: { derivatives: true } });
    mesh.material = material;
    mesh.layers.set(3);
    planetGroup.add(mesh);
    trackMaterial(material);
    clouds.wrapS = clouds.wrapT = THREE.RepeatWrapping;
    clouds.repeat.set(5, 5);
    [
      { h: CONFIG.cloud1Height, o: CONFIG.cloud1Opacity, ry: 0, phase: 0 },
      { h: CONFIG.cloud2Height, o: CONFIG.cloud2Opacity, ry: 2.2, phase: 13 },
      { h: CONFIG.cloud3Height, o: CONFIG.cloud3Opacity, ry: 4.3, phase: 27 },
    ].forEach((layer) => {
      const mat = new THREE.MeshStandardMaterial({
        map: clouds,
        transparent: true,
        depthWrite: false,
      });
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, {
          uTime: cloudTime,
          noiseScale: { value: 20 },
          uSpeedX: { value: 1 },
          uSpeedY: { value: 2 },
          uSpeedZ: { value: 2 },
          uOpacity: { value: layer.o },
          uPhase: { value: layer.phase },
        });
        shader.vertexShader =
          "varying vec2 vCloudUv;\n" +
          shader.vertexShader.replace(
            "void main() {",
            "void main() { vCloudUv = uv;",
          );
        shader.fragmentShader =
          `varying vec2 vCloudUv; uniform float uTime,noiseScale,uSpeedX,uSpeedY,uSpeedZ,uOpacity,uPhase;\n${SNOISE}\n` +
          shader.fragmentShader.replace(
            "#include <dithering_fragment>",
            CLOUD_FRAGMENT,
          );
      };
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(CONFIG.planetRadius * layer.h, 64, 64),
        mat,
      );
      shell.rotation.y = layer.ry;
      shell.renderOrder = 2;
      shell.layers.set(3);
      cloudGroup.add(shell);
      cloudMeshes.push(shell);
    });
    addMarkers(mesh, points, markerTime, resolution);
    cloudGroup.visible = true;
    trackObject(scene);
    loaded = true;
    clearTimeout(timeout);
    entryStart = last = performance.now();
    render(last);
  }
  void load().catch(() => {
    failed = true;
    canvas.classList.remove("ready");
    clearTimeout(timeout);
  });
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(timeout);
    removeEventListener("resize", resize);
    canvas.removeEventListener("webglcontextlost", contextLost);
    controls.dispose();
    draco.dispose();
    trackObject(scene);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    textures.forEach((texture) => texture.dispose());
    [torus, bloom, final].forEach((composer) => {
      composer.passes.forEach((pass) => {
        if (pass instanceof ShaderPass) {
          pass.material.dispose();
          (pass.fsQuad as FullScreenQuad).dispose();
        } else if (pass instanceof UnrealBloomPass) {
          pass.dispose();
          Object.values(pass).forEach((value) => {
            if (value instanceof THREE.Material) value.dispose();
            else if (Array.isArray(value))
              value.forEach((item) => {
                if (item instanceof THREE.Material) item.dispose();
              });
          });
          (pass.fsQuad as FullScreenQuad).dispose();
        }
      });
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
      composer.copyPass.material.dispose();
      (composer.copyPass.fsQuad as FullScreenQuad).dispose();
    });
    renderer.dispose();
    scene.clear();
    canvas.classList.remove("ready");
  };
}

// Area-weighted triangle sampling keeps decorative pings on land, independent of branch locations.
function addMarkers(
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>,
  points: (
    count: number,
    source: string,
    uniforms: Record<string, THREE.IUniform>,
    position: (i: number) => THREE.Vector3,
    extra: Record<string, (i: number) => number>,
  ) => THREE.Points,
  time: THREE.IUniform,
  resolution: THREE.IUniform,
) {
  const image = mesh.material.map?.image;
  if (!image) return;
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const geometry = mesh.geometry,
    position = geometry.getAttribute("position"),
    uv = geometry.getAttribute("uv"),
    index = geometry.index;
  const count = index ? index.count : position.count,
    areas: number[] = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let total = 0;
  const vertex = (n: number) => (index ? index.getX(n) : n);
  for (let n = 0; n < count; n += 3) {
    a.fromBufferAttribute(position, vertex(n));
    b.fromBufferAttribute(position, vertex(n + 1));
    c.fromBufferAttribute(position, vertex(n + 2));
    total += new THREE.Triangle(a, b, c).getArea();
    areas.push(total);
  }
  const samples: THREE.Vector3[] = [];
  for (
    let attempt = 0;
    attempt < CONFIG.markerCount * 100 && samples.length < CONFIG.markerCount;
    attempt++
  ) {
    const target = Math.random() * total;
    let lo = 0,
      hi = areas.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (areas[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const ids = [vertex(lo * 3), vertex(lo * 3 + 1), vertex(lo * 3 + 2)];
    let u = Math.random(),
      v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const weights = [1 - u - v, u, v];
    const tex = new THREE.Vector2(),
      point = new THREE.Vector3();
    ids.forEach((id, i) => {
      tex.addScaledVector(
        new THREE.Vector2(uv.getX(id), uv.getY(id)),
        weights[i],
      );
      point.addScaledVector(
        new THREE.Vector3().fromBufferAttribute(position, id),
        weights[i],
      );
    });
    const x = clamp(Math.floor(tex.x * canvas.width), 0, canvas.width - 1),
      y = clamp(
        Math.floor((mesh.material.map!.flipY ? 1 - tex.y : tex.y) * canvas.height),
        0,
        canvas.height - 1,
      ),
      offset = (y * canvas.width + x) * 4;
    if (
      pixels[offset + 2] > pixels[offset] + 6 &&
      pixels[offset + 2] > pixels[offset + 1] + 6
    )
      continue;
    samples.push(point.multiplyScalar(1.012));
  }
  const markers = points(
    samples.length,
    MARKERS,
    {
      uTime: time,
      uColor: { value: hexToVec3(CONFIG.markerColor) },
      uSize: { value: CONFIG.markerSize },
      uSpeed: { value: CONFIG.markerSpeed },
      uRes: resolution,
    },
    (i) => samples[i],
    { seed: () => Math.random() },
  );
  mesh.add(markers);
}
