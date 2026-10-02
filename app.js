const CONFIG_KEY = "park-skazka-map-layer-config-v1";

const state = {
  manifest: null,
  objects: [],
  objectByLayerId: new Map(),
  objectsByLayerId: new Map(),
  propertiesByNumber: new Map(),
  statuses: new Map(),
  configs: {},
  filter: "all",
  query: "",
  zoom: 1,
  temperature: null,
  scenario: { type: "all", maintenance: "normal", repair: "normal", weather: "normal" },
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
  scenarioList: document.querySelector("#scenario-list"),
  scenarioType: document.querySelector("#scenario-type"),
  scenarioWeather: document.querySelector("#scenario-weather"),
  scenarioMaintenance: document.querySelector("#scenario-maintenance"),
  scenarioRepair: document.querySelector("#scenario-repair"),
  scenarioMatrix: document.querySelector("#scenario-matrix"),
};

const tooltip = document.createElement("div");
tooltip.className = "map-tooltip";
tooltip.setAttribute("role", "status");
tooltip.hidden = true;
elements.mapPanel.append(tooltip);

const STATUS_LABELS = {
  open: "Работает",
  maintenance: "ТО",
  closed: "Закрыт",
  weather_hold: "Погода",
  unknown: "Не задан",
};

function objectForLayer(layer) {
  return state.objectsByLayerId.get(layer.id)?.[0] ?? null;
}

function objectsForLayer(layer) {
  return state.objectsByLayerId.get(layer.id) ?? [];
}

function cleanLayerName(name) {
  return String(name ?? "").replace(/^\s*\d{1,3}(?:\.|\))?\s+/, "").trim();
}

function displayLayerName(layer) {
  const objects = objectsForLayer(layer);
  if (!objects.length) return cleanLayerName(layer.name);
  return objects.map((object) => `${String(object.number).padStart(2, "0")} ${cleanLayerName(object.name)}`).join(" / ");
}

function layerConfig(layer) {
  const saved = state.configs[layer.id];
  if (saved) return { ...saved, name: cleanLayerName(saved.name) || displayLayerName(layer), scenarios: normalizeScenarios(saved.scenarios, layer) };
  return { name: displayLayerName(layer), conditions: "", minTempC: null, additional: [], scenarios: normalizeScenarios(null, layer) };
}

const TEMPERATURE_SCENARIOS = ["0", "-5", "-10", "-15"];
const TYPE_SCENARIOS = ["Экстремальные", "Детские", "Семейные", "Интерактивные", "Тематические"];
const SCENARIO_FIELDS = [
  ...TEMPERATURE_SCENARIOS.map((value) => ({ group: "temperature", key: value, label: `Температура ${value === "0" ? "выше 0" : value + " °C"}` })),
  ...TYPE_SCENARIOS.map((value) => ({ group: "type", key: value, label: `Тип: ${value}` })),
  { group: "maintenance", key: "normal", label: "ТО: нет" },
  { group: "maintenance", key: "maintenance", label: "ТО: да" },
  { group: "repair", key: "normal", label: "Ремонт: нет" },
  { group: "repair", key: "repair", label: "Ремонт: да" },
  { group: "weather", key: "normal", label: "Погода: норма" },
  { group: "weather", key: "weather", label: "Погода: ограничение" },
];

function normalizeScenarios(value, layer) {
  const property = propertyForLayer(layer);
  const normalizeCondition = (group, activeKey) => {
    const source = value?.[group];
    if (typeof source === "string") return { normal: "open", [activeKey]: source };
    return { normal: source?.normal ?? "open", [activeKey]: source?.[activeKey] ?? "open" };
  };
  return {
    temperature: Object.fromEntries(TEMPERATURE_SCENARIOS.map((key) => [key, value?.temperature?.[key] ?? (property?.temperatureWork?.[`до ${key}`] === false ? "closed" : "open")])),
    type: Object.fromEntries(TYPE_SCENARIOS.map((key) => [key, value?.type?.[key] ?? "open"])),
    maintenance: normalizeCondition("maintenance", "maintenance"),
    repair: normalizeCondition("repair", "repair"),
    weather: normalizeCondition("weather", "weather"),
  };
}

function effectiveStatus(layer) {
  // Пока внешний поток ТОиР не передал статус, слой доступен для просмотра;
  // явно переданный статус по-прежнему имеет приоритет.
  return state.statuses.get(layer.id)?.status ?? layer.defaultStatus ?? "open";
}

function isTemperatureAllowed(layer) {
  if (state.temperature === null) return true;
  return layerConfig(layer).scenarios.temperature[String(state.temperature)] === "open";
}

function syncScenarioControls() {
  if (elements.scenarioType) elements.scenarioType.value = state.scenario.type;
  if (elements.scenarioWeather) elements.scenarioWeather.value = state.scenario.weather;
  if (elements.scenarioMaintenance) elements.scenarioMaintenance.value = state.scenario.maintenance;
  if (elements.scenarioRepair) elements.scenarioRepair.value = state.scenario.repair;
}

function isScenarioAllowed(layer) {
  const config = layerConfig(layer);
  const property = propertyForLayer(layer);
  const selectedType = state.scenario.type;
  const typeStatus = selectedType === "all"
    || (property?.purpose === selectedType && config.scenarios.type[selectedType] === "open");
  const maintenanceStatus = config.scenarios.maintenance[state.scenario.maintenance] === "open";
  const repairStatus = config.scenarios.repair[state.scenario.repair] === "open";
  const weatherStatus = config.scenarios.weather[state.scenario.weather] === "open";
  return typeStatus && maintenanceStatus && repairStatus && weatherStatus;
}

function isOpen(layer) {
  return effectiveStatus(layer) === "open" && isTemperatureAllowed(layer) && isScenarioAllowed(layer);
}

function propertyForLayer(layer) {
  const object = objectForLayer(layer);
  return object ? state.propertiesByNumber.get(object.number) ?? null : null;
}

function propertiesForLayer(layer) {
  return objectsForLayer(layer)
    .map((object) => state.propertiesByNumber.get(object.number))
    .filter(Boolean);
}

function tooltipLines(layer) {
  const config = layerConfig(layer);
  const properties = propertiesForLayer(layer);
  const property = properties[0] ?? propertyForLayer(layer);
  const status = effectiveStatus(layer);
  const lines = [
    config.name || layer.name,
    `Статус: ${STATUS_LABELS[status] ?? status}`,
  ];
  if (config.conditions) lines.push(`Условия работы: ${config.conditions}`);
  if (config.minTempC !== null && config.minTempC !== "" && !Number.isNaN(Number(config.minTempC))) {
    lines.push(`Минимальная температура: ${config.minTempC} °C`);
  }
  if (property?.purpose) lines.push(`Назначение: ${property.purpose}`);
  if (property?.temperatureWork) {
    const workingRanges = Object.entries(property.temperatureWork)
      .filter(([, works]) => works)
      .map(([range]) => range);
    lines.push(`Работает при температуре: ${workingRanges.length ? workingRanges.join(", ") : "нет данных"}`);
  }
  const extraProperties = properties.slice(1).map((item) => item.name).filter(Boolean);
  if (extraProperties.length) lines.push(`Связанные объекты: ${extraProperties.join(", ")}`);
  for (const item of config.additional ?? []) {
    if (item.key && item.value) lines.push(`${item.key}: ${item.value}`);
  }
  return lines;
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

function showTooltip(event, layer) {
  const bounds = elements.mapPanel.getBoundingClientRect();
  tooltip.replaceChildren();
  tooltipLines(layer).forEach((line, index) => {
    const row = document.createElement(index === 0 ? "strong" : "div");
    row.textContent = line;
    tooltip.append(row);
  });
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
    if (objectsForLayer(layer).length) {
      image.style.pointerEvents = "auto";
      image.addEventListener("pointerenter", (event) => showTooltip(event, layer));
      image.addEventListener("pointermove", (event) => showTooltip(event, layer));
      image.addEventListener("pointerleave", hideTooltip);
    }
    elements.overlayRoot.append(image);
    if (objectsForLayer(layer).length) {
      const hitbox = document.createElement("div");
      hitbox.className = "map-hitbox";
      hitbox.dataset.layerId = layer.id;
      hitbox.style.left = `${layer.bbox.left}px`;
      hitbox.style.top = `${layer.bbox.top}px`;
      hitbox.style.width = `${layer.bbox.width}px`;
      hitbox.style.height = `${layer.bbox.height}px`;
      hitbox.addEventListener("pointerenter", (event) => showTooltip(event, layer));
      hitbox.addEventListener("pointermove", (event) => showTooltip(event, layer));
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
  renderScenarioMatrix(config.scenarios);
}

function renderScenarioMatrix(scenarios) {
  if (!elements.scenarioMatrix) return;
  elements.scenarioMatrix.replaceChildren();
  for (const field of SCENARIO_FIELDS) {
    const row = document.createElement("label");
    row.className = "scenario-row";
    row.innerHTML = `<span>${field.label}</span><select data-scenario-group="${field.group}" data-scenario-key="${field.key}"><option value="open">Работает</option><option value="closed">Не работает</option></select>`;
    const select = row.querySelector("select");
    select.value = scenarios[field.group]?.[field.key] ?? scenarios[field.group] ?? "open";
    elements.scenarioMatrix.append(row);
  }
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
  const scenarios = { temperature: {}, type: {}, maintenance: { normal: "open", maintenance: "open" }, repair: { normal: "open", repair: "open" }, weather: { normal: "open", weather: "open" } };
  elements.scenarioMatrix?.querySelectorAll("select").forEach((select) => {
    const group = select.dataset.scenarioGroup;
    const key = select.dataset.scenarioKey;
    if (["maintenance", "repair", "weather"].includes(group)) scenarios[group][key] = select.value;
    else scenarios[group][key] = select.value;
  });
  state.configs[layer.id] = { name: elements.settingName.value.trim() || layer.name, conditions: elements.settingConditions.value.trim(), minTempC: elements.settingMinTemp.value === "" ? null : Number(elements.settingMinTemp.value), additional, scenarios };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.configs));
  renderSettingsLayerList();
  renderLayers();
  renderScenarioList();
  elements.saveMessage.textContent = "Сохранено локально";
  setTimeout(() => { elements.saveMessage.textContent = ""; }, 2500);
}

function switchTab(tabName) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tabName));
  if (tabName === "settings") renderSettingsLayerList();
  if (tabName === "map") requestAnimationFrame(fitMap);
}

function renderScenarioList() {
  if (!elements.scenarioList || !state.manifest) return;
  elements.scenarioList.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "default";
  defaultOption.textContent = "Сценарии";
  elements.scenarioList.append(defaultOption);
  for (const layer of state.manifest.layers) {
    const config = layerConfig(layer);
    for (const field of SCENARIO_FIELDS) {
      const status = config.scenarios[field.group]?.[field.key] ?? config.scenarios[field.group];
      if (status !== "closed") continue;
      const option = document.createElement("option");
      option.value = `${layer.id}:${field.group}:${field.key}`;
      option.textContent = `${displayLayerName(layer)} — ${field.label}: Не работает`;
      elements.scenarioList.append(option);
    }
  }
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
  const [manifestResponse, statusResponse, objectResponse, propertyResponse] = await Promise.all([
    fetch("data/layers.json"),
    fetch("data/status.json"),
    fetch("data/object-map.json"),
    fetch("data/location-properties.json"),
  ]);
  state.manifest = await manifestResponse.json();
  const statusPayload = await statusResponse.json();
  const objectPayload = await objectResponse.json();
  const propertyPayload = await propertyResponse.json();
  state.objects = objectPayload.objects;
  state.propertiesByNumber = new Map(propertyPayload.properties.map((item) => [item.number, item]));
  state.objectsByLayerId = new Map();
  for (const layer of state.manifest.layers) {
    const layerName = cleanLayerName(layer.name).toLocaleLowerCase("ru");
    const matches = state.objects.filter((item) => {
      const names = [item.name, item.sourceName].filter(Boolean)
        .map((name) => cleanLayerName(name).toLocaleLowerCase("ru"));
      return item.layerId === layer.id || item.layerIds?.includes(layer.id) || names.includes(layerName);
    });
    if (matches.length) state.objectsByLayerId.set(layer.id, matches);
  }
  state.objectByLayerId = new Map([...state.objectsByLayerId].map(([id, objects]) => [id, objects[0]]));
  for (const item of statusPayload.items) state.statuses.set(item.id, item);
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "{}");
    state.configs = Object.fromEntries(Object.entries(stored).map(([id, config]) => {
      const layer = state.manifest.layers.find((item) => item.id === id);
      const legacyName = cleanLayerName(config?.name);
      const sourceName = layer ? cleanLayerName(layer.name) : "";
      return [id, { ...config, name: layer && (!legacyName || legacyName === sourceName) ? displayLayerName(layer) : legacyName }];
    }));
  } catch { state.configs = {}; }

  elements.base.src = state.manifest.render.base;
  createMapLayers();
  renderLayers();
  renderScenarioList();
  elements.updatedAt.textContent = statusPayload.generatedAt ? `Статусы: ${new Date(statusPayload.generatedAt).toLocaleString("ru-RU")}` : "Статусы не заданы";
  document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));
  elements.search.addEventListener("input", () => { state.query = elements.search.value; renderLayers(); });
  document.querySelectorAll(".filter-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".filter-button").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.filter = button.dataset.filter; renderLayers(); }));
  document.querySelectorAll(".temperature-button").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll(".temperature-button").forEach((item) => item.classList.remove("active")); button.classList.add("active"); state.temperature = button.dataset.temperature === "null" ? null : Number(button.dataset.temperature); renderLayers(); }));
  elements.scenarioList?.addEventListener("change", () => {
    const value = elements.scenarioList.value;
    if (value === "default") {
      state.scenario = { type: "all", maintenance: "normal", repair: "normal", weather: "normal" };
      state.temperature = null;
      syncScenarioControls();
      renderLayers();
      return;
    }
    const [, group, key] = value.split(":");
    if (group === "temperature") {
      state.temperature = Number(key);
      document.querySelectorAll(".temperature-button").forEach((button) => button.classList.toggle("active", button.dataset.temperature === key));
    } else if (group === "type") {
      state.scenario.type = key;
    } else if (group === "maintenance" || group === "repair" || group === "weather") {
      state.scenario[group] = key;
    }
    syncScenarioControls();
    renderLayers();
  });
  elements.scenarioType?.addEventListener("change", () => { state.scenario.type = elements.scenarioType.value; renderLayers(); });
  elements.scenarioWeather?.addEventListener("change", () => { state.scenario.weather = elements.scenarioWeather.value; renderLayers(); });
  elements.scenarioMaintenance?.addEventListener("change", () => { state.scenario.maintenance = elements.scenarioMaintenance.value; renderLayers(); });
  elements.scenarioRepair?.addEventListener("change", () => { state.scenario.repair = elements.scenarioRepair.value; renderLayers(); });
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
