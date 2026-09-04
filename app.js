import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SAMPLES } from './samples.js';

const el = (id) => document.getElementById(id);
const providerSelect = el('provider');
const modelInput = el('modelName');
const siteJsonInput = el('siteJson');
const sampleSelect = el('sampleSelect');
const generateBtn = el('generateBtn');
const titleblock = el('titleblock');
const undoBtn = el('undoBtn');
const chatLog = el('chatLog');
const chatInput = el('chatInput');
const chatSendBtn = el('chatSendBtn');
const composerForm = el('composerForm');
const quickList = el('quickList');
const emptyState = el('emptyState');
const viewport = el('viewport');
const layerPanel = el('layerPanel');
const consoleToggle = el('consoleToggle');
const consolePanel = el('consolePanel');
const consoleLog = el('consoleLog');
const consoleClear = el('consoleClear');
const consoleClose = el('consoleClose');

// ---- LLM 콘솔: 실제로 LLM API에 보낸 요청/받은 응답을 그대로 보여준다 ----
consoleToggle.addEventListener('click', () => {
  consolePanel.hidden = !consolePanel.hidden;
});
consoleClose.addEventListener('click', () => {
  consolePanel.hidden = true;
});
consoleClear.addEventListener('click', () => {
  consoleLog.innerHTML = '';
});

function logConsole({ ok, status, provider, model, request, response }) {
  const placeholder = consoleLog.querySelector('.console-placeholder');
  if (placeholder) placeholder.remove();

  const time = new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const div = document.createElement('div');
  div.className = `console-entry ${ok ? 'ok' : 'error'}`;
  div.innerHTML = `
    <div class="console-meta">
      <span class="tag">${escapeHtml(time)} · ${escapeHtml(provider || '?')} ${escapeHtml(model || '')} · ${ok ? 'OK' : 'ERROR ' + status}</span>
    </div>
    <details open>
      <summary>요청 (request)</summary>
      <pre>${escapeHtml(JSON.stringify(request ?? null, null, 2))}</pre>
    </details>
    <details>
      <summary>응답 (response)</summary>
      <pre>${escapeHtml(JSON.stringify(response ?? null, null, 2))}</pre>
    </details>
  `;
  consoleLog.appendChild(div); // .console-log는 column-reverse라 최신이 맨 위에 보인다
}

// ---- persisted settings ----
const PROVIDER_DEFAULT_MODELS = {
  gemini: 'gemini-3.7-flash',
  anthropic: 'claude-sonnet-5'
};

function loadModelForProvider(provider) {
  return localStorage.getItem(`model_${provider}`) || PROVIDER_DEFAULT_MODELS[provider];
}

providerSelect.value = localStorage.getItem('llm_provider') || 'gemini';
modelInput.value = loadModelForProvider(providerSelect.value);

providerSelect.addEventListener('change', () => {
  localStorage.setItem('llm_provider', providerSelect.value);
  modelInput.value = loadModelForProvider(providerSelect.value);
});
modelInput.addEventListener('change', () => {
  localStorage.setItem(`model_${providerSelect.value}`, modelInput.value);
});

// ---- sample presets ----
SAMPLES.forEach((s, i) => {
  const opt = document.createElement('option');
  opt.value = i;
  opt.textContent = s.name;
  sampleSelect.appendChild(opt);
});
sampleSelect.addEventListener('change', () => {
  siteJsonInput.value = JSON.stringify(SAMPLES[sampleSelect.value].data, null, 2);
});
siteJsonInput.value = JSON.stringify(SAMPLES[0].data, null, 2);

// ---- quick requests ----
const QUICK_REQUESTS = [
  '저층부를 넓혀서 로비 공간을 확보해줘',
  '상부 층을 단계적으로 후퇴시켜 스카이라인을 만들어줘',
  '층을 하나 더 올리고 상층부는 좁게 유지해줘',
  '매스 전체를 15도 돌려서 대지에 맞춰줘',
  '기준층 층고를 3.6m로 높여줘'
];
QUICK_REQUESTS.forEach((text) => {
  const btn = document.createElement('button');
  btn.className = 'quick-btn';
  btn.type = 'button';
  btn.textContent = text;
  btn.disabled = true;
  btn.addEventListener('click', () => sendChat(text));
  quickList.appendChild(btn);
});

// ---- three.js scene ----
const scene = new THREE.Scene();
scene.background = null;

const camera = new THREE.PerspectiveCamera(45, viewport.clientWidth / viewport.clientHeight, 0.1, 4000);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(viewport.clientWidth, viewport.clientHeight);
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.addEventListener('start', () => setActiveViewBtn(null));

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(30, 50, 20);
scene.add(sun);
const fill = new THREE.DirectionalLight(0x57c2d6, 0.25);
fill.position.set(-30, 20, -20);
scene.add(fill);

let massGroup = new THREE.Group();
scene.add(massGroup);
let siteOutline = null;
let groundGrid = null;
let viewRadius = 40;

window.addEventListener('resize', () => {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
});

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

// ---- view presets (좌표계: phi = Y축으로부터의 각도, 0=바로 위, 90=수평) ----
const VIEW_PRESETS = {
  plan: { phi: 2, theta: 0 },
  bird: { phi: 35, theta: -35 },
  close: { phi: 62, theta: -35 },
  front: { phi: 90, theta: 0 }
};

function setView(name) {
  const p = VIEW_PRESETS[name];
  if (!p) return;
  const phi = THREE.MathUtils.degToRad(p.phi);
  const theta = THREE.MathUtils.degToRad(p.theta);
  const target = controls.target;
  camera.position.set(
    target.x + viewRadius * Math.sin(phi) * Math.sin(theta),
    target.y + viewRadius * Math.cos(phi),
    target.z + viewRadius * Math.sin(phi) * Math.cos(theta)
  );
  controls.update();
  setActiveViewBtn(name);
}

function setActiveViewBtn(name) {
  document.querySelectorAll('.vbtn').forEach((b) => b.classList.toggle('on', b.dataset.view === name));
}

document.querySelectorAll('.vbtn').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.view));
});

// ---- mass generation (deterministic, rule-based) ----
let currentSpec = null;
let rev = 0;
let history = [];
let prevValues = null;

function computeDerived(site) {
  const maxBuildingArea = site.siteArea * (site.coverageRatio / 100);
  const maxFloorArea = site.siteArea * (site.farRatio / 100);
  return { maxBuildingArea, maxFloorArea };
}

function footprintDims(area, site) {
  let ratio = 1; // width / depth
  if (site.siteWidth && site.siteDepth) ratio = site.siteWidth / site.siteDepth;
  const depth = Math.sqrt(area / ratio);
  const width = area / depth;
  // 소수점 반올림으로 폭×깊이가 목표 면적(법정 상한)을 넘지 않도록 내림 처리한다.
  return {
    width: Math.floor(width * 100) / 100,
    depth: Math.floor(depth * 100) / 100
  };
}

// 법적 최대 건축면적을 층별로 최대한 채워, 최대 연면적에 도달할 때까지 쌓는다.
// 마지막 층은 남은 면적만큼만 채워 연면적 상한을 정확히 맞춘다.
function generateMaxMassSpec(site) {
  const { maxBuildingArea, maxFloorArea } = computeDerived(site);
  const maxFloors = site.maxFloors || 999;
  const floorHeight = site.floorHeight || 3.3;

  const floors = [];
  let remainingArea = maxFloorArea;
  let level = 1;
  while (remainingArea > 0.01 && level <= maxFloors) {
    const footprintArea = Math.min(maxBuildingArea, remainingArea);
    const { width, depth } = footprintDims(footprintArea, site);
    const isTopPartial = footprintArea < maxBuildingArea - 0.01;
    floors.push({
      level,
      width,
      depth,
      height: floorHeight,
      offsetX: 0,
      offsetZ: 0,
      rotationDeg: 0,
      use: isTopPartial ? '상층부' : '기준층'
    });
    remainingArea -= footprintArea;
    level++;
  }

  return {
    site,
    derived: {
      maxBuildingArea: +maxBuildingArea.toFixed(2),
      maxFloorArea: +maxFloorArea.toFixed(2)
    },
    floors
  };
}

// level > 0: 지상층(1F, 2F, ...) / level < 0: 지하층(B1, B2, ...). level 0은 쓰지 않는다.
function floorLabel(level) {
  return level > 0 ? `${level}F` : `B${-level}`;
}

// ---- live metrics (매스 지오메트리에서 매번 다시 계산) ----
// 건폐율/용적률/최고높이/층수는 지상층 기준(용적률 산정 시 지하층 면적은 통상 제외되는 관례를 따름).
// 지하층은 별도로 basementCount로 집계하고, 층별 레이어 패널에는 지상/지하 모두 표시한다.
function computeValues(site, floors) {
  const above = floors.filter((f) => f.level > 0);
  const basement = floors.filter((f) => f.level < 0);
  const buildArea = above.length ? Math.max(...above.map((f) => f.width * f.depth)) : 0;
  const gfa = above.reduce((s, f) => s + f.width * f.depth, 0);
  const height = above.reduce((s, f) => s + f.height, 0);
  const siteArea = site.siteArea || 0;
  return {
    siteArea,
    buildArea,
    gfa,
    height,
    floorCount: above.length,
    basementCount: basement.length,
    bcr: siteArea ? (buildArea / siteArea) * 100 : 0,
    far: siteArea ? (gfa / siteArea) * 100 : 0
  };
}

const CELLS = [
  { key: 'siteArea', unit: 'm²', digits: 0 },
  { key: 'buildArea', unit: 'm²', digits: 0, limitKey: 'coverageArea' },
  { key: 'bcr', unit: '%', digits: 1, deltaUnit: '%p', limitKey: 'coverageRatio' },
  { key: 'gfa', unit: 'm²', digits: 0, limitKey: 'farArea' },
  { key: 'far', unit: '%', digits: 1, deltaUnit: '%p', limitKey: 'farRatio' },
  { key: 'height', unit: 'm', digits: 1 },
  { key: 'floorCount', unit: 'F', digits: 0, limitKey: 'maxFloors' }
];

function fmt(v, d) {
  return (v || 0).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

function renderTitleblock(showDelta) {
  const site = currentSpec.site;
  const values = computeValues(site, currentSpec.floors);
  const limits = {
    coverageArea: currentSpec.derived.maxBuildingArea,
    coverageRatio: site.coverageRatio,
    farArea: currentSpec.derived.maxFloorArea,
    farRatio: site.farRatio,
    maxFloors: site.maxFloors
  };

  CELLS.forEach((c) => {
    const valEl = titleblock.querySelector(`[data-v="${c.key}"]`);
    const deltaEl = titleblock.querySelector(`[data-d="${c.key}"]`);
    const v = values[c.key];
    const basementNote = c.key === 'floorCount' && values.basementCount ? ` <span class="sub">B${values.basementCount}</span>` : '';
    valEl.innerHTML = `${fmt(v, c.digits)}<u>${c.unit}</u>${basementNote}`;

    // 반올림된 폭/깊이로 매스를 생성하다 보면 법정 상한을 소수점 단위로 살짝 넘나들 수 있으므로
    // 실질적으로 의미 있는 초과분만 경고로 표시한다(면적 0.5㎡, 비율 0.1%p, 층수는 정수 그대로).
    const tolerance = c.key === 'floorCount' ? 0.5 : c.digits ? 0.1 : 0.5;
    const limit = c.limitKey != null ? limits[c.limitKey] : null;
    valEl.classList.toggle('over', limit != null && v > limit + tolerance);

    if (showDelta && prevValues) {
      const dv = v - prevValues[c.key];
      if (Math.abs(dv) > tolerance) {
        const unit = c.deltaUnit || c.unit;
        deltaEl.textContent = `${dv > 0 ? '+' : '−'}${fmt(Math.abs(dv), c.digits)}${unit}`;
        deltaEl.classList.add('on');
      } else {
        deltaEl.classList.remove('on');
      }
    } else {
      deltaEl.classList.remove('on');
    }
  });

  titleblock.querySelector('[data-v="rev"]').textContent = String(rev).padStart(2, '0');
  undoBtn.disabled = history.length === 0;
}

// ---- rendering ----
function renderSpec(spec, touchedLevels, showDelta) {
  massGroup.clear();
  if (siteOutline) scene.remove(siteOutline);

  const site = spec.site;
  let sw = site.siteWidth;
  let sd = site.siteDepth;
  if (!sw || !sd) {
    const s = Math.sqrt(site.siteArea);
    sw = s;
    sd = s;
  }
  const outlineGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(sw, 0.01, sd));
  siteOutline = new THREE.LineSegments(outlineGeo, new THREE.LineBasicMaterial({ color: 0x57c2d6 }));
  scene.add(siteOutline);

  if (groundGrid) scene.remove(groundGrid);
  groundGrid = new THREE.GridHelper(Math.max(sw, sd) * 2, 20, 0x20313a, 0x1a272e);
  scene.add(groundGrid);

  const flashEdges = [];
  const addFloorMesh = (f, centerY) => {
    const geo = new THREE.BoxGeometry(f.width, f.height, f.depth);
    const mat = new THREE.MeshStandardMaterial({ color: 0xede8dc, roughness: 0.85, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(f.offsetX || 0, centerY, f.offsetZ || 0);
    mesh.rotation.y = THREE.MathUtils.degToRad(f.rotationDeg || 0);
    massGroup.add(mesh);

    const touched = touchedLevels && touchedLevels.has(f.level);
    const edges = new THREE.EdgesGeometry(geo);
    const lineMat = new THREE.LineBasicMaterial({ color: touched ? 0xe2604a : 0x0b1014 });
    const line = new THREE.LineSegments(edges, lineMat);
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    massGroup.add(line);
    if (touched) flashEdges.push(lineMat);
  };

  // 지상층(level>0)은 지면(y=0)에서 위로, 지하층(level<0)은 지면에서 아래로 각각 쌓는다.
  const aboveFloors = spec.floors.filter((f) => f.level > 0).sort((a, b) => a.level - b.level);
  const basementFloors = spec.floors.filter((f) => f.level < 0).sort((a, b) => b.level - a.level); // B1(가장 얕음)부터

  let y = 0;
  aboveFloors.forEach((f) => {
    addFloorMesh(f, y + f.height / 2);
    y += f.height;
  });
  const topY = y;

  let yTop = 0;
  basementFloors.forEach((f) => {
    const bottom = yTop - f.height;
    addFloorMesh(f, (yTop + bottom) / 2);
    yTop = bottom;
  });
  const bottomY = yTop;

  if (flashEdges.length) {
    setTimeout(() => flashEdges.forEach((m) => (m.color.set(0x0b1014))), 1500);
  }

  const footDiag = spec.floors.length
    ? Math.max(...spec.floors.map((f) => Math.hypot(f.width, f.depth)))
    : Math.hypot(sw, sd);
  const totalHeight = topY - bottomY;
  controls.target.set(0, (topY + bottomY) / 2, 0);
  viewRadius = Math.max(footDiag, totalHeight, 10) * 1.6 + 8;

  emptyState.hidden = spec.floors.length > 0;
  quickList.querySelectorAll('.quick-btn').forEach((b) => (b.disabled = false));

  renderLayerPanel(spec);
  renderTitleblock(!!showDelta);
}

// ---- 층별 레이어 패널 (3D 뷰 오른쪽, 위층→아래층→지하층 순) ----
function renderLayerPanel(spec) {
  const ordered = [
    ...spec.floors.filter((f) => f.level > 0).sort((a, b) => b.level - a.level),
    ...spec.floors.filter((f) => f.level < 0).sort((a, b) => b.level - a.level)
  ];

  if (!ordered.length) {
    layerPanel.innerHTML = '';
    return;
  }

  layerPanel.innerHTML = ordered
    .map(
      (f) => `
    <div class="layer-row${f.level < 0 ? ' basement' : ''}">
      <span class="layer-lv">${floorLabel(f.level)}</span>
      <span class="layer-dim">${fmt(f.width, 1)}×${fmt(f.depth, 1)}<u>m</u> · ${fmt(f.height, 1)}<u>m</u></span>
      ${f.use ? `<span class="layer-use">${escapeHtml(f.use)}</span>` : ''}
    </div>`
    )
    .join('');
}

generateBtn.addEventListener('click', () => {
  try {
    const site = JSON.parse(siteJsonInput.value);
    currentSpec = generateMaxMassSpec(site);
    rev = 0;
    history = [];
    prevValues = null;
    renderSpec(currentSpec);
    setView('bird');
    chatLog.innerHTML = '';
    appendMessage('system', '최대 규모 매스를 생성했습니다. 이제 자연어로 수정 요청을 해보세요.');
  } catch (e) {
    appendMessage('error', 'JSON 파싱 오류: ' + escapeHtml(e.message));
  }
});

generateBtn.click(); // 초기 로드시 첫 샘플로 자동 생성

// ---- chat log rendering ----
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// bodyHtml is trusted markup assembled by this module; plain text callers pass through escapeHtml first.
function appendMessage(kind, bodyHtml, who) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  const whoLabel = who || (kind === 'user' ? '나' : kind === 'assistant' ? 'AI' : kind === 'error' ? '오류' : '시스템');
  div.innerHTML = `<div class="who">${whoLabel}</div><div class="body">${bodyHtml}</div>`;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

function changeFloorCount(c) {
  return Math.abs((c.floorEnd ?? c.floorStart) - (c.floorStart ?? c.floorEnd)) + 1;
}

// add_floors/add_basement의 floorStart/floorEnd는 실제 층 번호가 아니라 "몇 개 추가하는지"를 나타내는
// 용도로만 쓰인다(레벨은 클라이언트가 재배정한다). 그 외 action은 실제 층 번호를 그대로 쓴다.
function floorRangeLabel(c) {
  if (c.action === 'add_floors' || c.action === 'add_basement') {
    return `+${changeFloorCount(c)}`;
  }
  return c.floorStart === c.floorEnd ? floorLabel(c.floorStart) : `${floorLabel(c.floorStart)}–${floorLabel(c.floorEnd)}`;
}

function describeChange(c, beforeFloor) {
  const b = beforeFloor || {};
  switch (c.action) {
    case 'resize':
      return `평면 ${fmt(b.width, 1)}×${fmt(b.depth, 1)} → ${fmt(c.width ?? b.width, 1)}×${fmt(c.depth ?? b.depth, 1)}m`;
    case 'move':
      return `위치 (${fmt(b.offsetX, 1)}, ${fmt(b.offsetZ, 1)}) → (${fmt(c.offsetX ?? b.offsetX, 1)}, ${fmt(c.offsetZ ?? b.offsetZ, 1)})`;
    case 'rotate':
      return `회전 ${fmt(b.rotationDeg, 0)}° → ${fmt(c.rotationDeg ?? b.rotationDeg, 0)}°`;
    case 'set_floor_height':
      return `층고 ${fmt(b.height, 1)} → ${fmt(c.height ?? b.height, 1)}m`;
    case 'set_use':
      return `용도 → ${escapeHtml(c.use || '')}`;
    case 'add_floors':
      return `지상층 ${changeFloorCount(c)}개 추가`;
    case 'add_basement':
      return `지하층 ${changeFloorCount(c)}개 추가`;
    case 'delete_floors':
      return `${floorLabel(c.floorStart)}–${floorLabel(c.floorEnd)} 삭제`;
    default:
      return c.action;
  }
}

function renderChangeRows(changes, beforeFloors) {
  if (!changes.length) return '';
  const refersToExisting = (c) => c.action !== 'add_floors' && c.action !== 'add_basement';
  const rows = changes
    .map((c) => {
      const before = refersToExisting(c) ? beforeFloors.find((f) => f.level === c.floorStart) : null;
      return `<div class="change-row">
        <div class="key">${floorRangeLabel(c)}</div>
        <div class="what">${describeChange(c, before)}</div>
        <div class="why">${escapeHtml(c.reason || '')}</div>
      </div>`;
    })
    .join('');
  return `<div class="changes">${rows}</div>`;
}

// ---- diff 적용: LLM은 변경 명령만 내고, 언급되지 않은 층은 그대로 유지 ----
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function isNoop(c, floors) {
  if (c.action === 'add_floors' || c.action === 'add_basement' || c.action === 'delete_floors') return false;
  const targets = floors.filter((f) => f.level >= c.floorStart && f.level <= c.floorEnd);
  if (!targets.length) return true;
  const same = (v, cur) => v == null || Math.abs(v - cur) < 0.05;
  return targets.every(
    (f) =>
      same(c.width, f.width) &&
      same(c.depth, f.depth) &&
      same(c.height, f.height) &&
      same(c.offsetX, f.offsetX) &&
      same(c.offsetZ, f.offsetZ) &&
      (c.rotationDeg == null || Math.abs(c.rotationDeg - (f.rotationDeg || 0)) < 0.5) &&
      (c.use == null || c.use === f.use)
  );
}

function applyChanges(floors, changes) {
  let next = floors.map((f) => ({ ...f }));
  const touched = new Set(); // 층 객체(참조) 기준으로 모았다가, 재번호 이후에 실제 level로 변환한다.

  changes.forEach((c) => {
    if (c.action === 'delete_floors') {
      next = next.filter((f) => f.level < c.floorStart || f.level > c.floorEnd);
      return;
    }

    if (c.action === 'add_floors' || c.action === 'add_basement') {
      const isBasement = c.action === 'add_basement';
      const count = Math.min(changeFloorCount(c), 40);
      const pool = next.filter((f) => (isBasement ? f.level < 0 : f.level > 0));
      const template = pool[pool.length - 1] || pool[0] || {
        width: 10,
        depth: 10,
        height: isBasement ? 3.0 : 3.3,
        offsetX: 0,
        offsetZ: 0,
        rotationDeg: 0,
        use: isBasement ? '지하' : ''
      };
      // floorStart/floorEnd는 "몇 개 추가하는지"만 나타낸다. 실제 번호는 현재 최상단/최하단
      // 바로 다음부터 이어 붙여, 지상층은 위로 지하층은 아래로 정확히 쌓이도록 한다.
      const startLevel = isBasement
        ? Math.min(0, ...next.filter((f) => f.level < 0).map((f) => f.level)) - 1
        : Math.max(0, ...next.filter((f) => f.level > 0).map((f) => f.level)) + 1;

      for (let i = 0; i < count; i++) {
        const level = isBasement ? startLevel - i : startLevel + i;
        const floor = {
          level,
          width: clamp(c.width ?? template.width, 3, 300),
          depth: clamp(c.depth ?? template.depth, 3, 300),
          height: clamp(c.height ?? template.height, 2, 14),
          offsetX: clamp(c.offsetX ?? template.offsetX, -150, 150),
          offsetZ: clamp(c.offsetZ ?? template.offsetZ, -150, 150),
          rotationDeg: c.rotationDeg ?? template.rotationDeg ?? 0,
          use: c.use ?? template.use ?? (isBasement ? '지하' : '')
        };
        next.push(floor);
        touched.add(floor);
      }
      return;
    }

    next = next.map((f) => {
      if (f.level < c.floorStart || f.level > c.floorEnd) return f;
      const updated = {
        ...f,
        width: c.width != null ? clamp(c.width, 3, 300) : f.width,
        depth: c.depth != null ? clamp(c.depth, 3, 300) : f.depth,
        height: c.height != null ? clamp(c.height, 2, 14) : f.height,
        offsetX: c.offsetX != null ? clamp(c.offsetX, -150, 150) : f.offsetX,
        offsetZ: c.offsetZ != null ? clamp(c.offsetZ, -150, 150) : f.offsetZ,
        rotationDeg: c.rotationDeg != null ? c.rotationDeg : f.rotationDeg,
        use: c.use != null ? c.use : f.use
      };
      touched.add(updated);
      return updated;
    });
  });

  // 재번호: 지상층은 1..N(아래→위), 지하층은 -1..-M(지면과 가까운 순서부터 깊이 순)
  const above = next.filter((f) => f.level > 0).sort((a, b) => a.level - b.level);
  const basement = next.filter((f) => f.level < 0).sort((a, b) => b.level - a.level);
  above.forEach((f, i) => (f.level = i + 1));
  basement.forEach((f, i) => (f.level = -(i + 1)));

  const renumberedTouched = new Set([...touched].map((f) => f.level));
  return { floors: [...above, ...basement], touched: renumberedTouched };
}

// ---- LLM 호출 ----
async function requestMassEdit(instruction) {
  if (!currentSpec) throw new Error('먼저 매스를 생성하세요.');

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentSpec,
      instruction,
      model: modelInput.value.trim(),
      provider: providerSelect.value
    })
  });

  const data = await res.json();
  const debug = data._debug;
  logConsole({
    ok: res.ok,
    status: res.status,
    provider: debug?.provider || providerSelect.value,
    model: debug?.model || modelInput.value.trim(),
    request: debug?.request,
    response: debug?.response
  });
  if (!res.ok) throw new Error(data.error || `API 오류 (${res.status})`);
  return data;
}

composerForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const instruction = chatInput.value.trim();
  if (!instruction) return;
  chatInput.value = '';
  sendChat(instruction);
});
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    composerForm.requestSubmit();
  }
});

undoBtn.addEventListener('click', () => {
  const snap = history.pop();
  if (!snap) return;
  prevValues = computeValues(currentSpec.site, currentSpec.floors);
  currentSpec = { ...currentSpec, floors: snap.floors };
  rev = snap.rev;
  renderSpec(currentSpec, null, true);
  appendMessage('system', escapeHtml(`REV ${String(rev).padStart(2, '0')} 상태로 되돌렸습니다.`));
});

async function sendChat(instructionArg) {
  const instruction = instructionArg ?? chatInput.value.trim();
  if (!instruction || !currentSpec) return;
  appendMessage('user', escapeHtml(instruction));
  chatSendBtn.disabled = true;
  const pending = appendMessage('system', '매스 조정 중...');
  try {
    const result = await requestMassEdit(instruction);
    pending.remove();

    const changes = (result.changes || []).filter((c) => !isNoop(c, currentSpec.floors));
    if (!changes.length) {
      appendMessage('assistant', escapeHtml(result.interpretation || '변경할 내용이 없어 그대로 유지했습니다.'));
      return;
    }

    const beforeFloors = currentSpec.floors.map((f) => ({ ...f }));
    history.push({ floors: beforeFloors, rev });
    prevValues = computeValues(currentSpec.site, currentSpec.floors);

    const { floors: nextFloors, touched } = applyChanges(currentSpec.floors, changes);
    currentSpec = { ...currentSpec, floors: nextFloors };
    rev += 1;

    renderSpec(currentSpec, touched, true);

    const html =
      `<strong>${escapeHtml(result.interpretation || '')}</strong>` +
      renderChangeRows(changes, beforeFloors) +
      `<p style="margin:6px 0 0">${escapeHtml(result.explanation || '')}</p>`;
    appendMessage('assistant', html, `AI · REV ${String(rev).padStart(2, '0')}`);
  } catch (e) {
    pending.remove();
    appendMessage('error', escapeHtml(e.message));
  } finally {
    chatSendBtn.disabled = false;
  }
}
