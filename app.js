const CONFIG_KEY = "park-skazka-map-layer-config-v1";

const state = {
  manifest: null,
  objects: [],
  objectByLayerId: new Map(),
  statuses: new Map(),
  configs: {},
  filter: "all",
  query: "",
  zoom: 1,
  temperature: null,
  selectedLayerId: null,
};

const elements = {
  base: document.querySelector("#base-map"),
  overlayRoot: document.querySelector("#overlay-root"),
  list: document.querySelector("#layer-list"),
  template: document.querySelector("#layer-row-template"),
  search: document.querySelector("#search"),
  viewport: document.querySelector("#map-viewport"),
  stage: document.querySelector("#map-stage"),
  mapPanel: document.querySelector(".map-panel"),
  zoomValue: document.querySelector("#zoom-reset"),
  openCount: document.querySelector("#open-count"),
  inactiveCount: document.querySelector("#inactive-count"),
  updatedAt: document.querySelector("#updated-at"),
  settingsSelect: document.querySelector("#settings-layer-select"),
  settingsForm: document.querySelector("#layer-settings"),
  settingName: document.querySelector("#setting-name"),
  settingConditions: document.querySelector("#setting-conditions"),
  settingMinTemp: document.querySelector("#setting-min-temp"),
  additional: document.querySelector("#additional-parameters"),
  saveMessage: document.querySelector("#save-message"),
};

const tooltip = document.createElement("div");
tooltip.className = "map-tooltip";
tooltip.setAttribute("role", "status");
tooltip.hidden = true;
elements.mapPanel.append(tooltip);

function objectForLayer(layer) {
  return state.objectByLayerId.get(layer.id) ?? null;
}

function displayLayerName(layer) {
  const object = objectForLayer(layer);
  if (!object) return layer.name;
  return `${String(object.number).padStart(2, "0")} ${object.name}`;
}

function layerConfig(layer) {
  const saved = state.configs[layer.id];
  if (saved) return saved;
  return { name: displayLayerName(layer), conditions: "", minTempC: null, additional: [] };
}

function effectiveStatus(layer) {
  return state.statuses.get(layer.id)?.status ?? layer.defaultStatus ?? "unknown";
}

function isTemperatureAllowed(layer) {
  const minimum = layerConfig(layer).minTempC;
  return minimum === null || minimum === "" || Number.isNaN(Number(minimum)) || state.temperature === null || state.temperature >= Number(minimum);
}

function isOpen(layer) {
  return effectiveStatus(layer) === "open" && isTemperatureAllowed(layer);
}

function renderLayers() {
  if (!state.manifest) return;
  const query = state.query.trim().toLocaleLowerCase("ru");
  let open = 0;
  elements.list.replaceChildren();

  for (const layer of state.manifest.layers) {
    const status = effectiveStatus(layer);
    if (isOpen(layer)) open += 1;
    const matchesQuery = layerConfig(layer).name.toLocaleLowerCase("ru").includes(query);
    const matchesFilter = state.filter === "all"
      || (state.filter === "open" && isOpen(layer))
      || (state.filter === "inactive" && !isOpen(layer));
    if (!matchesQuery || !matchesFilter) continue;

    const row = elements.template.content.firstElementChild.cloneNode(true);
    row.dataset.status = isOpen(layer) ? "open" : status;
    row.querySelector(".layer-name").textContent = layerConfig(layer).name;
    row.querySelector(".layer-id").textContent = layer.id;
    const select = row.querySelector(".status-select");
    select.value = status;
    select.addEventListener("change", () => setManualStatus(layer.id, select.value));
    row.querySelector(".visibility").addEventListener("click", () => setManualStatus(layer.id, isOpen(layer) ? "unknown" : "open"));
    elements.list.append(row);
  }

  state.manifest.layers.forEach((layer) => {
    document.querySelector(`[data-layer-id="${layer.id}"]`)?.classList.toggle("visible", isOpen(layer));
  });
  elements.openCount.textContent = String(open);
  elements.inactiveCount.textContent = String(state.manifest.layers.length - open);
}

function setManualStatus(id, status) {
  state.statuses.set(id, { status, source: "manual-demo", updatedAt: new Date().toISOString() });
  elements.updatedAt.textContent = "Ручное изменение: только в этом браузере";
  renderLayers();
}

function showTooltip(event, label) {
  const bounds = elements.mapPanel.getBoundingClientRect();
  tooltip.textContent = label;
  tooltip.hidden = false;
  tooltip.style.left = `${event.clientX - bounds.left + 12}px`;
  tooltip.style.top = `${event.clientY - bounds.top + 12}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function createMapLayers() {
  for (const layer of state.manifest.layers) {
    const image = document.createElement("img");
    const object = objectForLayer(layer);
    image.className = "map-layer";
    image.dataset.layerId = layer.id;
    image.alt = "";
    image.loading = "lazy";
    image.src = layer.asset;
    image.style.left = `${layer.bbox.left}px`;
    image.style.top = `${layer.bbox.top}px`;
    image.style.width = `${layer.bbox.width}px`;
    image.style.height = `${layer.bbox.height}px`;
    if (object) {
      image.style.pointerEvents = "auto";
      image.addEventListener("pointerenter", (event) => showTooltip(event, `${String(object.number).padStart(2, "0")} ${object.name}`));
      image.addEventListener("pointermove", (event) => showTooltip(event, `${String(object.number).padStart(2, "0")} ${object.name}`));
      image.addEventListener("pointerleave", hideTooltip);
    }
    elements.overlayRoot.append(image);
    if (object) {
      const hitbox = document.createElement("div");
      hitbox.className = "map-hitbox";
      hitbox.dataset.layerId = layer.id;
      hitbox.style.left = `${layer.bbox.left}px`;
      hitbox.style.top = `${layer.bbox.top}px`;
      hitbox.style.width = `${layer.bbox.width}px`;
      hitbox.style.height = `${layer.bbox.height}px`;
      hitbox.addEventListener("pointerenter", (event) => showTooltip(event, `${String(object.number).padStart(2, "0")} ${object.name}`));
      hitbox.addEventListener("pointermove", (event) => showTooltip(event, `${String(object.number).padStart(2, "0")} ${object.name}`));
      hitbox.addEventListener("pointerleave", hideTooltip);
      elements.overlayRoot.append(hitbox);
    }
  }
}

function setZoom(nextZoom) {
  state.zoom = Math.max(0.25, Math.min(3, nextZoom));
  const { width, height } = state.manifest.render;
  elements.stage.style.width = `${width * state.zoom}px`;
  elements.stage.style.height = `${height * state.zoom}px`;
  elements.base.style.width = `${width * state.zoom}px`;
  elements.base.style.height = `${height * state.zoom}px`;
  elements.overlayRoot.style.transform = `scale(${state.zoom})`;
  elements.overlayRoot.style.transformOrigin = "0 0";
  elements.overlayRoot.style.width = `${width}px`;
  elements.overlayRoot.style.height = `${height}px`;
  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
}

function fitMap() {
  const { width, height } = state.manifest.render;
  setZoom(Math.min(elements.viewport.clientWidth / width, elements.viewport.clientHeight / height));
  elements.viewport.scrollTo(0, 0);
}

function renderSettingsLayerList() {
  elements.settingsSelect.replaceChildren();
  for (const layer of state.manifest.layers) {
    const option = document.createElement("option");
    option.value = layer.id;
    option.textContent = layerConfig(layer).name;
    elements.settingsSelect.append(option);
  }
  if (!state.selectedLayerId) state.selectedLayerId = state.manifest.layers[0]?.id;
  elements.settingsSelect.value = state.selectedLayerId;
  loadSettings();
}

function loadSettings() {
  const layer = state.manifest.layers.find((item) => item.id === state.selectedLayerId);
  if (!layer) return;
  const config = layerConfig(layer);
  elements.settingName.value = config.name;
  elements.settingConditions.value = config.conditions;
  elements.settingMinTemp.value = config.minTempC ?? "";
  elements.additional.replaceChildren();
  (config.additional ?? []).forEach((item) => addParameterRow(item.key, item.value));
}

function addParameterRow(key = "", value = "") {
  const row = document.createElement("div");
  row.className = "parameter-row";
  row.innerHTML = `<input class="parameter-key" aria-label="Название дополнительного параметра" placeholder="Параметр" value=""><input class="parameter-value" aria-label="Значение дополнительного параметра" placeholder="Значение" value=""><button type="button" class="remove-parameter" title="Удалить параметр" aria-label="Удалить параметр">×</button>`;
  row.querySelector(".parameter-key").value = key;
  row.querySelector(".parameter-value").value = value;
  row.querySelector(".remove-parameter").addEventListener("click", () => row.remove());
  elements.additional.append(row);
}

function saveSettings(event) {
  event.preventDefault();
  const layer = state.manifest.layers.find((item) => item.id === state.selectedLayerId);
  if (!layer) return;
  const additional = [...elements.additional.querySelectorAll(".parameter-row")]
    .map((row) => ({ key: row.querySelector(".parameter-key").value.trim(), value: row.querySelector(".parameter-value").value.trim() }))
    .filter((item) => item.key);
  state.configs[layer.id] = { name: elements.settingName.value.trim() || layer.name, conditions: elements.settingConditions.value.trim(), minTempC: elements.settingMinTemp.value === "" ? null : Number(elements.settingMinTemp.value), additional };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.configs));
  renderSettingsLayerList();
  renderLayers();
  elements.saveMessage.textContent = "Сохранено локально";
  setTimeout(() => { elements.saveMessage.textContent = ""; }, 2500);
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tabName));
  if (tabName === "settings") renderSettingsLayerList();
  if (tabName === "map") requestAnimationFrame(fitMap);
}

function enablePan() {
  let drag = null;
  elements.viewport.addEventListener("pointerdown", (event) => {
    if (event.target.classList.contains("map-layer")) return;
    drag = { x: event.clientX, y: event.clientY, left: elements.viewport.scrollLeft, top: elements.viewport.scrollTop };
    elements.viewport.classList.add("dragging");
    elements.viewport.setPointerCapture(event.pointerId);
  });
  elements.viewport.addEventListener("pointermove", (event) => {
    if (!drag) return;
    elements.viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    elements.viewport.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const stop = () => { drag = null; elements.viewport.classList.remove("dragging"); };
  elements.viewport.addEventListener("pointerup", stop);
  elements.viewport.addEventListener("pointercancel", stop);
}

async function init() {
  const [manifestResponse, statusResponse, objectResponse] = await Promise.all([
    fetch("data/layers.json"),
    fetch("data/status.json"),
    fetch("data/object-map.json"),
  ]);
  state.manifest = await manifestResponse.json();
  const statusPayload = await statusResponse.json();
  const objectPayload = await objectResponse.json();
  state.objects = objectPayload.objects;
  state.objectByLayerId = new Map(state.objects.filter((item) => item.layerId).map((item) => [item.layerId, item]));
  for (const item of statusPayload.items) state.statuses.set(item.id, item);
  try { state.configs = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}"); } catch { state.configs = {}; }

  elements.base.src = state.manifest.render.base;
  createMapLayers();
  renderLayers();
  elements.updatedAt.textContent = statusPayload.generatedAt ? `Статусы: ${new Date(statusPayload.generatedAt).toLocaleString("ru-RU")}` : "Статусы не заданы";
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  elements.search.addEventListener("input", () => { state.query = elements.search.value; renderLayers(); });
  document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.filter = button.dataset.filter; renderLayers(); }));
  document.querySelectorAll(".temperature-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".temperature-button").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.temperature = button.dataset.temperature === "null" ? null : Number(button.dataset.temperature); renderLayers(); }));
  document.querySelector("#zoom-in").addEventListener("click", () => setZoom(state.zoom * 1.25));
  document.querySelector("#zoom-out").addEventListener("click", () => setZoom(state.zoom / 1.25));
  elements.zoomValue.addEventListener("click", fitMap);
  elements.viewport.addEventListener("wheel", (event) => { if (!event.ctrlKey) return; event.preventDefault(); setZoom(state.zoom * (event.deltaY < 0 ? 1.1 : 0.9)); }, { passive: false });
  enablePan();
  elements.settingsSelect.addEventListener("change", () => { state.selectedLayerId = elements.settingsSelect.value; loadSettings(); });
  document.querySelector("#add-parameter").addEventListener("click", () => addParameterRow());
  elements.settingsForm.addEventListener("submit", saveSettings);
  requestAnimationFrame(fitMap);
}

init().catch((error) => { elements.updatedAt.textContent = "Ошибка загрузки данных"; console.error(error); });
