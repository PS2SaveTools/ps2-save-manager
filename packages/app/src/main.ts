import { Buffer } from "buffer";
import {
  addAppSaveEntries,
  BrowserExportService,
  createBlankPs2Save,
  editableFileAttributes,
  parseIconSysProperties,
  removeAppSaveEntry,
  renameAppSaveEntry,
  renameAppSaveRoot,
  SaveInspectionService,
  sanitizeFileName,
  type AppSaveDocument,
  type ExportFormat,
  updateAppSaveEntryAttributes,
  updateAppSaveRootAttributes,
  updateIconSysProperties,
} from "@psv-exporter/core/browser";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { parseIconModel, parseIconSys, PS2_TEXTURE_PAGE_HEIGHT, PS2_TEXTURE_PAGE_WIDTH, type IconSysView, type ParsedIconModel } from "./icon-viewer";
import { downloadBuffer } from "./download";
import { entryRows, escapeHtml, formatBytes, metadataRows } from "./rendering";
import { appState, setAdvancedView } from "./state";
import { closeDialogOnDataAction, showDialogError } from "./dialogs";
import "./styles.css";

const service = new SaveInspectionService();
const exportService = new BrowserExportService();
let currentIconScene: IconScene | undefined;
let selectedIconName: string | undefined;
let iconAnimationPaused = false;
let iconTurntableEnabled = true;
let iconTextureNearest = false;
let iconWireframeEnabled = false;
const BLANK_ICON_SYS_URL = new URL("./assets/default-icon.sys", import.meta.url).href;
const BLANK_ICON_URL = new URL("./assets/default-icon.icn", import.meta.url).href;

interface IconScene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  mesh: THREE.Mesh;
  controls: OrbitControls;
  iconModel: ParsedIconModel;
  positionAttribute: THREE.BufferAttribute;
  frame: number;
}

function exportButtons(documentModel: AppSaveDocument): string {
  return exportService
    .availableFormats(documentModel)
    .map(
      (format) => `
        <button class="export-button" type="button" data-export-format="${format}">
          ${format.toUpperCase()}
        </button>
      `,
    )
    .join("");
}

function iconChoices(documentModel: AppSaveDocument, iconSys: IconSysView): Array<{ name: string; label: string }> {
  const choices: Array<{ name: string; label: string }> = [];
  const addChoice = (name: string, label: string): void => {
    if (!name || choices.some((choice) => choice.name.toLowerCase() === name.toLowerCase())) {
      return;
    }
    const entry = findIconEntry(documentModel, name);
    if (entry) {
      choices.push({ name: entry.name, label });
    }
  };

  addChoice(iconSys.iconName, "Normal");
  addChoice(iconSys.copyIconName, "Copy");
  addChoice(iconSys.deleteIconName, "Delete");

  for (const entry of documentModel.entries) {
    if (entry.name.toLowerCase() !== "icon.sys" && parseIconModel(entry.data)) {
      addChoice(entry.name, entry.name);
    }
  }

  return choices;
}

function iconChoiceButtons(choices: Array<{ name: string; label: string }>): string {
  return choices
    .map((choice) => {
      const selected = choice.name === selectedIconName;
      return `
        <button class="icon-choice-button${selected ? " is-selected" : ""}" type="button" data-icon-name="${escapeHtml(choice.name)}">
          ${escapeHtml(choice.label)}
        </button>
      `;
    })
    .join("");
}

function iconControlButtons(): string {
  const buttons = [
    {
      action: "pause",
      label: iconAnimationPaused ? "Resume" : "Pause",
      selected: iconAnimationPaused,
    },
    {
      action: "turntable",
      label: "Turntable",
      selected: iconTurntableEnabled,
    },
    {
      action: "texture",
      label: "Nearest",
      selected: iconTextureNearest,
    },
    {
      action: "wireframe",
      label: "Wire",
      selected: iconWireframeEnabled,
    },
    {
      action: "reset-camera",
      label: "Reset",
      selected: false,
    },
  ];

  return buttons
    .map(
      (button) => `
        <button
          class="icon-control-button${button.selected ? " is-selected" : ""}"
          type="button"
          data-icon-action="${button.action}"
        >
          ${button.label}
        </button>
      `,
    )
    .join("");
}

function iconView(documentModel: AppSaveDocument): string {
  if (documentModel.type !== "ps2") {
    return "";
  }

  const iconSysEntry = documentModel.entries.find((entry) => entry.name.toLowerCase() === "icon.sys");
  if (!iconSysEntry) {
    return `
      <section class="workspace-section icon-card" id="icon-section">
        <h2>Icon</h2>
        <p class="subtle">No icon.sys entry found.</p>
      </section>
    `;
  }

  const iconSys = parseIconSys(iconSysEntry.data);
  if (!iconSys) {
    return `
      <section class="workspace-section icon-card" id="icon-section">
        <h2>Icon</h2>
        <p class="subtle">icon.sys is present but could not be parsed.</p>
      </section>
    `;
  }

  const choices = iconChoices(documentModel, iconSys);
  if (!selectedIconName && choices.length > 0) {
    selectedIconName = choices[0]!.name;
  }
  const iconEntry = selectedIconName ? findIconEntry(documentModel, selectedIconName) : findIconEntry(documentModel, iconSys.iconName);
  const iconModel = iconEntry ? parseIconModel(iconEntry.data) : undefined;
  const background = `linear-gradient(135deg, ${iconSys.colors.upperLeft}, ${iconSys.colors.upperRight} 38%, ${iconSys.colors.lowerRight} 72%, ${iconSys.colors.lowerLeft})`;

  return `
    <section class="workspace-section icon-card" id="icon-section">
      <div class="card-heading"><div><p class="section-kicker">MEMORY CARD</p><h2>Icon preview</h2></div><button class="entry-properties-button" type="button" data-edit-icon-sys="true">Edit icon.sys</button></div>
      <div class="icon-toolbar">
        <div class="icon-choice-group" aria-label="Icon file">
          ${iconChoiceButtons(choices)}
        </div>
        <div class="icon-control-group" aria-label="3D view controls">
          ${iconControlButtons()}
        </div>
      </div>
      <div class="icon-preview" style="background: ${background}" data-icon-preview="true">
        ${
          iconModel
            ? `<canvas class="icon-canvas" width="320" height="240" aria-label="3D rendered PS2 icon model"></canvas>`
            : `<div class="icon-canvas icon-texture-empty">Icon model unavailable</div>`
        }
        <p>${escapeHtml(iconSys.title).replace(/\n/g, "<br />")}</p>
      </div>
      <dl class="meta-list icon-meta">
        <div class="meta-row">
          <dt>normal icon</dt>
          <dd>${escapeHtml(iconEntry?.name || iconSys.iconName || "none")}</dd>
        </div>
        <div class="meta-row">
          <dt>copy icon</dt>
          <dd>${escapeHtml(iconSys.copyIconName || "none")}</dd>
        </div>
        <div class="meta-row">
          <dt>delete icon</dt>
          <dd>${escapeHtml(iconSys.deleteIconName || "none")}</dd>
        </div>
        <div class="meta-row">
          <dt>transparency</dt>
          <dd>${iconSys.transparency}</dd>
        </div>
        ${
          iconModel
            ? `
              <div class="meta-row">
                <dt>model</dt>
                <dd>${iconModel.vertexCount} vertices, ${iconModel.animationShapes} shape${iconModel.animationShapes === 1 ? "" : "s"}, texture ${iconModel.textureType}</dd>
              </div>
            `
            : ""
        }
      </dl>
    </section>
  `;
}

function findIconEntry(documentModel: AppSaveDocument, preferredName: string): AppSaveDocument["entries"][number] | undefined {
  const normalizedPreferred = preferredName.trim().toLowerCase();
  const exact = documentModel.entries.find((entry) => entry.name.trim().toLowerCase() === normalizedPreferred);
  if (exact && parseIconModel(exact.data)) {
    return exact;
  }

  return documentModel.entries.find((entry) => entry.name.toLowerCase() !== "icon.sys" && parseIconModel(entry.data));
}

function disposeIconScene(): void {
  if (!currentIconScene) {
    return;
  }

  window.cancelAnimationFrame(currentIconScene.frame);
  currentIconScene.controls.dispose();
  currentIconScene.renderer.dispose();
  currentIconScene.mesh.geometry.dispose();
  const material = currentIconScene.mesh.material;
  if (Array.isArray(material)) {
    for (const item of material) {
      (item as THREE.MeshBasicMaterial).map?.dispose();
      item.dispose();
    }
  } else {
    (material as THREE.MeshBasicMaterial).map?.dispose();
    material.dispose();
  }
  currentIconScene = undefined;
}

function forEachMeshMaterial(mesh: THREE.Mesh, callback: (material: THREE.Material) => void): void {
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const item of material) {
      callback(item);
    }
    return;
  }
  callback(material);
}

function applyIconTextureFiltering(mesh: THREE.Mesh, nearest: boolean): void {
  const filter = nearest ? THREE.NearestFilter : THREE.LinearFilter;
  forEachMeshMaterial(mesh, (material) => {
    const texturedMaterial = material as THREE.Material & { map?: THREE.Texture };
    if (!texturedMaterial.map) {
      return;
    }
    texturedMaterial.map.minFilter = filter;
    texturedMaterial.map.magFilter = filter;
    texturedMaterial.map.needsUpdate = true;
  });
}

function applyIconWireframe(mesh: THREE.Mesh, enabled: boolean): void {
  forEachMeshMaterial(mesh, (material) => {
    if ("wireframe" in material) {
      material.wireframe = enabled;
      material.needsUpdate = true;
    }
  });
}

function canvasDisplaySize(canvas: HTMLCanvasElement): { width: number; height: number } {
  return {
    width: Math.max(1, Math.floor(canvas.clientWidth || canvas.width || 320)),
    height: Math.max(1, Math.floor(canvas.clientHeight || canvas.height || 240)),
  };
}

function fitCameraToObject(camera: THREE.PerspectiveCamera, object: THREE.Object3D, controls: OrbitControls): void {
  const box = new THREE.Box3().setFromObject(object);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z, 0.5);
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const distance = Math.abs(maxDim / Math.tan(fov / 2)) * 0.65;

  camera.position.copy(center);
  camera.position.z += distance;
  camera.near = Math.max(distance / 1000, 0.0001);
  camera.far = Math.max(distance * 1000, 100);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
}

function resetIconCamera(iconScene = currentIconScene): void {
  if (!iconScene) {
    return;
  }
  iconScene.mesh.rotation.set(0, Math.PI / 4, 0);
  iconScene.mesh.updateMatrixWorld(true);
  fitCameraToObject(iconScene.camera, iconScene.mesh, iconScene.controls);
  iconScene.renderer.render(iconScene.scene, iconScene.camera);
}

function resizeIconRenderer(iconScene: IconScene): void {
  const canvas = iconScene.renderer.domElement;
  const { width, height } = canvasDisplaySize(canvas);
  const currentSize = new THREE.Vector2();
  iconScene.renderer.getSize(currentSize);

  if (currentSize.x === width && currentSize.y === height) {
    return;
  }

  iconScene.camera.aspect = width / height;
  iconScene.camera.updateProjectionMatrix();
  iconScene.renderer.setSize(width, height, false);
}

function refreshIconControlButtons(): void {
  const controlGroup = document.querySelector<HTMLElement>(".icon-control-group");
  if (controlGroup) {
    controlGroup.innerHTML = iconControlButtons();
  }
}

function renderIconModel(documentModel: AppSaveDocument): void {
  disposeIconScene();

  const canvas = document.querySelector<HTMLCanvasElement>(".icon-canvas");
  if (!canvas || documentModel.type !== "ps2") {
    return;
  }

  const iconSysEntry = documentModel.entries.find((entry) => entry.name.toLowerCase() === "icon.sys");
  const iconSys = iconSysEntry ? parseIconSys(iconSysEntry.data) : undefined;
  const iconEntry = iconSys
    ? selectedIconName
      ? findIconEntry(documentModel, selectedIconName)
      : findIconEntry(documentModel, iconSys.iconName)
    : undefined;
  const iconModel = iconEntry ? parseIconModel(iconEntry.data) : undefined;
  if (!iconModel || !iconSys) {
    return;
  }

  const geometry = new THREE.BufferGeometry();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];

  for (const vertex of iconModel.vertices) {
    const [x, y, z] = vertex.shapes[0] ?? [0, 0, 0];
    positions.push(x, -y, iconModel.zScale * z);
    normals.push(vertex.normal[0], -vertex.normal[1], iconModel.zScale * vertex.normal[2]);
    uvs.push(vertex.uv[0], vertex.uv[1] + iconModel.textureVOffset);
    colors.push(vertex.color[0], vertex.color[1], vertex.color[2]);
  }

  const positionAttribute = new THREE.Float32BufferAttribute(positions, 3);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const texture = new THREE.DataTexture(
    iconModel.texture,
    PS2_TEXTURE_PAGE_WIDTH,
    PS2_TEXTURE_PAGE_HEIGHT,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = iconTextureNearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.minFilter = iconTextureNearest ? THREE.NearestFilter : THREE.LinearFilter;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    color: 0xffffff,
    wireframe: iconWireframeEnabled,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.set(0, Math.PI / 4, 0);
  const scene = new THREE.Scene();
  scene.add(mesh);

  scene.add(new THREE.AmbientLight(0xffffff, 1));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 1));
  const mainLight = new THREE.DirectionalLight(0xffffff, 1);
  mainLight.position.set(1, 1, 1).normalize();
  scene.add(mainLight);

  const { width, height } = canvasDisplaySize(canvas);
  const camera = new THREE.PerspectiveCamera(32, width / height, 0.01, 100);
  const sphere = geometry.boundingSphere;
  const radius = Math.max(sphere?.radius ?? 1, 0.5);
  camera.position.set(0, 0, radius * 3.1);
  camera.lookAt(sphere?.center ?? new THREE.Vector3());

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    logarithmicDepthBuffer: true,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.sortObjects = true;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = iconTurntableEnabled && !iconAnimationPaused;
  controls.autoRotateSpeed = 1.2;
  controls.zoomToCursor = true;
  controls.target.copy(sphere?.center ?? new THREE.Vector3());
  controls.update();

  currentIconScene = { renderer, scene, camera, mesh, controls, iconModel, positionAttribute, frame: 0 };
  resetIconCamera(currentIconScene);
  const startedAt = performance.now();

  const animate = (): void => {
    if (!currentIconScene || currentIconScene.mesh !== mesh) {
      return;
    }

    resizeIconRenderer(currentIconScene);
    if (!iconAnimationPaused && iconModel.animationFrames.length > 1) {
      const frameIndex = Math.floor(((performance.now() - startedAt) / 1000) * 8) % iconModel.animationFrames.length;
      const shapeIndex = iconModel.animationFrames[frameIndex] ?? 0;

      for (let index = 0; index < iconModel.vertices.length; index += 1) {
        const [x, y, z] = iconModel.vertices[index]?.shapes[shapeIndex] ?? iconModel.vertices[index]?.shapes[0] ?? [0, 0, 0];
        positionAttribute.setXYZ(index, x, -y, iconModel.zScale * z);
      }
      positionAttribute.needsUpdate = true;
      geometry.computeBoundingSphere();
    }

    controls.autoRotate = iconTurntableEnabled && !iconAnimationPaused;
    controls.update();
    renderer.render(scene, camera);
    currentIconScene.frame = window.requestAnimationFrame(animate);
  };
  currentIconScene.frame = window.requestAnimationFrame(animate);
}

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root not found");
}

app.innerHTML = `
  <main class="app-shell">
    <header class="app-bar">
      <a class="brand" href="#top" aria-label="PS2 Save Manager home"><span class="brand-mark" aria-hidden="true">P</span><span>PS2 Save Manager</span></a>
      <div class="app-actions">
        <label class="advanced-view-toggle">
          <input id="advanced-view-toggle" type="checkbox" ${appState.advancedView ? "checked" : ""} />
          <span>Advanced view</span>
        </label>
        <button class="new-save-button" id="new-save-button" type="button"><span aria-hidden="true">＋</span> New save</button>
        <label class="picker"><span aria-hidden="true">↗</span><strong>Open file</strong><input id="file-input" type="file" accept=".psv,.mcs,.max,.pws,.psu,.xps,.sps,.xpo,.spo,.cbs,.npo,.md,.p2m" /></label>
      </div>
      <input id="entry-add-input" type="file" multiple hidden />
    </header>
    <div class="app-body" id="top">
      <aside class="sidebar" aria-label="Save navigation">
        <p class="sidebar-label">SAVE</p>
        <a class="sidebar-item is-active" href="#overview"><span aria-hidden="true">◇</span> Overview</a>
        <a class="sidebar-item" href="#entries-section"><span aria-hidden="true">≡</span> Entries</a>
        <a class="sidebar-item" href="#icon-section"><span aria-hidden="true">⬡</span> 3D icon</a>
        <p class="sidebar-label">SUPPORTED</p>
        <p class="sidebar-copy">PSV · MCS · MAX · PWS<br />PSU · XPS · SPS · XPO<br />SPO · CBS · NPO · MD · P2M</p>
      </aside>
      <section class="workspace" id="status-panel" aria-live="polite">
        <div class="empty-state"><span class="empty-glyph" aria-hidden="true">↗</span><h1>Open a save to get started</h1><p>Inspect, edit and convert PlayStation save archives directly in your browser.</p></div>
      </section>
    </div>
    <dialog class="properties-dialog" id="entry-properties-dialog">
      <form method="dialog" id="entry-properties-form">
        <input type="hidden" name="entryId" />
        <div class="properties-heading">
          <div>
            <p class="eyebrow">File properties</p>
            <h2 data-properties-name></h2>
          </div>
          <button class="properties-close" type="button" data-properties-cancel aria-label="Close">×</button>
        </div>
        <label class="properties-text-field">File Name
          <input type="text" name="fileName" maxlength="31" required />
        </label>
        <p class="properties-size" data-properties-size></p>
        <fieldset class="properties-fieldset">
          <legend>Attributes</legend>
          <label><input type="checkbox" name="readable" /> Readable</label>
          <label><input type="checkbox" name="writable" /> Writable</label>
          <label><input type="checkbox" name="executable" /> Executable</label>
          <label><input type="checkbox" name="copyProtected" /> Copy Protect</label>
          <label><input type="checkbox" name="hidden" /> Hidden</label>
        </fieldset>
        <p class="properties-mode" data-properties-mode></p>
        <p class="properties-error" data-properties-error hidden></p>
        <div class="properties-actions">
          <button class="properties-cancel" type="button" data-properties-cancel>Cancel</button>
          <button class="properties-save" type="submit">Save changes</button>
        </div>
      </form>
    </dialog>
    <dialog class="properties-dialog root-dialog" id="root-properties-dialog">
      <form method="dialog" id="root-properties-form">
        <div class="properties-heading">
          <div><p class="eyebrow">Save properties</p><h2>Rename Root/ID</h2></div>
          <button class="properties-close" type="button" data-root-cancel aria-label="Close">×</button>
        </div>
        <label class="properties-text-field">Root/ID
          <input type="text" name="rootId" maxlength="31" required />
        </label>
        <fieldset class="properties-fieldset">
          <legend>Root attributes</legend>
          <label><input type="checkbox" name="rootReadable" /> Readable</label>
          <label><input type="checkbox" name="rootWritable" /> Writable</label>
          <label><input type="checkbox" name="rootExecutable" /> Executable</label>
          <label><input type="checkbox" name="rootCopyProtected" /> Copy Protect</label>
          <label><input type="checkbox" name="rootHidden" /> Hidden</label>
        </fieldset>
        <p class="properties-error" data-root-error hidden></p>
        <div class="properties-actions">
          <button class="properties-cancel" type="button" data-root-cancel>Cancel</button>
          <button class="properties-save" type="submit">Rename</button>
        </div>
      </form>
    </dialog>
    <dialog class="properties-dialog icon-sys-dialog" id="icon-sys-dialog">
      <form method="dialog" id="icon-sys-form">
        <div class="properties-heading"><div><p class="eyebrow">Icon editor</p><h2>icon.sys</h2></div><button class="properties-close" type="button" data-icon-sys-cancel>×</button></div>
        <div class="icon-sys-grid">
          <label>Title line 1<input name="line1" maxlength="33" /></label><label>Title line 2<input name="line2" maxlength="33" /></label>
          <label>View icon<input name="viewIcon" maxlength="63" /></label><label>Copy icon<input name="copyIcon" maxlength="63" /></label><label>Delete icon<input name="deleteIcon" maxlength="63" /></label>
          <label>Transparency<input name="transparency" type="number" min="0" max="255" /></label>
        </div>
        <fieldset class="icon-sys-fieldset"><legend>Background</legend>${[0,1,2,3].map((i) => `<label>Color ${i+1}<input type="color" name="background${i}" /></label>`).join("")}</fieldset>
        <fieldset class="icon-sys-fieldset"><legend>Ambient light</legend><label>Color<input type="color" name="ambient" /></label></fieldset>
        ${[0,1,2].map((i) => `<fieldset class="icon-sys-fieldset"><legend>Light ${i+1}</legend><label>Color<input type="color" name="light${i}Color" /></label><label>X<input type="number" step="any" name="light${i}X" /></label><label>Y<input type="number" step="any" name="light${i}Y" /></label><label>Z<input type="number" step="any" name="light${i}Z" /></label></fieldset>`).join("")}
        <p class="properties-error" data-icon-sys-error hidden></p>
        <div class="properties-actions"><button class="properties-cancel" type="button" data-icon-sys-cancel>Cancel</button><button class="properties-save" type="submit">Save icon.sys</button></div>
      </form>
    </dialog>
  </main>
`;

const fileInput = document.querySelector<HTMLInputElement>("#file-input");
const advancedViewToggle = document.querySelector<HTMLInputElement>("#advanced-view-toggle");
const newSaveButton = document.querySelector<HTMLButtonElement>("#new-save-button");
const entryAddInput = document.querySelector<HTMLInputElement>("#entry-add-input");
const statusPanel = document.querySelector<HTMLElement>("#status-panel")!;
const propertiesDialog = document.querySelector<HTMLDialogElement>("#entry-properties-dialog")!;
const propertiesForm = document.querySelector<HTMLFormElement>("#entry-properties-form")!;
const rootDialog = document.querySelector<HTMLDialogElement>("#root-properties-dialog");
const rootForm = document.querySelector<HTMLFormElement>("#root-properties-form");
const iconSysDialog = document.querySelector<HTMLDialogElement>("#icon-sys-dialog")!;
const iconSysForm = document.querySelector<HTMLFormElement>("#icon-sys-form")!;

if (!fileInput || !advancedViewToggle || !newSaveButton || !entryAddInput || !statusPanel || !propertiesDialog || !propertiesForm || !rootDialog || !rootForm || !iconSysDialog || !iconSysForm) {
  throw new Error("Required UI elements missing");
}

function openEntryProperties(entryId: string): void {
  if (!appState.document) return;
  const entry = appState.document.entries.find((candidate) => candidate.id === entryId);
  if (!entry) return;
  const mode = entry.mode ?? entry.attribute ?? 0x8497;
  const attributes = editableFileAttributes(mode);
  (propertiesForm.elements.namedItem("entryId") as HTMLInputElement).value = entry.id;
  (propertiesForm.elements.namedItem("fileName") as HTMLInputElement).value = entry.name;
  for (const [name, checked] of Object.entries(attributes)) {
    (propertiesForm.elements.namedItem(name) as HTMLInputElement).checked = checked;
  }
  const name = propertiesForm.querySelector<HTMLElement>("[data-properties-name]");
  const size = propertiesForm.querySelector<HTMLElement>("[data-properties-size]");
  const modeLabel = propertiesForm.querySelector<HTMLElement>("[data-properties-mode]");
  const errorLabel = propertiesForm.querySelector<HTMLElement>("[data-properties-error]");
  if (name) name.textContent = entry.name;
  if (size) size.textContent = formatBytes(entry.data.length);
  if (modeLabel) modeLabel.textContent = `Mode 0x${mode.toString(16).toUpperCase().padStart(4, "0")}`;
  if (errorLabel) errorLabel.hidden = true;
  propertiesDialog.showModal();
}

propertiesForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!appState.document) return;
  const checkbox = (name: string): boolean => (propertiesForm.elements.namedItem(name) as HTMLInputElement).checked;
  const entryId = (propertiesForm.elements.namedItem("entryId") as HTMLInputElement).value;
  const errorLabel = propertiesForm.querySelector<HTMLElement>("[data-properties-error]");
  try {
    const entryIndex = appState.document.entries.findIndex((entry) => entry.id === entryId);
    const renamed = renameAppSaveEntry(
      appState.document,
      entryId,
      (propertiesForm.elements.namedItem("fileName") as HTMLInputElement).value,
    );
    const renamedEntryId = renamed.entries[entryIndex]?.id ?? entryId;
    appState.document = updateAppSaveEntryAttributes(renamed, renamedEntryId, {
      readable: checkbox("readable"), writable: checkbox("writable"), executable: checkbox("executable"),
      copyProtected: checkbox("copyProtected"), hidden: checkbox("hidden"),
    });
    propertiesDialog.close();
    renderDocument(appState.document);
  } catch (error) {
    if (errorLabel) {
      errorLabel.hidden = false;
      errorLabel.textContent = error instanceof Error ? error.message : String(error);
    }
  }
});

closeDialogOnDataAction(propertiesDialog, "propertiesCancel");

rootForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!appState.document) return;
  const errorLabel = rootForm.querySelector<HTMLElement>("[data-root-error]");
  try {
    const checked = (name: string): boolean => (rootForm.elements.namedItem(name) as HTMLInputElement).checked;
    const renamed = renameAppSaveRoot(appState.document, (rootForm.elements.namedItem("rootId") as HTMLInputElement).value);
    appState.document = updateAppSaveRootAttributes(renamed, {
      readable: checked("rootReadable"), writable: checked("rootWritable"), executable: checked("rootExecutable"),
      copyProtected: checked("rootCopyProtected"), hidden: checked("rootHidden"),
    });
    rootDialog.close();
    renderDocument(appState.document);
  } catch (error) {
    if (errorLabel) {
      errorLabel.hidden = false;
      errorLabel.textContent = error instanceof Error ? error.message : String(error);
    }
  }
});

closeDialogOnDataAction(rootDialog, "rootCancel");

function iconSysInput(name: string): HTMLInputElement { return iconSysForm.elements.namedItem(name) as HTMLInputElement; }
function formatIconDirection(value: number): string { return String(Number(value.toFixed(6))); }
function openIconSysEditor(): void {
  const entry = appState.document?.entries.find((candidate) => candidate.name.toLowerCase() === "icon.sys");
  if (!entry) return;
  const value = parseIconSysProperties(entry.data);
  for (const name of ["line1", "line2", "viewIcon", "copyIcon", "deleteIcon"] as const) iconSysInput(name).value = value[name];
  iconSysInput("transparency").value = String(value.transparency);
  value.background.forEach((color, i) => { iconSysInput(`background${i}`).value = color; }); iconSysInput("ambient").value = value.ambient;
  value.lights.forEach((light, i) => { iconSysInput(`light${i}Color`).value = light.color; iconSysInput(`light${i}X`).value = formatIconDirection(light.x); iconSysInput(`light${i}Y`).value = formatIconDirection(light.y); iconSysInput(`light${i}Z`).value = formatIconDirection(light.z); });
  const error = iconSysForm.querySelector<HTMLElement>("[data-icon-sys-error]"); if (error) error.hidden = true;
  iconSysDialog.showModal();
}

iconSysForm.addEventListener("submit", (event) => {
  event.preventDefault(); if (!appState.document) return;
  const number = (name: string): number => Number(iconSysInput(name).value);
  try {
    appState.document = updateIconSysProperties(appState.document, {
      line1: iconSysInput("line1").value, line2: iconSysInput("line2").value,
      viewIcon: iconSysInput("viewIcon").value, copyIcon: iconSysInput("copyIcon").value, deleteIcon: iconSysInput("deleteIcon").value,
      transparency: number("transparency"), background: [0,1,2,3].map((i) => iconSysInput(`background${i}`).value) as [string,string,string,string],
      ambient: iconSysInput("ambient").value,
      lights: [0,1,2].map((i) => ({ color: iconSysInput(`light${i}Color`).value, x: number(`light${i}X`), y: number(`light${i}Y`), z: number(`light${i}Z`) })) as any,
    }); iconSysDialog.close(); renderDocument(appState.document);
  } catch (error) { showDialogError(iconSysForm, "[data-icon-sys-error]", error); }
});
closeDialogOnDataAction(iconSysDialog, "iconSysCancel");

function renderDocument(documentModel: AppSaveDocument): void {
  const editableEntries = documentModel.type === "ps2";
  const totalSize = documentModel.entries.reduce((sum, entry) => sum + entry.data.length, 0);
  statusPanel.innerHTML = `
    <header class="document-heading" id="overview">
      <div>
        <p class="section-kicker">OPEN SAVE</p>
        <h1>${escapeHtml(documentModel.displayName)}</h1>
        <div class="root-id-row">
          <code>${escapeHtml(documentModel.dirName)}</code>
          ${documentModel.type === "ps2" ? `<button class="root-edit-button" type="button" data-edit-root="true">Rename / properties</button>` : ""}
        </div>
      </div>
      <span class="format-badge">${documentModel.sourceFormat.toUpperCase()}</span>
    </header>
    <div class="summary" aria-label="Save summary">
      <div class="summary-item">
        <p class="label">Format</p>
        <p class="value">${documentModel.sourceFormat.toUpperCase()}</p>
      </div>
      <div class="summary-item">
        <p class="label">Save Type</p>
        <p class="value">${documentModel.type.toUpperCase()}</p>
      </div>
      <div class="summary-item">
        <p class="label">Entries</p>
        <p class="value">${documentModel.entryCount}</p>
      </div>
      <div class="summary-item">
        <p class="label">Total Size</p>
        <p class="value">${formatBytes(totalSize)}</p>
      </div>
    </div>

    <section class="content-grid ${appState.advancedView ? "is-advanced" : ""}">
      ${
        appState.advancedView
          ? `<section class="workspace-section metadata-section">
              <div class="card-heading"><div><p class="section-kicker">ADVANCED</p><h2>Save metadata</h2></div></div>
              <dl class="meta-list">
                ${metadataRows(documentModel.metadata)}
              </dl>
            </section>`
          : ""
      }

      <section class="workspace-section entries-section" id="entries-section" data-entries-card="true">
        <div class="card-heading">
          <div><p class="section-kicker">CONTENTS</p><h2>Entries <span class="count-badge">${documentModel.entryCount}</span></h2></div>
          ${
            editableEntries
              ? `<button class="entry-add-button" type="button" data-add-entry="true">＋ Add files</button>`
              : ""
          }
        </div>
        <ul class="entry-list">
          ${entryRows(documentModel.entries, editableEntries)}
        </ul>
        ${editableEntries ? `<div class="entry-drop-zone" data-entry-drop-zone tabindex="0">Drop files here to add them as entries</div>` : ""}
      </section>

      ${iconView(documentModel)}
    </section>
    <section class="export-panel" aria-label="Export current save">
      <div><p class="section-kicker">CONVERT</p><h2>Export save</h2><p class="export-help">Download the current save in another compatible format.</p></div>
      <div class="export-actions">${exportButtons(documentModel)}</div>
    </section>
  `;
  try {
    renderIconModel(documentModel);
  } catch (error) {
    showIconRenderError(error);
  }
}

function showEntryEditError(message: string): void {
  const entriesCard = document.querySelector<HTMLElement>('[data-entries-card="true"]');
  if (!entriesCard) {
    return;
  }

  entriesCard.querySelector(".entry-edit-error")?.remove();
  entriesCard.insertAdjacentHTML(
    "beforeend",
    `
      <div class="error-card entry-edit-error">
        <p class="error-label">Entry edit failed</p>
        <pre>${escapeHtml(message)}</pre>
      </div>
    `,
  );
}

function showIconRenderError(error: unknown): void {
  const preview = document.querySelector<HTMLElement>('[data-icon-preview="true"]');
  if (!preview) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const canvas = preview.querySelector(".icon-canvas");
  const fallback = document.createElement("div");
  fallback.className = "icon-canvas icon-texture-empty";
  fallback.textContent = "3D render unavailable";
  canvas?.replaceWith(fallback);
  preview.insertAdjacentHTML(
    "beforeend",
    `<p class="icon-render-error">${escapeHtml(message)}</p>`,
  );
}

async function inspectSaveBuffer(arrayBuffer: ArrayBuffer, fileName: string): Promise<void> {
  const documentModel = await service.inspectBuffer(Buffer.from(arrayBuffer), fileName);
  appState.document = documentModel;
  renderDocument(documentModel);
}

advancedViewToggle.addEventListener("change", () => {
  setAdvancedView(advancedViewToggle.checked);
  if (appState.document) {
    renderDocument(appState.document);
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];

  if (!file) {
    return;
  }

  appState.document = undefined;
  selectedIconName = undefined;
  iconAnimationPaused = false;
  iconTurntableEnabled = true;
  iconTextureNearest = false;
  iconWireframeEnabled = false;
  disposeIconScene();
  statusPanel.innerHTML = `<p class="status">Reading ${file.name}...</p>`;

  try {
    const arrayBuffer = await file.arrayBuffer();
    await inspectSaveBuffer(arrayBuffer, file.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusPanel.innerHTML = `
      <div class="error-card">
        <p class="error-label">Inspection failed</p>
        <pre>${message}</pre>
      </div>
    `;
  }
});

newSaveButton.addEventListener("click", async () => {
  newSaveButton.disabled = true;
  statusPanel.innerHTML = `<p class="status">Creating blank PS2 save...</p>`;
  try {
    const [iconSysResponse, iconResponse] = await Promise.all([fetch(BLANK_ICON_SYS_URL), fetch(BLANK_ICON_URL)]);
    if (!iconSysResponse.ok || !iconResponse.ok) throw new Error("Unable to load blank-save seed files");
    appState.document = createBlankPs2Save(
      Buffer.from(await iconSysResponse.arrayBuffer()),
      Buffer.from(await iconResponse.arrayBuffer()),
    );
    selectedIconName = "my.icn";
    renderDocument(appState.document);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusPanel.innerHTML = `<div class="error-card"><p class="error-label">Blank save creation failed</p><pre>${escapeHtml(message)}</pre></div>`;
  } finally {
    newSaveButton.disabled = false;
  }
});

async function addEntryFiles(files: File[]): Promise<void> {
  if (!appState.document || appState.document.type !== "ps2") {
    return;
  }
  if (files.length === 0) {
    return;
  }

  try {
    const additions = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        data: Buffer.from(await file.arrayBuffer()),
        date: file.lastModified ? new Date(file.lastModified) : new Date(),
      })),
    );
    appState.document = addAppSaveEntries(appState.document, additions);
    selectedIconName = undefined;
    renderDocument(appState.document);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showEntryEditError(message);
  }
}

entryAddInput.addEventListener("change", async () => {
  const files = Array.from(entryAddInput.files ?? []);
  entryAddInput.value = "";
  await addEntryFiles(files);
});

statusPanel.addEventListener("dragover", (event) => {
  const zone = (event.target as HTMLElement).closest<HTMLElement>("[data-entry-drop-zone]");
  if (!zone || !appState.document || appState.document.type !== "ps2") return;
  event.preventDefault(); zone.classList.add("is-dragging");
});
statusPanel.addEventListener("dragleave", (event) => {
  (event.target as HTMLElement).closest<HTMLElement>("[data-entry-drop-zone]")?.classList.remove("is-dragging");
});
statusPanel.addEventListener("drop", async (event) => {
  const zone = (event.target as HTMLElement).closest<HTMLElement>("[data-entry-drop-zone]");
  if (!zone) return; event.preventDefault(); zone.classList.remove("is-dragging");
  await addEntryFiles(Array.from(event.dataTransfer?.files ?? []));
});

statusPanel.addEventListener("click", async (event) => {
  const target = event.target;

  if (!(target instanceof HTMLButtonElement) || !appState.document) {
    return;
  }

  const entryId = target.dataset.extractEntryId;
  if (entryId) {
    const entry = appState.document.entries.find((candidate) => candidate.id === entryId);

    if (!entry) {
      return;
    }

    target.disabled = true;
    downloadBuffer(sanitizeFileName(entry.name), "application/octet-stream", entry.data);
    target.disabled = false;
    return;
  }

  if (target.dataset.addEntry) {
    entryAddInput.click();
    return;
  }

  if (target.dataset.editIconSys) {
    openIconSysEditor();
    return;
  }

  if (target.dataset.editRoot) {
    (rootForm.elements.namedItem("rootId") as HTMLInputElement).value = appState.document.dirName;
    const rootAttributes = editableFileAttributes(appState.document.rootMode ?? 0x84a7);
    for (const [name, checked] of Object.entries(rootAttributes)) {
      const inputName = `root${name[0]!.toUpperCase()}${name.slice(1)}`;
      (rootForm.elements.namedItem(inputName) as HTMLInputElement).checked = checked;
    }
    const errorLabel = rootForm.querySelector<HTMLElement>("[data-root-error]");
    if (errorLabel) errorLabel.hidden = true;
    rootDialog.showModal();
    return;
  }

  const removeEntryId = target.dataset.removeEntryId;
  if (removeEntryId) {
    appState.document = removeAppSaveEntry(appState.document, removeEntryId);
    if (selectedIconName && !appState.document.entries.some((entry) => entry.name === selectedIconName)) {
      selectedIconName = undefined;
    }
    renderDocument(appState.document);
    return;
  }

  const propertiesEntryId = target.dataset.propertiesEntryId;
  if (propertiesEntryId) {
    openEntryProperties(propertiesEntryId);
    return;
  }

  const iconName = target.dataset.iconName;
  if (iconName) {
    selectedIconName = iconName;
    renderDocument(appState.document);
    return;
  }

  const iconAction = target.dataset.iconAction;
  if (iconAction) {
    if (iconAction === "pause") {
      iconAnimationPaused = !iconAnimationPaused;
      if (currentIconScene) {
        currentIconScene.controls.autoRotate = iconTurntableEnabled && !iconAnimationPaused;
      }
    } else if (iconAction === "turntable") {
      iconTurntableEnabled = !iconTurntableEnabled;
      if (currentIconScene) {
        currentIconScene.controls.autoRotate = iconTurntableEnabled && !iconAnimationPaused;
      }
    } else if (iconAction === "texture") {
      iconTextureNearest = !iconTextureNearest;
      if (currentIconScene) {
        applyIconTextureFiltering(currentIconScene.mesh, iconTextureNearest);
      }
    } else if (iconAction === "wireframe") {
      iconWireframeEnabled = !iconWireframeEnabled;
      if (currentIconScene) {
        applyIconWireframe(currentIconScene.mesh, iconWireframeEnabled);
      }
    } else if (iconAction === "reset-camera") {
      resetIconCamera();
    }
    refreshIconControlButtons();
    return;
  }

  if (!target.dataset.exportFormat) {
    return;
  }

  try {
    target.disabled = true;
    const exported = await exportService.export(appState.document, target.dataset.exportFormat as ExportFormat);
    downloadBuffer(exported.fileName, exported.mimeType, exported.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    statusPanel.insertAdjacentHTML(
      "beforeend",
      `
        <div class="error-card export-error">
          <p class="error-label">Export failed</p>
          <pre>${message}</pre>
        </div>
      `,
    );
  } finally {
    target.disabled = false;
  }
});
