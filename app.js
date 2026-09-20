import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SAMPLES } from './samples.js';
import { searchLand, loadParcel, cadastralMapUrl, ringToLocal, polygonArea, centroid, bbox as ringBBox, minAreaRect, toLocal } from './land.js';
import {
  buildPolygonFloors, polyArea, polyBBox, polyCentroid, scalePoly, translatePoly, rotatePoly,
  setbackAt, SUNLIGHT_BASE
} from './mass-poly.js';

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
const chatCollapse = el('chatCollapse');
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
const siteError = el('siteError');
const compareBtn = el('compareBtn');
const compareOverlay = el('compareOverlay');
const compareGrid = el('compareGrid');
const compareSite = el('compareSite');
const compareClose = el('compareClose');
const compareAsk = el('compareAsk');
const compareInput = el('compareInput');
const compareRun = el('compareRun');
const compareRules = el('compareRules');
const mmEmpty = el('mmEmpty');
const previewPanel = el('previewPanel');
const previewFloors = el('previewFloors');
const previewTotals = el('previewTotals');
const previewApply = el('previewApply');
const previewCancel = el('previewCancel');
const previewWarnings = el('previewWarnings');
const previewTitle = el('previewTitle');
const floorEditor = el('floorEditor');
const feTitle = el('feTitle');
const feArea = el('feArea');
const feError = el('feError');
const feWarn = el('feWarn');
const feClose = el('feClose');
const dragLabel = el('dragLabel');
const editHint = el('editHint');
const FE_FIELDS = ['width', 'depth', 'height', 'offsetX', 'offsetZ'];
const landQuery = el('landQuery');
const landSearchBtn = el('landSearchBtn');
const landResults = el('landResults');
const landInfo = el('landInfo');
const landSources = el('landSources');
const landApplyBtn = el('landApplyBtn');
const minimap = el('minimap');
const mmImage = el('mmImage');
const mmOverlay = el('mmOverlay');
const mmFail = el('mmFail');
const mmCaption = el('mmCaption');
const mmToggle = el('mmToggle');
const mmTitle = el('mmTitle');
const neighborsBtn = el('neighborsBtn');

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

// ---- API 키 직접 입력 ----
// 서버 .env 키를 먼저 쓰고, 없거나 인증에 실패하면 여기 입력한 키로 다시 시도한다(재시도는 서버가 한다).
// 키는 sessionStorage에만 두므로 이 탭에서만 유지되고 탭을 닫으면 사라진다. 화면에는 항상 가려서 표시한다.
const KEY_STORAGE = 'mass_stacker_keys_v1';
const KEY_KINDS = {
  gemini: { label: 'Gemini', hint: 'Google AI Studio' },
  anthropic: { label: 'Claude', hint: 'Anthropic Console' },
  vworld: { label: 'VWorld', hint: 'VWorld 인증키' },
  datagokr: { label: '공공데이터포털', hint: '서비스 키' }
};
let userKeys = {};
let envKeys = {};

function loadUserKeys() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY_STORAGE));
    return saved && typeof saved === 'object' ? saved : {};
  } catch (e) {
    return {};
  }
}

function saveUserKeys() {
  try {
    sessionStorage.setItem(KEY_STORAGE, JSON.stringify(userKeys));
  } catch (e) {
    console.warn('키 저장 실패(이 탭에서만 유지됩니다):', e);
  }
}

// 앞 4글자와 뒤 3글자만 남기고 가린다.
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 10) return '•'.repeat(k.length);
  return `${k.slice(0, 4)}${'•'.repeat(8)}${k.slice(-3)}`;
}

function keyRow(kind) {
  return document.querySelector(`.key-row[data-key="${kind}"]`);
}

function renderKeyRow(kind, status) {
  const row = keyRow(kind);
  if (!row) return;
  const envBadge = row.querySelector('[data-env]');
  envBadge.textContent = envKeys[kind] ? '.env 있음' : '.env 없음';
  envBadge.classList.toggle('on', !!envKeys[kind]);

  const state = row.querySelector('[data-state]');
  state.className = 'key-state';
  if (status) {
    state.classList.add(status.ok ? 'ok' : 'bad');
    state.innerHTML =
      escapeHtml(status.message) +
      (status.detail ? `<details class="key-detail"><summary>응답 원문 보기</summary>${escapeHtml(status.detail)}</details>` : '');
    return;
  }
  if (userKeys[kind]) {
    state.innerHTML =
      `입력한 키 <span class="masked">${escapeHtml(maskKey(userKeys[kind]))}</span> 저장됨 (이 탭에서만)` +
      '<button type="button" data-act="test">연결 확인</button><button type="button" data-act="clear">지우기</button>';
  } else {
    state.textContent = envKeys[kind]
      ? '.env 키를 씁니다. 인증에 실패하면 여기 입력한 키로 다시 시도합니다.'
      : '.env 키가 없습니다. 키를 입력해 주세요.';
  }
}

function renderKeyRows() {
  Object.keys(KEY_KINDS).forEach((kind) => renderKeyRow(kind));
}

async function testUserKey(kind) {
  const key = userKeys[kind];
  if (!key) return;
  renderKeyRow(kind, { ok: true, message: '확인 중...' });
  try {
    const r = await fetch('/api/keys/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: kind, key })
    });
    const data = await r.json();
    renderKeyRow(kind, {
      ok: !!data.ok,
      message: data.message || (data.ok ? '확인되었습니다.' : '확인 실패'),
      detail: data.detail
    });
  } catch (e) {
    renderKeyRow(kind, { ok: false, message: `확인 중 오류: ${e.message}` });
  }
  setTimeout(() => renderKeyRow(kind), 20000);
}

document.getElementById('keyBox').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const row = btn.closest('.key-row');
  const kind = row.dataset.key;
  const input = row.querySelector('input');
  if (btn.dataset.act === 'save') {
    const v = input.value.trim();
    if (!v) {
      renderKeyRow(kind, { ok: false, message: '키를 입력한 뒤 저장을 눌러 주세요.' });
      return;
    }
    userKeys[kind] = v;
    input.value = '';
    saveUserKeys();
    renderKeyRow(kind);
  } else if (btn.dataset.act === 'clear') {
    delete userKeys[kind];
    saveUserKeys();
    renderKeyRow(kind);
  } else if (btn.dataset.act === 'test') {
    testUserKey(kind);
  }
});

document.querySelectorAll('.key-row input').forEach((input) => {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    input.closest('.key-row').querySelector('[data-act="save"]').click();
  });
});

userKeys = loadUserKeys();
renderKeyRows();
fetch('/api/keys/status')
  .then((r) => r.json())
  .then((data) => {
    envKeys = data || {};
    renderKeyRows();
  })
  .catch(() => renderKeyRows());

// ---- 대지 조건 입력: 예시 선택 + 숫자 입력칸(폼) + 고급 JSON (셋은 항상 같은 값으로 동기화) ----
const siteCard = el('siteCard');
const siteDerived = el('siteDerived');
const SITE_FIELDS = ['siteArea', 'coverageRatio', 'farRatio', 'maxFloors', 'maxHeight', 'floorHeight', 'setback'];
const sunRow = el('sunRow');
const sunNote = el('sunNote');
const fieldInput = (key) => el(`f_${key}`);
let siteExtras = {}; // 폼에 없는 값(name, zoning, address, siteWidth, siteDepth 등)은 그대로 보존한다
let realSites = []; // real-site-examples.json에서 불러온 실제 대지 예시

// 층고는 자료에 없으므로 용도별 일반적인 값을 가정한다(화면에서 고칠 수 있음).
const DEFAULT_FLOOR_HEIGHT = { 주거: 3.0, 업무: 4.0, 상업: 4.5 };

function realSiteToSite(ex) {
  const est = ex.new_building_estimate || {};
  const site = {
    name: ex.name,
    address: ex.address,
    zoning: ex.zoning,
    siteArea: ex.site_area,
    coverageRatio: ex.building_coverage_ratio ?? est.assumed_building_coverage_ratio,
    farRatio: ex.floor_area_ratio ?? est.assumed_floor_area_ratio,
    floorHeight: DEFAULT_FLOOR_HEIGHT[ex.usage_category] ?? 3.3
  };
  const floors = ex.floors?.above_ground ?? est.max_floors;
  const height = ex.building_height ?? est.max_building_height;
  if (floors != null) site.maxFloors = floors;
  if (height != null) site.maxHeight = height;
  return site;
}

function readForm() {
  const site = { ...siteExtras };
  SITE_FIELDS.forEach((key) => {
    const raw = fieldInput(key).value.trim();
    if (raw === '') delete site[key];
    else site[key] = Number(raw);
  });
  site.sunRule = currentSunRule;
  return site;
}

// 정북 일조 기준: 'after' 10m(2023년 개정) / 'before' 9m / 'off' 적용 안 함
let currentSunRule = 'after';
function setSunRuleButtons(rule) {
  currentSunRule = rule;
  sunRow.querySelectorAll('.sun-btn').forEach((b) => b.classList.toggle('on', b.dataset.sun === rule));
}

function setSunRule(rule, { regenerate = false } = {}) {
  currentSunRule = rule;
  sunRow.querySelectorAll('.sun-btn').forEach((b) => b.classList.toggle('on', b.dataset.sun === rule));
  sunNote.textContent =
    rule === 'off'
      ? '일조 사선을 적용하지 않습니다(참고용).'
      : `정북 인접대지경계선에서 높이 ${SUNLIGHT_BASE[rule]}m 이하는 1.5m, 초과분은 그 높이의 1/2 이상 이격합니다.`;
  const site = readForm();
  siteJsonInput.value = JSON.stringify(site, null, 2);
  updateSiteSummary(site);
  if (regenerate && !generateBtn.disabled && currentSpec?.site?.boundary?.length) generateBtn.click();
}

sunRow.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sun]');
  if (btn) setSunRule(btn.dataset.sun, { regenerate: true });
});
setSunRuleButtons('after');
sunNote.textContent = `정북 인접대지경계선에서 높이 ${SUNLIGHT_BASE.after}m 이하는 1.5m, 초과분은 그 높이의 1/2 이상 이격합니다.`;

function fillForm(site) {
  siteExtras = {};
  Object.keys(site).forEach((k) => {
    if (!SITE_FIELDS.includes(k)) siteExtras[k] = site[k];
  });
  if (site.sunRule) setSunRuleButtons(site.sunRule);
  SITE_FIELDS.forEach((key) => {
    fieldInput(key).value = isSet(site[key]) ? site[key] : '';
  });
}

// 폼·JSON·요약·실제 대지 카드를 한 번에 맞춘다.
function setSiteInputs(site) {
  fillForm(site);
  syncSampleSelect(site);
  siteJsonInput.value = JSON.stringify(site, null, 2);
  updateSiteSummary(site);
}

// 입력값으로 생성하면 어떤 매스가 되는지 미리 계산해 보여준다(아직 매스에 반영하지 않음).
function updateSiteSummary(site) {
  const errors = validateSite(site);
  if (errors.length) {
    siteDerived.textContent = '입력값을 확인해 주세요.';
    siteDerived.classList.add('bad');
  } else {
    const spec = generateMaxMassSpec(site);
    const v = computeValues(site, spec.floors);
    const used = spec.derived.maxFloorArea ? (v.gfa / spec.derived.maxFloorArea) * 100 : 0;
    siteDerived.classList.remove('bad');
    const bd = spec.derived.buildable;
    siteDerived.innerHTML =
      `최대 건축면적 <b>${fmt(spec.derived.maxBuildingArea, 1)}㎡</b> · 최대 연면적 <b>${fmt(spec.derived.maxFloorArea, 1)}㎡</b><br>` +
      (bd
        ? `경계에서 <b>${fmt(bd.setback, 1)}m</b> 이격 → 건축가능 <b>${fmt(bd.area, 1)}㎡</b> (${bd.limitedBy}에 걸림)<br>`
        : '') +
      `생성하면 약 <b>${v.floorCount}층</b> · 높이 <b>${fmt(v.height, 1)}m</b> · 연면적 <b>${fmt(v.gfa, 1)}㎡</b>` +
      (spec.derived.sunCutArea > 0.5 ? `<br>정북 일조 사선으로 <b>${fmt(spec.derived.sunCutArea, 1)}㎡</b>가 잘립니다.` : '') +
      (used < 99 ? `<br><span class="warn">이격·층수·높이·일조 조건 때문에 최대 연면적의 ${fmt(used, 0)}%만 쓸 수 있습니다.</span>` : '');
  }
  renderSiteCard(site);
}

function renderSiteCard(site) {
  const ex = site.name ? realSites.find((r) => r.name === site.name) : null;
  if (!ex) {
    siteCard.hidden = true;
    siteCard.innerHTML = '';
    return;
  }
  const est = ex.new_building_estimate || {};
  const assumedRatios = ex.building_coverage_ratio == null || ex.floor_area_ratio == null;
  const notes = [
    assumedRatios ? `건폐율·용적률(${est.assumed_building_coverage_ratio}% · ${est.assumed_floor_area_ratio}%)은 용도지역 기본값을 가정한 값입니다. 인허가로 확인된 값이 아닙니다.` : null,
    site.maxFloors == null && site.maxHeight == null ? '층수·높이 제한은 자료에 없어 비워 두었습니다(제한 없음). 알고 있으면 입력하세요.' : null,
    `층고는 자료에 없어 ${ex.usage_category || '일반'} 용도의 일반값(${DEFAULT_FLOOR_HEIGHT[ex.usage_category] ?? 3.3}m)으로 가정했습니다.`,
    ex.site_area_basis ? `대지면적 기준: ${ex.site_area_basis}` : null
  ].filter(Boolean);
  siteCard.innerHTML = `
    <div class="sc-name">${escapeHtml(ex.name)}</div>
    <div class="sc-addr">${escapeHtml(ex.address || '')}</div>
    <dl class="sc-meta">
      <dt>용도지역</dt><dd>${escapeHtml(ex.zoning || '미확인')}</dd>
      <dt>현재 이용</dt><dd>${escapeHtml(ex.observed_land_use || '미확인')}</dd>
    </dl>
    <ul class="sc-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    ${est.unverified_constraints?.length ? `<details class="sc-more"><summary>확인되지 않은 규제 ${est.unverified_constraints.length}개</summary><ul>${est.unverified_constraints.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul></details>` : ''}`;
  siteCard.hidden = false;
}

function buildSampleOptions() {
  const current = sampleSelect.value;
  sampleSelect.innerHTML = '<option value="" disabled>예시를 고르세요</option>';
  const addGroup = (label, items, prefix) => {
    if (!items.length) return;
    const g = document.createElement('optgroup');
    g.label = label;
    items.forEach((name, i) => {
      const opt = document.createElement('option');
      opt.value = `${prefix}:${i}`;
      opt.textContent = name;
      g.appendChild(opt);
    });
    sampleSelect.appendChild(g);
  };
  addGroup('실제 대지 (real-site-examples.json)', realSites.map((r) => `${r.name} · ${r.zoning || ''}`), 'real');
  addGroup('연습용 예시', SAMPLES.map((s) => s.name), 'sample');
  sampleSelect.value = current || '';
}

// 현재 대지 조건이 어떤 예시에서 왔는지 드롭다운에 표시한다(실제 대지는 이름으로, 연습용은 값으로 비교).
function syncSampleSelect(site) {
  const realIdx = site.name ? realSites.findIndex((r) => r.name === site.name) : -1;
  const sampleIdx = SAMPLES.findIndex((s) => Object.keys(s.data).every((k) => s.data[k] === site[k]));
  sampleSelect.value = realIdx >= 0 ? `real:${realIdx}` : !site.name && sampleIdx >= 0 ? `sample:${sampleIdx}` : '';
}

function exampleSite(value) {
  const [kind, idx] = value.split(':');
  if (kind === 'real') return realSiteToSite(realSites[Number(idx)]);
  if (kind === 'sample') return { ...SAMPLES[Number(idx)].data };
  return null;
}

buildSampleOptions();
fetch('real-site-examples.json')
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
  .then((data) => {
    realSites = Array.isArray(data.examples) ? data.examples.filter((ex) => ex && ex.name && ex.site_area) : [];
    buildSampleOptions();
    const site = readForm();
    syncSampleSelect(site);
    updateSiteSummary(site); // 복원된 설계가 실제 대지면 카드를 띄운다
  })
  .catch((e) => console.warn('실제 대지 예시를 불러오지 못했습니다:', e));

// 예시를 고르면 입력칸을 채우고 바로 매스에 반영한다(이전 설계는 되돌리기로 복원 가능).
sampleSelect.addEventListener('change', () => {
  const site = exampleSite(sampleSelect.value);
  if (!site) return;
  setSiteInputs(site);
  generateBtn.click();
});

SITE_FIELDS.forEach((key) => {
  const input = fieldInput(key);
  input.addEventListener('input', () => {
    const site = readForm();
    siteJsonInput.value = JSON.stringify(site, null, 2);
    clearSiteErrors();
    updateSiteSummary(site);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !generateBtn.disabled) generateBtn.click();
  });
});

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

// 창 크기뿐 아니라 레이아웃 변화로 뷰포트 크기가 바뀌어도 캔버스를 맞춘다.
new ResizeObserver(() => {
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
}).observe(viewport);

let compareViews = []; // 대안 비교 창이 열려 있는 동안만 채워진다

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  compareViews.forEach((v) => {
    v.controls.update();
    v.renderer.render(v.scene, v.camera);
  });
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
let history = []; // 되돌리기용 스냅샷: { spec, rev } — 대지 정보까지 통째로 저장해 재생성도 되돌릴 수 있다
let prevValues = null;
let chatEntries = []; // 새로고침 후 복원할 채팅 로그: { kind, html, who }
let pendingProposal = null; // 검토 중인 AI 수정안(적용 전): { floors, touched, diff, interpretation, instructions, warnings }
let busy = false; // LLM 응답 대기 중
let selectedLevel = null; // 직접 편집 중인 층 번호
let faceEditLevel = null; // 더블클릭으로 "면 수정"을 켠 층
let gizmoGroup = null; // 이동 화살표(검볼) — 처음 쓸 때 만든다
let landData = null; // 조회한 대지 자료: { lon, lat, parcel, land, zoneRatios, buildings, neighbors, sources, boundaryLocal }
let neighborGroup = null; // 주변 건물 매스(선택 대상이 아니라 massGroup과 따로 둔다)
let showNeighbors = true;

const SOURCE_LABEL = {
  parcel: '필지 경계 (VWorld 연속지적)',
  land: '용도지역·지목 (VWorld 토지특성)',
  building: '기존 건물 (공공데이터포털 건축물대장)',
  neighbors: '주변 건물 (VWorld 건물통합정보)',
  cadastral: '지적도 미니맵 (VWorld WMS)'
};

// ---- 건물 정보 검증: 잘못된 값이면 이유 목록을 돌려주고, 호출자는 기존 설계를 그대로 둔다 ----
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isSet = (v) => v !== undefined && v !== null;

function checkNumber(site, key, label, { required, min, max, minExclusive, integer, unit = '' }, errors) {
  const v = site[key];
  if (!isSet(v)) {
    if (required) errors.push(`${key}(${label}) 값이 없습니다.`);
    return;
  }
  if (!isNum(v)) {
    errors.push(`${key}(${label})는 숫자여야 합니다. (입력값: ${JSON.stringify(v)})`);
    return;
  }
  if (integer && !Number.isInteger(v)) {
    errors.push(`${key}(${label})는 정수여야 합니다. (입력값: ${v})`);
  } else if (minExclusive ? v <= min : v < min) {
    errors.push(`${key}(${label})는 ${min}${unit}${minExclusive ? '보다 커야' : ' 이상이어야'} 합니다. (입력값: ${v}${unit})`);
  } else if (v > max) {
    errors.push(`${key}(${label})는 ${max.toLocaleString('ko-KR')}${unit} 이하여야 합니다. (입력값: ${v}${unit})`);
  }
}

function validateSite(site) {
  if (!site || typeof site !== 'object' || Array.isArray(site)) {
    return ['건물 정보는 { } 형태의 JSON 객체여야 합니다.'];
  }
  const errors = [];
  checkNumber(site, 'siteArea', '대지면적', { required: true, min: 0, minExclusive: true, max: 1000000, unit: '㎡' }, errors);
  checkNumber(site, 'coverageRatio', '건폐율', { required: true, min: 0, minExclusive: true, max: 100, unit: '%' }, errors);
  checkNumber(site, 'farRatio', '용적률', { required: true, min: 0, minExclusive: true, max: 1500, unit: '%' }, errors);
  // 층수는 앱이 따로 상한을 두지 않는다. 사용자가 넣은 값만 지킨다(비우면 제한 없음).
  checkNumber(site, 'maxFloors', '최대 층수', { min: 1, max: Infinity, integer: true, unit: '층' }, errors);
  checkNumber(site, 'floorHeight', '층고', { min: 2, max: 14, unit: 'm' }, errors);
  checkNumber(site, 'maxHeight', '최고 높이 제한', { min: 2, max: 1000, unit: 'm' }, errors);
  checkNumber(site, 'setback', '경계 이격', { min: 0, max: 20, unit: 'm' }, errors);
  if (isNum(site.maxHeight) && site.maxHeight < (isNum(site.floorHeight) ? site.floorHeight : 3.3)) {
    errors.push(`maxHeight(최고 높이 제한 ${site.maxHeight}m)가 층고(${isNum(site.floorHeight) ? site.floorHeight : 3.3}m)보다 낮아 한 층도 지을 수 없습니다.`);
  }
  checkNumber(site, 'siteWidth', '대지 가로', { min: 0, minExclusive: true, max: 1000, unit: 'm' }, errors);
  checkNumber(site, 'siteDepth', '대지 세로', { min: 0, minExclusive: true, max: 1000, unit: 'm' }, errors);

  const hasW = isSet(site.siteWidth);
  const hasD = isSet(site.siteDepth);
  if (hasW !== hasD) {
    errors.push('siteWidth(대지 가로)와 siteDepth(대지 세로)는 함께 입력하거나 둘 다 비워야 합니다.');
  } else if (!errors.length && hasW) {
    // 가로×세로는 대지 외곽선으로 그려지므로 대지면적과 크게 어긋나면 매스와 대지가 맞지 않는다.
    const rectArea = site.siteWidth * site.siteDepth;
    if (Math.abs(rectArea - site.siteArea) / site.siteArea > 0.05) {
      errors.push(
        `대지 가로×세로(${fmt(rectArea, 1)}㎡)가 대지면적(${fmt(site.siteArea, 1)}㎡)과 5% 넘게 다릅니다. 둘 중 하나를 고쳐 주세요.`
      );
    }
  }
  return errors;
}

function showSiteErrors(errors) {
  siteError.innerHTML =
    '입력한 건물 정보를 적용하지 않았습니다. 기존 설계를 유지합니다.' +
    `<ul>${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  siteError.hidden = false;
  siteJsonInput.classList.add('invalid');
  // 오류 문구가 "siteArea(대지면적)..."처럼 항목 이름으로 시작하므로, 해당 입력칸에 빨간 테두리를 친다.
  SITE_FIELDS.forEach((key) => {
    fieldInput(key).classList.toggle('invalid', errors.some((e) => e.startsWith(key + '(') || e.startsWith(key + ' ')));
  });
  if (errors.some((e) => e.startsWith('siteWidth') || e.startsWith('대지 가로') || e.startsWith('JSON'))) {
    siteJsonInput.closest('details').open = true;
  }
  appendMessage(
    'error',
    '입력한 건물 정보를 적용하지 않고 기존 설계를 유지했습니다.<br>' + errors.map((e) => '· ' + escapeHtml(e)).join('<br>')
  );
  if (currentSpec) saveDesign();
}

function clearSiteErrors() {
  siteError.hidden = true;
  siteError.innerHTML = '';
  siteJsonInput.classList.remove('invalid');
  SITE_FIELDS.forEach((key) => fieldInput(key).classList.remove('invalid'));
}

// 고급 JSON을 고치면 문법이 맞을 때마다 입력칸에도 반영한다.
siteJsonInput.addEventListener('input', () => {
  clearSiteErrors();
  try {
    const site = JSON.parse(siteJsonInput.value);
    if (site && typeof site === 'object' && !Array.isArray(site)) {
      fillForm(site);
      updateSiteSummary(site);
    }
  } catch (e) {
    siteDerived.textContent = 'JSON 문법을 확인해 주세요.';
    siteDerived.classList.add('bad');
  }
});

// ---- 설계 저장/복원 (브라우저 localStorage) ----
const STORAGE_KEY = 'mass_stacker_design_v1';
const MAX_HISTORY = 50;
const MAX_CHAT = 200;

const cloneSpec = (spec) => JSON.parse(JSON.stringify(spec));

function isValidFloor(f) {
  if (!f || !Number.isInteger(f.level) || f.level === 0 || !isNum(f.height) || f.height <= 0) return false;
  // 다각형 층(shape)은 좌표 목록이, 사각형 층은 폭·깊이가 있어야 한다.
  if (Array.isArray(f.shape)) {
    return f.shape.length >= 3 && f.shape.every((p) => Array.isArray(p) && p.length === 2 && p.every(isNum));
  }
  return isNum(f.width) && f.width > 0 && isNum(f.depth) && f.depth > 0;
}

function isValidSpec(spec) {
  return (
    spec && validateSite(spec.site).length === 0 &&
    spec.derived && Array.isArray(spec.floors) && spec.floors.every(isValidFloor)
  );
}

function saveDesign() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        spec: currentSpec,
        rev,
        history: history.slice(-MAX_HISTORY),
        chat: chatEntries.slice(-MAX_CHAT),
        land: landData, // 조회한 대지 자료(경계·주변 건물·자료 상태)도 함께 남겨 새로고침 후 복원
        // 검토 중인 수정안(아직 적용 전) — 새로고침 후 미리보기로 복원한다
        pending: pendingProposal
          ? {
              floors: pendingProposal.floors,
              touched: [...pendingProposal.touched],
              diff: pendingProposal.diff,
              interpretation: pendingProposal.interpretation,
              instructions: pendingProposal.instructions
            }
          : null
      })
    );
  } catch (e) {
    console.warn('설계 저장 실패:', e);
  }
}

function loadDesign() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !isValidSpec(saved.spec)) return null;
    return {
      spec: saved.spec,
      rev: Number.isInteger(saved.rev) ? saved.rev : 0,
      history: Array.isArray(saved.history) ? saved.history.filter((h) => h && isValidSpec(h.spec)) : [],
      chat: Array.isArray(saved.chat) ? saved.chat.filter((m) => m && typeof m.html === 'string') : [],
      pending: restorePending(saved.pending),
      land: saved.land && saved.land.parcel ? saved.land : null
    };
  } catch (e) {
    return null;
  }
}

function restorePending(p) {
  if (
    !p || !Array.isArray(p.floors) || !p.floors.length || !p.floors.every(isValidFloor) ||
    !Array.isArray(p.instructions) || !p.instructions.length || !Array.isArray(p.diff)
  ) {
    return null;
  }
  return {
    floors: p.floors,
    touched: new Set(Array.isArray(p.touched) ? p.touched : []),
    diff: p.diff,
    interpretation: String(p.interpretation || ''),
    instructions: p.instructions.map(String)
  };
}

function snapshot() {
  return { spec: cloneSpec(currentSpec), rev };
}

function computeDerived(site) {
  const maxBuildingArea = site.siteArea * (site.coverageRatio / 100);
  const maxFloorArea = site.siteArea * (site.farRatio / 100);
  return { maxBuildingArea, maxFloorArea };
}

// 실제 필지에서는 경계를 감싸는 최소 직사각형을 기준으로 매스를 앉힌다(각도·중심·비율).
const frameCache = new WeakMap();
function siteFrame(site) {
  if (!site.boundary?.length) return null;
  if (!frameCache.has(site)) frameCache.set(site, minAreaRect(site.boundary));
  return frameCache.get(site);
}

// 필지 좌표계(직사각형 기준)로 만든 층들을 실제 위치·각도로 옮긴다.
// three.js에서 rotation.y = a 인 층의 로컬 +X는 월드 (cos a, −sin a) 방향이므로, 경계 각도 θ에 맞추려면 a = −θ.
function placeFloorsOnSite(floors, site) {
  const frame = siteFrame(site);
  if (!frame) return floors;
  const a = (-frame.angleDeg * Math.PI) / 180;
  const [cx, cz] = frame.center;
  return floors.map((f) => {
    const u = f.offsetX || 0;
    const v = f.offsetZ || 0;
    return {
      ...f,
      offsetX: +(cx + u * Math.cos(a) + v * Math.sin(a)).toFixed(2),
      offsetZ: +(cz - u * Math.sin(a) + v * Math.cos(a)).toFixed(2),
      rotationDeg: +(-frame.angleDeg).toFixed(2)
    };
  });
}

function footprintDims(area, site) {
  let ratio = 1; // width / depth
  const frame = siteFrame(site);
  if (frame && frame.depth > 0) ratio = frame.width / frame.depth;
  else if (site.siteWidth && site.siteDepth) ratio = site.siteWidth / site.siteDepth;
  const depth = Math.sqrt(area / ratio);
  const width = area / depth;
  // 소수점 반올림으로 폭×깊이가 목표 면적(법정 상한)을 넘지 않도록 내림 처리한다.
  return {
    width: Math.floor(width * 100) / 100,
    depth: Math.floor(depth * 100) / 100
  };
}

// 쌓을 수 있는 지상 층수: 사용자가 넣은 maxFloors와 maxHeight(÷ 층고) 중 작은 값. 둘 다 없으면 제한 없음
// (그래도 연면적 상한에서 멈추므로 층수가 무한히 늘지는 않는다).
function floorCap(site) {
  const byFloors = site.maxFloors || Infinity;
  const byHeight = site.maxHeight ? Math.floor(site.maxHeight / (site.floorHeight || 3.3) + 1e-9) : Infinity;
  return Math.max(1, Math.min(byFloors, byHeight));
}

// 법적 최대 건축면적을 층별로 최대한 채워, 최대 연면적에 도달할 때까지 쌓는다.
// 마지막 층은 남은 면적만큼만 채워 연면적 상한을 정확히 맞춘다.
function generateMaxMassSpec(site) {
  const { maxBuildingArea, maxFloorArea } = computeDerived(site);
  const maxFloors = floorCap(site);
  const floorHeight = site.floorHeight || 3.3;

  // 실제 필지 경계가 있으면 경계를 따라 이격한 다각형을 층마다 쌓고 정북 일조 사선을 적용한다.
  if (site.boundary?.length > 2) {
    const built = buildPolygonFloors(site, { maxBuildingArea, maxFloorArea, maxFloors, floorHeight });
    if (built.floors.length) {
      return {
        site,
        derived: {
          maxBuildingArea: +maxBuildingArea.toFixed(2),
          maxFloorArea: +maxFloorArea.toFixed(2),
          buildable: { area: +built.base.area.toFixed(2), setback: built.base.setback, limitedBy: built.base.limitedBy },
          sunCutArea: built.cutArea
        },
        floors: built.floors
      };
    }
  }

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
    floors: placeFloorsOnSite(floors, site) // 실제 필지면 경계 방향·중심에 맞춘다
  };
}

// ---- 대안 3종 (같은 대지 조건, 규칙 기반) ----
// 모든 안은 층별 바닥면적 ≤ 최대 건축면적, 합계 ≤ 최대 연면적, 층수 ≤ maxFloors를 지킨다.
const floor2 = (v) => Math.floor(v * 100) / 100;

function makeFloor(level, width, depth, height, offsetX, offsetZ, use) {
  return { level, width: floor2(width), depth: floor2(depth), height, offsetX: +offsetX.toFixed(2), offsetZ: +offsetZ.toFixed(2), rotationDeg: 0, use };
}

// 층별 바닥면적 목록이 연면적 상한을 넘으면 같은 비율로 줄인다.
function fitPlates(plates, maxFloorArea) {
  const sum = plates.reduce((s, a) => s + a, 0);
  return sum > maxFloorArea ? plates.map((a) => (a * maxFloorArea) / sum) : plates;
}

// 균형형: 모든 층을 같은 크기로. 1층 바닥은 법정 최대의 85% 정도로 줄여 대지에 여유를 남긴다.
function buildBalanced(site, { maxBuildingArea, maxFloorArea }, maxFloors, h) {
  const n = clamp(Math.ceil(maxFloorArea / (maxBuildingArea * 0.85)), 1, maxFloors);
  const plate = Math.min(maxBuildingArea, maxFloorArea / n);
  const { width, depth } = footprintDims(plate, site);
  return Array.from({ length: n }, (_, i) => makeFloor(i + 1, width, depth, h, 0, 0, '기준층'));
}

// 테라스형: 1층은 최대 건축면적, 위로 갈수록 앞쪽(+Z)을 일정하게 물려 계단 모양을 만든다.
// 가로 폭은 유지하고 깊이만 줄이며 뒤쪽 벽선에 붙여, 물러난 자리가 앞쪽 테라스가 된다.
function buildTerraced(site, { maxBuildingArea, maxFloorArea }, maxFloors, h) {
  const ratio = maxFloorArea / maxBuildingArea;
  const n = clamp(Math.round((2 * ratio) / 1.4), Math.min(2, maxFloors), maxFloors);
  const top = clamp((2 * ratio) / n - 1, 0.3, 1); // 최상층 면적 / 1층 면적
  let plates = Array.from({ length: n }, (_, i) => maxBuildingArea * (n === 1 ? 1 : 1 - ((1 - top) * i) / (n - 1)));
  plates = fitPlates(plates, maxFloorArea);

  const base = footprintDims(plates[0], site);
  return plates.map((a, i) => {
    const depth = Math.max(3, a / base.width);
    const width = Math.min(base.width, a / depth);
    return makeFloor(i + 1, width, depth, h, 0, -(base.depth - depth) / 2, i === 0 ? '저층부' : i === n - 1 ? '최상층 테라스' : '테라스층');
  });
}

// 포디움+타워형: 아래 1~2층은 대지를 넓게 채우고, 그 위에 가는 타워를 뒤쪽 모서리에 세운다.
function buildPodiumTower(site, { maxBuildingArea, maxFloorArea }, maxFloors, h) {
  let podiumCount = maxFloorArea >= maxBuildingArea * 3 ? 2 : 1;
  podiumCount = Math.min(podiumCount, maxFloors);
  const podiumPlate = Math.min(maxBuildingArea, maxFloorArea / podiumCount);
  const podium = footprintDims(podiumPlate, site);
  const floors = [];
  for (let i = 0; i < podiumCount; i++) {
    floors.push(makeFloor(i + 1, podium.width, podium.depth, h, 0, 0, '포디움(상가·로비)'));
  }

  const remaining = maxFloorArea - podiumPlate * podiumCount;
  const towerSlots = maxFloors - podiumCount;
  if (remaining > 1 && towerSlots > 0) {
    const k = clamp(Math.ceil(remaining / (maxBuildingArea * 0.45)), 1, towerSlots);
    const plate = Math.min(maxBuildingArea, remaining / k);
    const tw = Math.min(podium.width, Math.sqrt(plate));
    const td = Math.min(podium.depth, plate / tw);
    for (let i = 0; i < k; i++) {
      floors.push(
        makeFloor(podiumCount + i + 1, tw, td, h, (podium.width - tw) / 2, -(podium.depth - td) / 2, '타워')
      );
    }
  }
  return floors;
}

const ALTERNATIVES = [
  {
    key: 'balanced',
    name: '균형형',
    sub: '같은 크기의 층을 반듯하게 쌓은 기본형',
    build: buildBalanced,
    intent: '모든 층을 같은 크기로 쌓아 설계와 공사를 가장 단순하게 만든 안입니다. 1층 바닥을 법정 최대보다 조금 줄여 대지에 마당·주차 여유를 남겼습니다.',
    pros: ['층마다 평면이 같아 공사비와 공사 기간을 예측하기 쉬움', '구조가 단순해 기둥·벽을 위아래로 그대로 이을 수 있음', '대지에 빈 땅이 남아 마당·주차·조경에 쓸 수 있음'],
    cons: ['네모난 상자 모양이라 외관이 단조로울 수 있음', '1층을 줄인 만큼 층수가 늘어 높이가 올라갈 수 있음', '옥상 말고는 층마다 쓸 수 있는 바깥 공간이 없음']
  },
  {
    key: 'terraced',
    name: '위층이 물러난 형태',
    sub: '위로 갈수록 앞쪽을 물린 계단형(테라스형)',
    build: buildTerraced,
    intent: '아래층은 넓게 쓰고, 위로 올라갈수록 앞쪽을 조금씩 물려 계단 모양으로 만든 안입니다. 물러난 자리는 각 층의 테라스가 됩니다.',
    pros: ['층마다 테라스(바깥 공간)가 생겨 주거·사무 환경이 좋아짐', '앞길과 이웃에 주는 답답함과 그림자가 줄어듦(일조·사선 제한 대응에 유리)', '위로 갈수록 가벼워 보여 스카이라인이 부드러움'],
    cons: ['층마다 평면이 달라 설계·공사가 복잡하고 비용이 늘어남', '테라스 바닥의 방수·배수 관리가 필요함', '위층 면적이 작아 쓰임새가 제한됨']
  },
  {
    key: 'podium',
    name: '낮은 부분 + 높은 부분',
    sub: '넓은 저층부(포디움) 위에 가는 타워',
    build: buildPodiumTower,
    intent: '아래 1~2층은 대지를 넓게 채워 상가·로비로 쓰고, 그 위에는 가는 타워를 뒤쪽 모서리에 세운 안입니다. 저층부 지붕은 옥상정원이 됩니다.',
    pros: ['저층부 바닥이 넓어 상가·로비·공용 공간을 넉넉히 둘 수 있음', '저층부 지붕을 옥상정원·테라스로 쓸 수 있음', '타워가 가늘어 조망과 채광이 좋고 눈에 띄는 랜드마크가 됨'],
    cons: ['타워가 높아져 최고 높이가 가장 높아질 수 있음', '저층과 타워의 구조가 달라 구조 전환 비용이 듦', '타워 층 면적이 작아 계단·엘리베이터가 차지하는 비율이 큼']
  }
];

function buildAlternativeSpecs(site) {
  const { maxBuildingArea, maxFloorArea } = computeDerived(site);
  const maxFloors = floorCap(site);
  const h = site.floorHeight || 3.3;
  const derived = { maxBuildingArea: +maxBuildingArea.toFixed(2), maxFloorArea: +maxFloorArea.toFixed(2) };
  return ALTERNATIVES.map((alt) => ({
    ...alt,
    spec: { site, derived, floors: placeFloorsOnSite(alt.build(site, { maxBuildingArea, maxFloorArea }, maxFloors, h), site) }
  }));
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
  const buildArea = above.length ? Math.max(...above.map(plateArea)) : 0;
  const gfa = above.reduce((s, f) => s + plateArea(f), 0);
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
  { key: 'height', unit: 'm', digits: 1, limitKey: 'maxHeight' },
  { key: 'floorCount', unit: 'F', digits: 0, limitKey: 'maxFloors' }
];

function fmt(v, d) {
  return (v || 0).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// spec: 표시할 설계(기본은 현재 설계, 면 밀고 당기기 중에는 드래그 중인 임시 설계)
function renderTitleblock(showDelta, spec = currentSpec) {
  const site = spec.site;
  const values = computeValues(site, spec.floors);
  const limits = {
    coverageArea: spec.derived.maxBuildingArea,
    coverageRatio: site.coverageRatio,
    farArea: spec.derived.maxFloorArea,
    farRatio: site.farRatio,
    maxFloors: site.maxFloors,
    maxHeight: site.maxHeight
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
// keepCamera: 층 직접 편집 때처럼 시점을 그대로 두고 매스만 다시 그린다.
function renderSpec(spec, touchedLevels, showDelta, { keepCamera = false } = {}) {
  massGroup.clear();
  if (selectedLevel != null && !spec.floors.some((f) => f.level === selectedLevel)) selectedLevel = null;
  if (siteOutline) scene.remove(siteOutline);

  const site = spec.site;
  const { sw, sd } = siteDims(site);
  siteOutline = buildSiteOutline(site, sw, sd);
  scene.add(siteOutline);

  if (groundGrid) scene.remove(groundGrid);
  groundGrid = new THREE.GridHelper(Math.max(sw, sd) * 2, 20, 0x20313a, 0x1a272e);
  scene.add(groundGrid);

  const flashEdges = [];
  const { topY, bottomY } = stackFloors(spec.floors, (f, centerY) => {
    if (f.level === selectedLevel) {
      // 면 수정 중이면 색을 한 단계 더 진하게 해서 모드가 바뀐 것을 바로 알 수 있게 한다.
      addFloorMesh(f, centerY, faceEditLevel === f.level ? 'faceEdit' : 'selected');
      return;
    }
    const touched = touchedLevels && touchedLevels.has(f.level);
    const { lineMat } = addFloorMesh(f, centerY, touched ? 'touched' : 'solid');
    if (touched) flashEdges.push(lineMat);
  });

  if (flashEdges.length) {
    setTimeout(() => flashEdges.forEach((m) => (m.color.set(0x0b1014))), 1500);
  }

  // 주변 건물은 조회한 필지 좌표계 기준이므로, 그 경계를 쓰지 않는 대지에서는 숨긴다.
  if (neighborGroup) neighborGroup.visible = showNeighbors && !!spec.site.boundary?.length;
  if (neighborsBtn) neighborsBtn.hidden = !neighborGroup || !spec.site.boundary?.length;

  if (!keepCamera) frameCamera([spec.floors], topY, bottomY, sw, sd);

  emptyState.hidden = spec.floors.length > 0;
  setEditingLocked(false);

  renderLayerPanel(spec);
  renderTitleblock(!!showDelta, spec);
  updateFloorEditor(spec);
  updateGizmo(spec);
}

// 실제 필지 경계(boundary, 미터 좌표)가 있으면 그 모양 그대로, 없으면 사각형으로 대지선을 그린다.
function buildSiteOutline(site, sw, sd) {
  const mat = new THREE.LineBasicMaterial({ color: 0x57c2d6 });
  if (site.boundary?.length > 2) {
    const pts = site.boundary.map(([x, z]) => new THREE.Vector3(x, 0.02, z));
    pts.push(pts[0].clone());
    return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  }
  return new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(sw, 0.01, sd)), mat);
}

// 지상층(level>0)은 지면(y=0)에서 위로, 지하층(level<0)은 지면에서 아래로 각각 쌓는다.
// 각 층의 중심 높이를 콜백으로 넘기고, 전체 위/아래 끝 높이를 돌려준다.
function stackFloors(floors, onFloor) {
  let y = 0;
  floors.filter((f) => f.level > 0).sort((a, b) => a.level - b.level).forEach((f) => {
    onFloor(f, y + f.height / 2);
    y += f.height;
  });
  let yTop = 0;
  floors.filter((f) => f.level < 0).sort((a, b) => b.level - a.level).forEach((f) => { // B1(가장 얕음)부터
    onFloor(f, yTop - f.height / 2);
    yTop -= f.height;
  });
  return { topY: y, bottomY: yTop };
}

// style: 'solid' 확정 매스 / 'touched' 바뀐 층(빨간 선) / 'selected' 직접 편집 중인 층(청록)
//        / 'ghost' 미리보기 중 원본(반투명 청록 윤곽)
const FLOOR_FILL = { solid: 0xede8dc, touched: 0xf2d2c8, selected: 0xcfeaf0, faceEdit: 0xbfe6ef };
const FLOOR_EDGE = { solid: 0x0b1014, touched: 0xe2604a, selected: 0x1f8fa6, faceEdit: 0x0f6f84 };

// 다각형 층은 shape를 그대로 세우고(중심 정렬 없음), 사각형 층은 기존처럼 박스로 만든다.
function floorGeometry(f) {
  if (!f.shape) return new THREE.BoxGeometry(f.width, f.height, f.depth);
  const shape = new THREE.Shape(f.shape.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: f.height, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // XY로 만든 뒤 눕혀 높이를 +Y로
  geo.translate(0, -f.height / 2, 0); // 다른 층과 같은 "중심 높이" 기준으로 맞춘다
  return geo;
}

function addFloorMesh(f, centerY, style) {
  const geo = floorGeometry(f);
  const mat =
    style === 'ghost'
      ? new THREE.MeshBasicMaterial({ color: 0x57c2d6, transparent: true, opacity: 0.07, depthWrite: false })
      : new THREE.MeshStandardMaterial({ color: FLOOR_FILL[style], roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  // 다각형 층은 좌표가 이미 절대 위치라 추가 이동·회전이 없다.
  mesh.position.set(f.shape ? 0 : f.offsetX || 0, centerY, f.shape ? 0 : f.offsetZ || 0);
  mesh.rotation.y = f.shape ? 0 : THREE.MathUtils.degToRad(f.rotationDeg || 0);
  if (style !== 'ghost') mesh.userData.level = f.level; // 클릭·밀고 당기기에서 어느 층인지 찾는 데 쓴다

  const lineMat =
    style === 'ghost'
      ? new THREE.LineDashedMaterial({ color: 0x57c2d6, dashSize: 0.6, gapSize: 0.35, transparent: true, opacity: 0.9, depthTest: false })
      : new THREE.LineBasicMaterial({ color: FLOOR_EDGE[style] });
  const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), lineMat);
  line.position.copy(mesh.position);
  line.rotation.copy(mesh.rotation);
  if (style === 'ghost') {
    line.computeLineDistances();
    line.renderOrder = 2; // 수정안 매스에 가려진 원본 윤곽도 보이도록 맨 나중에 그린다
    mesh.renderOrder = 1;
  }
  massGroup.add(mesh, line);
  return { mesh, lineMat };
}

function frameCamera(floorSets, topY, bottomY, sw, sd) {
  const all = floorSets.flat();
  const footDiag = all.length ? Math.max(...all.map(floorDiag)) : Math.hypot(sw, sd);
  // 주변 건물이 있으면 맥락이 보이도록 조금 더 넓게(최대 60m 범위) 잡는다.
  const context = showNeighbors && landData?.neighbors?.length ? Math.min(60, Math.max(...landData.neighbors.map((b) => b.dist || 0)) + 15) : 0;
  controls.target.set(0, (topY + bottomY) / 2, 0);
  viewRadius = Math.max(footDiag, Math.hypot(sw, sd), topY - bottomY, context, 10) * 1.6 + 8;
}

// 미리보기 중에는 설계를 직접 바꾸는 동작(새로 생성·대안 채택·되돌리기)을 잠근다.
// 채팅과 빠른 요청은 열어 두어 검토 중인 수정안에 추가 요청을 할 수 있게 한다.
const CHAT_PLACEHOLDER = chatInput.placeholder;
function setEditingLocked(locked) {
  quickList.querySelectorAll('.quick-btn').forEach((b) => (b.disabled = false));
  compareBtn.disabled = locked;
  generateBtn.disabled = locked;
  sampleSelect.disabled = locked;
  if (locked) undoBtn.disabled = true;
  chatInput.placeholder = locked
    ? '검토 중인 수정안에 추가 요청하기 (원래 설계 기준으로 다시 계산합니다)'
    : CHAT_PLACEHOLDER;
}

// ---- 층별 레이어 패널 (3D 뷰 오른쪽, 위층→아래층→지하층 순) ----
// marks: 미리보기 중 층 번호 → 'changed' | 'added' (레이어 행에 표시)
function renderLayerPanel(spec, marks = new Map()) {
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
    <div class="layer-row${f.level < 0 ? ' basement' : ''}${marks.has(f.level) ? ' ' + marks.get(f.level) : ''}${f.level === selectedLevel ? ' selected' : ''}" data-level="${f.level}" role="button" tabindex="0" title="${f.level === selectedLevel ? '다시 클릭하면 면 수정 켜기/끄기' : '클릭하면 이 층 선택'}">
      <span class="layer-lv">${floorLabel(f.level)}</span>
      <span class="layer-dim">${f.shape ? `${fmt(plateArea(f), 1)}<u>m²</u>` : `${fmt(f.width, 1)}×${fmt(f.depth, 1)}<u>m</u>`} · ${fmt(f.height, 1)}<u>m</u></span>
      ${f.use ? `<span class="layer-use">${escapeHtml(f.use)}</span>` : ''}
    </div>`
    )
    .join('');
}

generateBtn.addEventListener('click', () => {
  let site;
  try {
    site = JSON.parse(siteJsonInput.value);
  } catch (e) {
    showSiteErrors([`JSON 형식이 올바르지 않습니다. 쉼표·따옴표·괄호를 확인해 주세요. (${e.message})`]);
    return;
  }
  const errors = validateSite(site);
  if (errors.length) {
    showSiteErrors(errors);
    return;
  }
  clearSiteErrors();

  // 새로 생성해도 직전 설계는 되돌리기 이력에 남긴다.
  if (currentSpec) history.push(snapshot());
  prevValues = currentSpec ? computeValues(currentSpec.site, currentSpec.floors) : null;
  currentSpec = generateMaxMassSpec(site);
  rev = 0;
  renderSpec(currentSpec, null, !!prevValues);
  setView('bird');
  const v = computeValues(site, currentSpec.floors);
  appendMessage(
    'system',
    escapeHtml(
      `${site.name ? `「${site.name}」 조건으로 ` : ''}최대 규모 매스를 생성했습니다 ` +
        `(${v.floorCount}층 · 높이 ${fmt(v.height, 1)}m · 연면적 ${fmt(v.gfa, 1)}㎡). 이제 자연어로 수정 요청을 해보세요.`
    )
  );
  saveDesign();
});

// 초기 로드: 저장된 설계가 있으면 그대로 복원하고, 없으면 첫 샘플로 자동 생성한다.
const savedDesign = loadDesign();
if (savedDesign) {
  currentSpec = savedDesign.spec;
  rev = savedDesign.rev;
  history = savedDesign.history;
  chatEntries = savedDesign.chat;
  chatEntries.forEach((m) => renderMessage(m));
  if (savedDesign.land) showLand(savedDesign.land);
  setSiteInputs(currentSpec.site);
  renderSpec(currentSpec);
  setView('bird');
  appendMessage('system', escapeHtml(`저장된 설계(REV ${String(rev).padStart(2, '0')})를 불러왔습니다.`), null, { persist: false });
  if (savedDesign.pending) {
    showPreview(savedDesign.pending);
    appendMessage(
      'system',
      escapeHtml(`검토 중이던 수정안(v${savedDesign.pending.instructions.length})을 복원했습니다. 적용 또는 취소를 눌러 주세요.`),
      null,
      { persist: false }
    );
  }
} else {
  setSiteInputs({ ...SAMPLES[0].data });
  generateBtn.click();
}

// ---- chat log rendering ----
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// bodyHtml is trusted markup assembled by this module; plain text callers pass through escapeHtml first.
// persist: false면 새로고침 후 복원하지 않는 일시적 메시지(예: "매스 조정 중...").
function appendMessage(kind, bodyHtml, who, { persist = true } = {}) {
  const entry = { kind, html: bodyHtml, who: who || null };
  if (persist) {
    chatEntries.push(entry);
    if (chatEntries.length > MAX_CHAT) chatEntries = chatEntries.slice(-MAX_CHAT);
  }
  return renderMessage(entry);
}

function renderMessage({ kind, html, who }) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  const whoLabel = who || (kind === 'user' ? '나' : kind === 'assistant' ? 'AI' : kind === 'error' ? '오류' : '시스템');
  div.innerHTML = `<div class="who">${whoLabel}</div><div class="body">${html}</div>`;
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
  // _src: 원본에서의 층 번호. 재번호 뒤에도 "어느 원본 층이 어떻게 바뀌었는지" 비교하려고 붙여 둔다(새 층은 없음).
  let next = floors.map((f) => ({ ...f, _src: f.level }));
  const touched = new Set(); // 층 객체(참조) 기준으로 모았다가, 재번호 이후에 실제 level로 변환한다.

  changes.forEach((c) => {
    if (c.action === 'delete_floors') {
      next = next.filter((f) => f.level < c.floorStart || f.level > c.floorEnd);
      return;
    }

    if (c.action === 'add_floors' || c.action === 'add_basement') {
      const isBasement = c.action === 'add_basement';
      const count = changeFloorCount(c); // 앱 고정 상한 없음 — 사용자 조건 초과는 미리보기에서 경고한다
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
      // 다각형 층은 폭·깊이·위치·회전을 shape 자체에 적용한다(모양을 유지한 채 늘리고/옮기고/돌린다).
      if (f.shape) {
        const updated = { ...f, height: c.height != null ? clamp(c.height, 2, 14) : f.height, use: c.use != null ? c.use : f.use };
        updated.shape = transformShape(f.shape, c);
        touched.add(updated);
        return updated;
      }
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
  const merged = [...above, ...basement];
  const diff = diffFloors(floors, merged);
  return { floors: merged.map(({ _src, ...f }) => f), touched: renumberedTouched, diff };
}

// 층 바닥면적 — 다각형 층(shape)은 실제 다각형 면적, 사각형 층은 폭×깊이
function plateArea(f) {
  return f.shape ? polyArea(f.shape) : f.width * f.depth;
}

// 층의 가로·세로(다각형 층은 외접 사각형) — 표시·카메라 계산용
function floorSize(f) {
  if (!f.shape) return { width: f.width, depth: f.depth };
  const b = polyBBox(f.shape);
  return { width: +(b.maxX - b.minX).toFixed(2), depth: +(b.maxZ - b.minZ).toFixed(2) };
}

function floorDiag(f) {
  const { width, depth } = floorSize(f);
  return Math.hypot(width, depth);
}

// 층별 변경 내역: 추가/삭제/변경(치수·층고·위치·회전·용도, 층 번호 이동 포함)
// 다각형 층에 폭/깊이/위치/회전 변경을 적용: 외접 사각형 기준으로 늘리고, 중심 기준으로 옮기고 돌린다.
function transformShape(shape, c) {
  let out = shape;
  const size = floorSize({ shape });
  if (c.width != null || c.depth != null) {
    const kx = c.width != null && size.width > 0.01 ? clamp(c.width, 1, 1000) / size.width : 1;
    const kz = c.depth != null && size.depth > 0.01 ? clamp(c.depth, 1, 1000) / size.depth : 1;
    out = scalePoly(out, kx, kz);
  }
  if (c.rotationDeg != null) out = rotatePoly(out, c.rotationDeg);
  if (c.offsetX != null || c.offsetZ != null) {
    const [cx, cz] = polyCentroid(out);
    out = translatePoly(out, c.offsetX != null ? c.offsetX - cx : 0, c.offsetZ != null ? c.offsetZ - cz : 0);
  }
  return out;
}

function diffFloors(before, after) {
  const rows = [];
  const kept = new Set();
  after.forEach((f) => {
    if (f._src == null) {
      rows.push({ type: 'add', level: f.level, after: f, area: plateArea(f) });
      return;
    }
    kept.add(f._src);
    const b = before.find((x) => x.level === f._src);
    const diffs = [];
    const near = (x, y, tol = 0.05) => Math.abs((x || 0) - (y || 0)) < tol;
    if (b.shape || f.shape) {
      if (!near(plateArea(b), plateArea(f), 0.5)) diffs.push(`바닥면적 ${fmt(plateArea(b), 1)} → ${fmt(plateArea(f), 1)}㎡`);
      // 면적이 같아도 옮겼을 수 있으므로 중심 위치도 비교한다.
      if (b.shape && f.shape) {
        const [bx, bz] = polyCentroid(b.shape);
        const [fx, fz] = polyCentroid(f.shape);
        if (!near(bx, fx, 0.05) || !near(bz, fz, 0.05)) {
          diffs.push(`위치 (${fmt(bx, 1)}, ${fmt(bz, 1)}) → (${fmt(fx, 1)}, ${fmt(fz, 1)})`);
        }
      }
    } else if (!near(b.width, f.width) || !near(b.depth, f.depth)) {
      diffs.push(`평면 ${fmt(b.width, 1)}×${fmt(b.depth, 1)} → ${fmt(f.width, 1)}×${fmt(f.depth, 1)}m`);
    }
    if (!near(b.height, f.height)) diffs.push(`층고 ${fmt(b.height, 1)} → ${fmt(f.height, 1)}m`);
    if (!near(b.offsetX, f.offsetX) || !near(b.offsetZ, f.offsetZ)) diffs.push(`위치 (${fmt(b.offsetX, 1)}, ${fmt(b.offsetZ, 1)}) → (${fmt(f.offsetX, 1)}, ${fmt(f.offsetZ, 1)})`);
    if (!near(b.rotationDeg, f.rotationDeg, 0.5)) diffs.push(`회전 ${fmt(b.rotationDeg, 0)}° → ${fmt(f.rotationDeg, 0)}°`);
    if ((b.use || '') !== (f.use || '')) diffs.push(`용도 ${b.use || '없음'} → ${f.use || '없음'}`);
    if (b.level !== f.level) diffs.push(`층 번호 ${floorLabel(b.level)} → ${floorLabel(f.level)}`);
    if (diffs.length) rows.push({ type: 'change', level: f.level, from: b.level, diffs, area: plateArea(f) - plateArea(b) });
  });
  before.forEach((b) => {
    if (!kept.has(b.level)) rows.push({ type: 'delete', level: b.level, area: -plateArea(b) });
  });
  return rows.sort((a, b) => b.level - a.level); // 위층부터(지상 → 지하) 보여준다
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
      provider: providerSelect.value,
      // .env 키가 없거나 인증에 실패할 때만 서버가 쓰는 예비 키(이 탭에 입력된 값)
      key: userKeys[providerSelect.value] || ''
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
  if (debug?.keyFallback) {
    appendMessage('system', escapeHtml('서버 .env 키 인증에 실패해 이 탭에 입력한 키로 다시 시도했습니다.'));
  }
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
  // 한글 등 조합 중(IME)에 누른 Enter는 글자를 확정하는 키다. 그때 보내면 조합 중인 글자가 잘려 나간다.
  if (e.isComposing || e.keyCode === 229) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (busy) return; // 응답을 기다리는 동안 Enter를 연타해도 중복 요청하지 않는다
    composerForm.requestSubmit();
  }
});

// 대화 접기/펼치기 — 기록이 길어도 입력창을 바로 쓸 수 있게 한다.
chatCollapse.addEventListener('click', () => {
  const chat = chatCollapse.closest('.chat');
  const collapsed = chat.classList.toggle('collapsed');
  chatCollapse.textContent = collapsed ? '대화 펼치기' : '대화 접기';
  chatCollapse.setAttribute('aria-expanded', String(!collapsed));
  if (!collapsed) chatLog.scrollTop = chatLog.scrollHeight;
});

// 오류 메시지의 "다시 시도" — 설계는 그대로 두고 같은 요청을 다시 보낸다.
chatLog.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-retry]');
  if (!btn || busy) return;
  const instruction = btn.dataset.retry;
  btn.closest('.msg')?.remove();
  chatEntries = chatEntries.filter((m) => !m.html.includes(`data-retry="${escapeHtml(instruction)}"`));
  sendChat(instruction, { retry: true });
});

undoBtn.addEventListener('click', () => {
  const snap = history.pop();
  if (!snap) return;
  prevValues = computeValues(currentSpec.site, currentSpec.floors);
  currentSpec = snap.spec;
  rev = snap.rev;
  setSiteInputs(currentSpec.site);
  clearSiteErrors();
  renderSpec(currentSpec, null, true);
  appendMessage('system', escapeHtml(`REV ${String(rev).padStart(2, '0')} 상태로 되돌렸습니다.`));
  saveDesign();
});

async function sendChat(instructionArg, { retry = false } = {}) {
  const instruction = instructionArg ?? chatInput.value.trim();
  if (!instruction || !currentSpec || busy) return;
  if (retry) appendMessage('system', escapeHtml('같은 요청을 다시 보냅니다.'), null, { persist: false });

  // 검토 중인 수정안이 있으면 "추가 요청"으로 처리한다. 수정안 위에 또 쌓지 않고,
  // 원래 설계(currentSpec)에 지금까지의 요청을 모두 합쳐 다시 보내 새 수정안을 만든다.
  const refining = !!pendingProposal;
  const instructions = refining ? [...pendingProposal.instructions, instruction] : [instruction];
  appendMessage('user', escapeHtml(instruction), refining ? `나 · 추가 요청 ${instructions.length - 1}` : null);
  setBusy(true);
  const pending = appendMessage(
    'system',
    refining ? escapeHtml(`원래 설계를 기준으로 요청 ${instructions.length}개를 합쳐 다시 계산 중...`) : '매스 조정 중...',
    null,
    { persist: false }
  );
  try {
    const result = await requestMassEdit(composeInstruction(instructions));
    pending.remove();

    const changes = (result.changes || []).filter((c) => !isNoop(c, currentSpec.floors));
    if (!changes.length) {
      appendMessage(
        'assistant',
        escapeHtml(result.interpretation || '변경할 내용이 없어 그대로 유지했습니다.') +
          (refining ? '<p class="preview-note">원래 설계와 달라지는 점이 없어 검토 중인 수정안을 그대로 둡니다.</p>' : '')
      );
      return;
    }

    // 바로 확정하지 않고 미리보기로만 보여준다. 현재 설계·이력은 "적용"을 눌렀을 때만 바뀐다.
    const beforeFloors = currentSpec.floors.map((f) => ({ ...f }));
    const { floors: nextFloors, touched, diff } = applyChanges(currentSpec.floors, changes);

    const html =
      `<strong>${escapeHtml(result.interpretation || '')}</strong>` +
      renderChangeRows(changes, beforeFloors) +
      `<p style="margin:6px 0 0">${escapeHtml(result.explanation || '')}</p>` +
      `<p class="preview-note">미리보기 중${refining ? ` — 원래 설계 기준, 요청 ${instructions.length}개 반영` : ''}. 화면 아래에서 적용 또는 취소를 눌러 주세요.</p>`;
    appendMessage('assistant', html, `AI · 수정안 v${instructions.length}`);
    showPreview({ floors: nextFloors, touched, diff, interpretation: result.interpretation || '', instructions });
  } catch (e) {
    pending.remove();
    // 오류가 나도 현재 설계는 건드리지 않는다. 같은 요청을 한 번에 다시 보낼 수 있게 버튼을 붙인다.
    appendMessage(
      'error',
      escapeHtml(e.message) +
        `<br>현재 설계는 그대로 두었습니다.${refining ? ' 검토 중인 수정안도 남아 있습니다.' : ''}` +
        `<br><button type="button" class="retry-btn" data-retry="${escapeHtml(instruction)}">같은 요청 다시 시도</button>`
    );
  } finally {
    setBusy(false);
    saveDesign();
  }
}

function composeInstruction(list) {
  if (list.length === 1) return list[0];
  return [
    '아래 요청들은 아직 하나도 적용되지 않았다. "현재 매스"(원래 설계)를 기준으로 모든 요청을 한 번에 반영한 최종 변경 명령을 만들어라.',
    '같은 변경을 두 번 적용하지 말고, 요청끼리 겹치거나 충돌하면 나중 요청을 우선하라.',
    ...list.map((t, i) => `${i + 1}. ${t}`)
  ].join('\n');
}

// LLM 응답을 기다리는 동안에는 전송/적용/취소를 막아 수정안이 엇갈리지 않게 한다.
function setBusy(on) {
  busy = on;
  chatSendBtn.disabled = on;
  quickList.querySelectorAll('.quick-btn').forEach((b) => (b.disabled = on || !currentSpec));
  previewApply.disabled = on;
  previewCancel.disabled = on;
  previewPanel.querySelectorAll('[data-fix]').forEach((b) => (b.disabled = on));
}

// ---- AI 수정안 미리보기: 원본(점선 윤곽)과 수정안(바뀌는 층 빨간 선)을 겹쳐 보여주고 적용/취소를 받는다 ----

// 입력한 조건(건폐율·용적률·층수·최고 높이)을 넘는 항목과 초과량, 조정 방향을 계산한다.
function checkLimits(site, derived, floors) {
  const v = computeValues(site, floors);
  const top = floors.filter((f) => f.level > 0).sort((a, b) => b.level - a.level); // 위층부터
  // 위에서부터 몇 개 층을 빼야 amount(면적 또는 높이)를 확보하는지
  const topFloorsFor = (amount, measure) => {
    let sum = 0;
    const picked = [];
    for (const f of top) {
      if (sum >= amount) break;
      sum += measure(f);
      picked.push(floorLabel(f.level));
    }
    return picked;
  };
  const out = [];

  const maxBA = derived.maxBuildingArea;
  if (v.buildArea > maxBA + 0.5) {
    const excess = v.buildArea - maxBA;
    const wide = top.filter((f) => plateArea(f) > maxBA + 0.5).map((f) => floorLabel(f.level));
    out.push({
      label: '건축면적 (건폐율)',
      value: `${fmt(v.buildArea, 1)}㎡ (${fmt(v.bcr, 1)}%)`,
      limit: `${fmt(maxBA, 1)}㎡ (${fmt(site.coverageRatio, 0)}%)`,
      excess: `${fmt(excess, 1)}㎡`,
      fix: `↓ 바닥 줄이기: ${wide.join(', ')}의 바닥을 각각 ${fmt(maxBA, 1)}㎡ 이하로 (가장 넓은 층은 ${fmt(excess, 1)}㎡ 이상 축소)`,
      ask: `건축면적이 최대 ${fmt(maxBA, 1)}㎡를 ${fmt(excess, 1)}㎡ 넘는다. ${wide.join(', ')}의 바닥을 줄여 건폐율 ${site.coverageRatio}% 이내로 맞춰라.`
    });
  }

  const maxGFA = derived.maxFloorArea;
  if (v.gfa > maxGFA + 0.5) {
    const excess = v.gfa - maxGFA;
    const picked = topFloorsFor(excess, plateArea);
    out.push({
      label: '연면적 (용적률)',
      value: `${fmt(v.gfa, 1)}㎡ (${fmt(v.far, 1)}%)`,
      limit: `${fmt(maxGFA, 1)}㎡ (${fmt(site.farRatio, 0)}%)`,
      excess: `${fmt(excess, 1)}㎡`,
      fix: `↓ 연면적 ${fmt(excess, 1)}㎡ 이상 줄이기: 위에서 ${picked.length}개 층(${picked.join(', ')}) 삭제, 또는 여러 층 바닥을 나눠서 축소`,
      ask: `연면적이 최대 ${fmt(maxGFA, 1)}㎡를 ${fmt(excess, 1)}㎡ 넘는다. 층을 빼거나 바닥을 줄여 용적률 ${site.farRatio}% 이내로 맞춰라.`
    });
  }

  if (site.maxFloors && v.floorCount > site.maxFloors) {
    const excess = v.floorCount - site.maxFloors;
    const picked = top.slice(0, excess).map((f) => floorLabel(f.level));
    out.push({
      label: '지상 층수',
      value: `${v.floorCount}층`,
      limit: `${site.maxFloors}층`,
      excess: `${excess}개 층`,
      fix: `↓ 층수 ${excess}개 줄이기: ${picked.join(', ')} 삭제 (필요하면 남은 층 바닥을 넓혀 면적 보전)`,
      ask: `지상 층수가 최대 ${site.maxFloors}층을 ${excess}개 층 넘는다. ${site.maxFloors}층 이내로 줄여라.`
    });
  }

  if (site.maxHeight && v.height > site.maxHeight + 0.05) {
    const excess = v.height - site.maxHeight;
    const picked = topFloorsFor(excess, (f) => f.height);
    const perFloor = excess / Math.max(1, v.floorCount);
    const avgH = v.height / Math.max(1, v.floorCount);
    const heightOnly = avgH - perFloor >= 2
      ? `, 또는 층고를 층마다 평균 ${fmt(perFloor, 2)}m 낮추기`
      : ' (층고만 낮춰서는 최소 층고 2m 아래로 내려가 불가)';
    out.push({
      label: '최고 높이',
      value: `${fmt(v.height, 1)}m`,
      limit: `${fmt(site.maxHeight, 1)}m`,
      excess: `${fmt(excess, 1)}m`,
      fix: `↓ 높이 ${fmt(excess, 1)}m 이상 낮추기: 위에서 ${picked.length}개 층(${picked.join(', ')}) 삭제${heightOnly}`,
      ask: `최고 높이가 제한 ${site.maxHeight}m를 ${fmt(excess, 1)}m 넘는다. 층을 빼거나 층고를 낮춰 ${site.maxHeight}m 이내로 맞춰라.`
    });
  }
  return out;
}

function renderPreviewWarnings(warnings) {
  if (!warnings.length) return '';
  return (
    `<div class="pw-title">⚠ 입력 조건 초과 ${warnings.length}건 — 적용은 가능하지만 아래처럼 조정이 필요합니다</div>` +
    warnings
      .map(
        (w) => `<div class="pw-row">
      <span class="pw-label">${escapeHtml(w.label)}</span>
      <span class="pw-val">${escapeHtml(w.value)} <span class="lim">/ 최대 ${escapeHtml(w.limit)}</span> <b>${escapeHtml(w.excess)} 초과</b></span>
      <span class="pw-fix">${escapeHtml(w.fix)}</span>
    </div>`
      )
      .join('') +
    '<button class="btn small" type="button" data-fix>초과분을 맞춰 달라고 AI에 추가 요청</button>'
  );
}

function signed(v, digits, unit) {
  if (Math.abs(v) < 0.5 * Math.pow(10, -digits)) return '±0';
  return `${v > 0 ? '+' : '−'}${fmt(Math.abs(v), digits)}${unit}`;
}

function renderPreviewFloors(diff) {
  if (!diff.length) return '<p class="meta">바뀌는 층이 없습니다.</p>';
  return diff
    .map((r) => {
      const cls = r.area > 0.05 ? 'plus' : r.area < -0.05 ? 'minus' : '';
      const areaText = `<span class="da ${cls}">${signed(r.area, 1, '㎡')}</span>`;
      if (r.type === 'add') {
        return `<div class="pf-row"><span class="lv">${floorLabel(r.level)}</span><span class="what"><b>새 층 추가</b> · ${fmt(r.after.width, 1)}×${fmt(r.after.depth, 1)}m, 층고 ${fmt(r.after.height, 1)}m</span>${areaText}</div>`;
      }
      if (r.type === 'delete') {
        return `<div class="pf-row"><span class="lv">${floorLabel(r.level)}</span><span class="what"><b>층 삭제</b> (현재 설계 기준 번호)</span>${areaText}</div>`;
      }
      return `<div class="pf-row"><span class="lv">${floorLabel(r.level)}</span><span class="what">${r.diffs.map(escapeHtml).join('<br>')}</span>${areaText}</div>`;
    })
    .join('');
}

function renderPreviewTotals(site, before, after, derived) {
  const rows = [
    ['건축면적', 'buildArea', 1, '㎡', derived.maxBuildingArea],
    ['건폐율', 'bcr', 1, '%', site.coverageRatio],
    ['연면적', 'gfa', 1, '㎡', derived.maxFloorArea],
    ['용적률', 'far', 1, '%', site.farRatio],
    ['최고 높이', 'height', 1, 'm', site.maxHeight],
    ['지상 층수', 'floorCount', 0, '층', site.maxFloors]
  ];
  return (
    '<tr><th>항목</th><td class="d">현재</td><td class="d">수정안</td><td class="d">차이</td></tr>' +
    rows
      .map(([label, key, d, unit, limit]) => {
        const dv = after[key] - before[key];
        const tol = key === 'floorCount' ? 0.5 : 0.1;
        const over = limit != null && after[key] > limit + tol;
        const cls = Math.abs(dv) < tol ? '' : dv > 0 ? 'plus' : 'minus';
        return `<tr><th>${label}</th><td>${fmt(before[key], d)}${unit}</td><td class="after${over ? ' over' : ''}"${over ? ' title="법정 상한 초과"' : ''}>${fmt(after[key], d)}${unit}${over ? ' ⚠' : ''}</td><td class="d ${cls}">${signed(dv, d, key === 'bcr' || key === 'far' ? '%p' : unit)}</td></tr>`;
      })
      .join('')
  );
}

function showPreview(proposal) {
  pendingProposal = proposal;
  selectedLevel = null; // 수정안 검토 중에는 층 직접 편집을 멈춘다
  floorEditor.hidden = true;
  const site = currentSpec.site;
  const before = computeValues(site, currentSpec.floors);
  const after = computeValues(site, proposal.floors);
  proposal.warnings = checkLimits(site, currentSpec.derived, proposal.floors);
  previewWarnings.innerHTML = renderPreviewWarnings(proposal.warnings);
  previewWarnings.hidden = !proposal.warnings.length;
  previewTitle.textContent =
    `AI 수정안 미리보기 v${proposal.instructions.length} · 아직 적용 전` +
    (proposal.instructions.length > 1 ? ` · 원래 설계 기준 요청 ${proposal.instructions.length}개 반영` : '');
  previewFloors.innerHTML = renderPreviewFloors(proposal.diff);
  previewTotals.innerHTML = renderPreviewTotals(site, before, after, currentSpec.derived);
  previewPanel.hidden = false;
  setEditingLocked(true);
  renderPreviewScene(proposal);
  previewApply.focus();
}

function renderPreviewScene(proposal) {
  massGroup.clear();
  const { sw, sd } = siteDims(currentSpec.site);
  const orig = stackFloors(currentSpec.floors, (f, y) => addFloorMesh(f, y, 'ghost'));
  const next = stackFloors(proposal.floors, (f, y) => addFloorMesh(f, y, proposal.touched.has(f.level) ? 'touched' : 'solid'));
  frameCamera([currentSpec.floors, proposal.floors], Math.max(orig.topY, next.topY), Math.min(orig.bottomY, next.bottomY), sw, sd);
  setView('bird'); // 원본과 수정안이 모두 화면에 들어오도록 조감 시점으로 다시 맞춘다

  const marks = new Map();
  proposal.diff.forEach((r) => {
    if (r.type === 'add') marks.set(r.level, 'added');
    if (r.type === 'change') marks.set(r.level, 'changed');
  });
  renderLayerPanel({ floors: proposal.floors }, marks);
}

function siteDims(site) {
  if (site.boundary?.length) {
    const b = ringBBox(site.boundary);
    return { sw: b.maxX - b.minX, sd: b.maxZ - b.minZ };
  }
  if (site.siteWidth && site.siteDepth) return { sw: site.siteWidth, sd: site.siteDepth };
  const s = Math.sqrt(site.siteArea);
  return { sw: s, sd: s };
}

function closePreview() {
  pendingProposal = null;
  previewPanel.hidden = true;
  previewFloors.innerHTML = '';
  previewTotals.innerHTML = '';
  previewWarnings.innerHTML = '';
}

function applyPreview() {
  if (!pendingProposal) return;
  const proposal = pendingProposal;
  closePreview();
  history.push(snapshot());
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  prevValues = computeValues(currentSpec.site, currentSpec.floors);
  currentSpec = { ...currentSpec, floors: proposal.floors };
  rev += 1;
  renderSpec(currentSpec, proposal.touched, true);
  setView('bird');
  appendMessage('system', escapeHtml(`수정안을 적용했습니다. (REV ${String(rev).padStart(2, '0')})`));
  saveDesign();
}

function cancelPreview() {
  if (!pendingProposal) return;
  closePreview();
  renderSpec(currentSpec);
  setView('bird');
  appendMessage('system', escapeHtml(`수정안을 취소했습니다. 현재 설계(REV ${String(rev).padStart(2, '0')})를 그대로 유지합니다.`));
  saveDesign();
}

previewApply.addEventListener('click', applyPreview);
previewCancel.addEventListener('click', cancelPreview);
previewWarnings.addEventListener('click', (e) => {
  if (!e.target.closest('[data-fix]') || !pendingProposal) return;
  sendChat(pendingProposal.warnings.map((w) => w.ask).join(' '));
});

// ---- 대안 비교 창: 같은 대지 조건의 3개 안을 3D + 면적으로 나란히 비교하고 하나를 채택 ----
function buildMassObject(spec) {
  const group = new THREE.Group();
  const site = spec.site;
  const { sw, sd } = siteDims(site);

  group.add(buildSiteOutline(site, sw, sd)); // 실제 필지면 그 모양 그대로
  group.add(new THREE.GridHelper(Math.max(sw, sd) * 2, 20, 0x20313a, 0x1a272e));

  const addFloor = (f, centerY) => {
    const geo = floorGeometry(f); // 다각형 층도 그대로 세운다
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xede8dc, roughness: 0.85, metalness: 0.05 }));
    mesh.position.set(f.shape ? 0 : f.offsetX || 0, centerY, f.shape ? 0 : f.offsetZ || 0);
    mesh.rotation.y = f.shape ? 0 : THREE.MathUtils.degToRad(f.rotationDeg || 0);
    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x0b1014 }));
    line.position.copy(mesh.position);
    line.rotation.copy(mesh.rotation);
    group.add(mesh, line);
  };

  let y = 0;
  spec.floors.filter((f) => f.level > 0).sort((a, b) => a.level - b.level).forEach((f) => {
    addFloor(f, y + f.height / 2);
    y += f.height;
  });
  let yTop = 0;
  spec.floors.filter((f) => f.level < 0).sort((a, b) => b.level - a.level).forEach((f) => {
    addFloor(f, yTop - f.height / 2);
    yTop -= f.height;
  });
  return { group, height: y, diag: Math.max(Math.hypot(sw, sd), ...spec.floors.map(floorDiag)) };
}

function createCompareView(container, spec, frame) {
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(30, 50, 20);
  const rim = new THREE.DirectionalLight(0x57c2d6, 0.25);
  rim.position.set(-30, 20, -20);
  scene.add(key, rim, buildMassObject(spec).group);

  const cam = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 4000);
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  r.setPixelRatio(window.devicePixelRatio);
  r.setSize(container.clientWidth, container.clientHeight);
  container.appendChild(r.domElement);

  const ctrl = new OrbitControls(cam, r.domElement);
  ctrl.target.set(0, frame.targetY, 0);
  const phi = THREE.MathUtils.degToRad(VIEW_PRESETS.bird.phi);
  const theta = THREE.MathUtils.degToRad(VIEW_PRESETS.bird.theta);
  cam.position.set(
    frame.radius * Math.sin(phi) * Math.sin(theta),
    frame.targetY + frame.radius * Math.cos(phi),
    frame.radius * Math.sin(phi) * Math.cos(theta)
  );
  ctrl.update();
  return { scene, camera: cam, renderer: r, controls: ctrl, container };
}

// 세 화면이 같은 각도·거리로 함께 돌도록 카메라를 동기화한다.
let syncingViews = false;
function syncViews(source) {
  if (syncingViews) return;
  syncingViews = true;
  compareViews.forEach((v) => {
    if (v === source) return;
    v.camera.position.copy(source.camera.position);
    v.controls.target.copy(source.controls.target);
    v.controls.update();
  });
  syncingViews = false;
}

function metricRows(values, site, derived, best) {
  const mark = (on, text) => (on ? `<span class="best">${text}</span>` : '');
  const gfaPct = derived.maxFloorArea ? Math.min(100, (values.gfa / derived.maxFloorArea) * 100) : 0;
  const over = (v, lim, tol) => (lim != null && v > lim + tol ? ' class="over"' : '');
  return `
    <tr><th>층수</th><td${over(values.floorCount, site.maxFloors, 0.5)}>${fmt(values.floorCount, 0)}층${site.maxFloors ? `<span class="lim">/ 최대 ${site.maxFloors}층</span>` : ''}</td></tr>
    <tr><th>최고 높이</th><td${over(values.height, site.maxHeight, 0.05)}>${fmt(values.height, 1)}m${site.maxHeight ? `<span class="lim">/ 최대 ${site.maxHeight}m</span>` : ''}${mark(best.lowest, '가장 낮음')}</td></tr>
    <tr><th>건축면적 (건폐율)</th><td${over(values.buildArea, derived.maxBuildingArea, 0.5)}>${fmt(values.buildArea, 1)}㎡ (${fmt(values.bcr, 1)}%)<span class="lim">/ ${fmt(site.coverageRatio, 0)}%</span></td></tr>
    <tr><th>연면적 (용적률)</th><td${over(values.gfa, derived.maxFloorArea, 0.5)}>${fmt(values.gfa, 1)}㎡ (${fmt(values.far, 1)}%)<span class="lim">/ ${fmt(site.farRatio, 0)}%</span>${mark(best.gfa, '가장 넓음')}
      <div class="bar" title="법정 최대 연면적 대비 ${fmt(gfaPct, 0)}%"><i style="width:${gfaPct.toFixed(1)}%"></i></div></td></tr>
    <tr><th>빈 대지 (마당·조경)</th><td>${fmt(values.siteArea - values.buildArea, 1)}㎡${mark(best.open, '가장 넓음')}</td></tr>
    <tr><th>층 바닥 크기</th><td>${fmt(values.minPlate, 1)} ~ ${fmt(values.maxPlate, 1)}㎡</td></tr>`;
}

// 비교 카드 목록: 첫 장은 항상 현재안, 그 뒤가 대안이다.
// { key, name, sub, concept, pros, cons, spec, current?, note? }
let compareAlts = [];
let lastCompareAsk = '';

function currentCard() {
  return {
    key: 'current',
    name: '현재안',
    sub: `지금 화면의 설계 (REV ${String(rev).padStart(2, '0')})`,
    concept: '비교 기준입니다. 대안이 마음에 들지 않으면 그대로 두면 됩니다.',
    pros: [],
    cons: [],
    spec: currentSpec,
    current: true
  };
}

function compareSiteText(site, derived) {
  return (
    `대지 ${fmt(site.siteArea, 1)}㎡ · 건폐율 ${fmt(site.coverageRatio, 0)}% (최대 ${fmt(derived.maxBuildingArea, 1)}㎡) · ` +
    `용적률 ${fmt(site.farRatio, 0)}% (최대 ${fmt(derived.maxFloorArea, 1)}㎡)` +
    (site.maxFloors ? ` · 최대 ${site.maxFloors}층` : '') +
    (site.maxHeight ? ` · 최고 높이 ${site.maxHeight}m` : '') +
    ` · 층고 ${fmt(site.floorHeight || 3.3, 1)}m` +
    (site.boundary?.length ? ' · 실제 필지 경계' : '')
  );
}

function renderCompareCards(cards) {
  disposeCompareViews();
  compareAlts = cards;
  const site = currentSpec.site;
  compareSite.textContent = compareSiteText(site, currentSpec.derived);

  const values = cards.map((a) => {
    const v = computeValues(site, a.spec.floors);
    const plates = a.spec.floors.filter((f) => f.level > 0).map(plateArea);
    return { ...v, minPlate: plates.length ? Math.min(...plates) : 0, maxPlate: plates.length ? Math.max(...plates) : 0 };
  });
  // 안들 사이에 의미 있는 차이(최댓값의 1% 이상)가 있을 때만 "가장 ~" 표시를 붙인다.
  const pickBest = (arr, dir) => {
    const hi = Math.max(...arr);
    const target = dir > 0 ? hi : Math.min(...arr);
    const distinct = hi - Math.min(...arr) > hi * 0.01;
    return arr.map((x) => distinct && Math.abs(x - target) <= hi * 0.005);
  };
  const bestGfa = pickBest(values.map((v) => v.gfa), 1);
  const bestLow = pickBest(values.map((v) => v.height), -1);
  const bestOpen = pickBest(values.map((v) => v.siteArea - v.buildArea), 1);

  compareGrid.innerHTML = cards
    .map((a, i) => {
      const label = a.current ? '현재안' : `안 ${String.fromCharCode(64 + i)}`;
      const text =
        (a.concept ? `<h3>의도</h3><p>${escapeHtml(a.concept)}</p>` : '') +
        (a.pros?.length ? `<h3 class="pro">장점</h3><ul>${a.pros.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '') +
        (a.cons?.length ? `<h3 class="con">단점</h3><ul>${a.cons.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>` : '') +
        (a.note ? `<p class="alt-fail">${escapeHtml(a.note)}</p>` : '');
      return `
    <article class="alt-card${a.current ? ' current' : ''}" data-alt="${escapeHtml(a.key)}">
      <div class="alt-head">
        <span class="tag">${label}</span>
        <h2>${escapeHtml(a.name)}</h2>
        <p class="alt-sub">${escapeHtml(a.sub || '')}</p>
      </div>
      <div class="alt-view" aria-label="${escapeHtml(a.name)} 3D 미리보기"></div>
      <table class="alt-metrics">${metricRows(values[i], site, a.spec.derived, { gfa: bestGfa[i], lowest: bestLow[i], open: bestOpen[i] })}</table>
      <div class="alt-text">${text}</div>
      <div class="alt-foot">${
        a.current
          ? '<button class="btn" type="button" disabled>현재 설계</button>'
          : `<button class="btn primary" type="button" data-adopt="${i}">이 안 채택</button>`
      }</div>
    </article>`;
    })
    .join('');

  // 모든 안을 같은 축척으로 — 가장 크고 높은 안에 맞춰 카메라 거리를 공통으로 잡는다.
  const sizes = cards.map((a) => buildMassObject(a.spec));
  const maxH = Math.max(...sizes.map((x) => x.height));
  const maxDiag = Math.max(...sizes.map((x) => x.diag));
  const frame = { targetY: maxH / 2, radius: Math.max(maxDiag, maxH, 10) * 1.5 + 6 };
  compareViews = [...compareGrid.querySelectorAll('.alt-view')].map((c, i) => createCompareView(c, cards[i].spec, frame));
  compareViews.forEach((v) => v.controls.addEventListener('change', () => syncViews(v)));
}

// LLM에게 "요청에 맞는 서로 다른 세 안"을 받아 현재안과 나란히 놓는다.
async function requestAlternatives(instruction) {
  compareRun.disabled = true;
  compareRules.disabled = true;
  compareGrid.innerHTML = '<p class="alt-busy">요청에 맞는 세 가지 안을 만드는 중입니다...</p>';
  disposeCompareViews();

  try {
    const res = await fetch('/api/alternatives', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentSpec,
        instruction,
        model: modelInput.value.trim(),
        provider: providerSelect.value,
        key: userKeys[providerSelect.value] || ''
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
    if (!res.ok) throw new Error(data.error || `대안 생성 실패 (${res.status})`);

    const cards = data.options.map((o, i) => {
      const changes = (o.changes || []).filter((c) => !isNoop(c, currentSpec.floors));
      const { floors } = applyChanges(currentSpec.floors, changes);
      return {
        key: `llm${i}`,
        name: o.name,
        sub: changes.length ? `${changes.length}개 층 변경` : '현재안과 같음',
        concept: o.concept,
        pros: o.pros,
        cons: o.cons,
        spec: { ...currentSpec, floors },
        note: changes.length ? '' : '모델이 현재안과 같은 형태를 냈습니다. 요청을 더 구체적으로 적어 보세요.'
      };
    });
    lastCompareAsk = instruction;
    renderCompareCards([currentCard(), ...cards]);
    appendMessage(
      'system',
      escapeHtml(`대안 3안을 만들었습니다${instruction ? `: "${instruction}"` : ''} — 비교 창에서 채택할 수 있습니다.`)
    );
  } catch (e) {
    renderCompareCards([currentCard()]);
    compareGrid.insertAdjacentHTML(
      'beforeend',
      `<p class="alt-fail">${escapeHtml(e.message)}<br>키를 확인하거나, "기본 3안"으로 규칙 기반 대안을 볼 수 있습니다.</p>`
    );
  } finally {
    compareRun.disabled = false;
    compareRules.disabled = false;
  }
}

// AI 없이 규칙으로 만드는 기본 3안(균형형·테라스형·포디움+타워)
function showRuleAlternatives() {
  const alts = buildAlternativeSpecs(currentSpec.site).map((a) => ({
    key: a.key,
    name: a.name,
    sub: a.sub,
    concept: a.intent,
    pros: a.pros,
    cons: a.cons,
    spec: a.spec
  }));
  renderCompareCards([currentCard(), ...alts]);
}

function openCompare() {
  if (!currentSpec) return;
  compareOverlay.hidden = false;
  compareInput.value = lastCompareAsk;
  renderCompareCards([currentCard()]);
  compareInput.focus();
  requestAlternatives(compareInput.value.trim());
}

function disposeCompareViews() {
  compareViews.forEach((v) => {
    v.controls.dispose();
    v.renderer.dispose();
    v.renderer.forceContextLoss();
  });
  compareViews = [];
}

compareAsk.addEventListener('submit', (e) => {
  e.preventDefault();
  requestAlternatives(compareInput.value.trim());
});
compareRules.addEventListener('click', () => showRuleAlternatives());

function closeCompare() {
  disposeCompareViews();
  compareGrid.innerHTML = '';
  compareOverlay.hidden = true;
  compareBtn.focus();
}

// 한글 마지막 글자의 받침 유무로 목적격 조사(을/를)를 고른다.
function objParticle(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0 ? '을' : '를';
}

function adoptAlternative(alt) {
  history.push(snapshot());
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  prevValues = computeValues(currentSpec.site, currentSpec.floors);
  currentSpec = cloneSpec(alt.spec);
  rev += 1;
  closeCompare();
  renderSpec(currentSpec, new Set(currentSpec.floors.map((f) => f.level)), true);
  setView('bird');
  appendMessage(
    'assistant',
    `<strong>대안 「${escapeHtml(alt.name)}」${objParticle(alt.name)} 채택했습니다.</strong>` +
      `<p style="margin:6px 0 0">${escapeHtml(alt.intent)} 마음에 들지 않으면 되돌리기로 이전 설계로 돌아갈 수 있습니다.</p>`,
    `대안 · REV ${String(rev).padStart(2, '0')}`
  );
  saveDesign();
}

compareBtn.addEventListener('click', openCompare);
compareClose.addEventListener('click', closeCompare);
compareGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-adopt]');
  if (btn) adoptAlternative(compareAlts[Number(btn.dataset.adopt)]);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !compareOverlay.hidden) closeCompare();
});
window.addEventListener('resize', () => {
  compareViews.forEach((v) => {
    v.camera.aspect = v.container.clientWidth / v.container.clientHeight;
    v.camera.updateProjectionMatrix();
    v.renderer.setSize(v.container.clientWidth, v.container.clientHeight);
  });
});

// ---- 층 직접 편집: 층 선택 → 숫자 입력 또는 면 밀고 당기기(스케치업 Push/Pull) → 면적 재계산 + 되돌리기 ----
const FE_RULES = {
  width: { min: 0.5, max: 1000, label: '폭' },
  depth: { min: 0.5, max: 1000, label: '깊이' },
  height: { min: 2, max: 14, label: '층고' },
  offsetX: { min: -1000, max: 1000, label: '위치 X' },
  offsetZ: { min: -1000, max: 1000, label: '위치 Z' }
};
const round2 = (v) => Math.round(v * 100) / 100;

// AI 수정안 검토 중·응답 대기 중·대안 비교 중에는 직접 편집하지 않는다.
function canEditFloors() {
  return !!currentSpec && !pendingProposal && !busy && compareOverlay.hidden;
}

function selectFloor(level) {
  if (level != null && !canEditFloors()) return;
  if (level !== selectedLevel) faceEditLevel = null; // 다른 층을 고르면 면 수정은 꺼진다
  selectedLevel = level;
  renderSpec(currentSpec, null, false, { keepCamera: true });
  showEditHint();
}

// 면 수정 켜기/끄기 — 더블클릭, 층 목록 더블클릭, 안내 줄 버튼에서 모두 이 함수를 쓴다.
function setFaceEdit(level) {
  faceEditLevel = level;
  if (level == null) faceHighlight.visible = false;
  renderSpec(currentSpec, null, false, { keepCamera: true });
  showEditHint();
}

// 3D 안내 한 줄 — 도구 창 대신 지금 할 수 있는 조작만 알려 준다.
function showEditHint() {
  if (!editHint) return;
  if (!canEditFloors() || selectedLevel == null) {
    editHint.hidden = true;
    return;
  }
  const label = floorLabel(selectedLevel);
  const on = faceEditLevel === selectedLevel;
  editHint.innerHTML =
    (on
      ? `<b>${label}</b> 면 수정 중 — 옆면을 끌면 폭·깊이, 윗면은 층고. 화살표로 이동.`
      : `<b>${label}</b> 선택됨 — 화살표로 이동, <b>더블클릭</b>하면 면을 수정합니다.`) +
    ` <button type="button" id="faceEditToggle">${on ? '면 수정 끄기 (Esc)' : '면 수정 켜기'}</button>`;
  editHint.hidden = false;
}

function updateFloorEditor(spec) {
  const f = selectedLevel != null ? spec.floors.find((x) => x.level === selectedLevel) : null;
  if (!f) {
    floorEditor.hidden = true;
    return;
  }
  floorEditor.hidden = false;
  feTitle.innerHTML = `${floorLabel(f.level)} 편집${f.use ? `<small>${escapeHtml(f.use)}</small>` : ''}`;
  const shown = editorValues(f);
  FE_FIELDS.forEach((k) => {
    const input = el(`fe_${k}`);
    if (document.activeElement !== input) input.value = round2(shown[k] || 0);
    input.classList.remove('invalid');
  });
  feError.hidden = true;
  feArea.textContent = `${fmt(plateArea(f), 1)}㎡`;
  const warnings = checkLimits(spec.site, spec.derived, spec.floors);
  feWarn.hidden = !warnings.length;
  feWarn.innerHTML = warnings
    .map((w) => `<div>⚠ ${escapeHtml(w.label)} ${escapeHtml(w.excess)} 초과<br>${escapeHtml(w.fix)}</div>`)
    .join('');
}

// 다각형 층은 폭·깊이를 외접 사각형, 위치를 중심으로 환산해 보여준다.
function editorValues(f) {
  if (!f.shape) return f;
  const { width, depth } = floorSize(f);
  const [cx, cz] = polyCentroid(f.shape);
  return { width, depth, height: f.height, offsetX: +cx.toFixed(2), offsetZ: +cz.toFixed(2) };
}

// 한 번의 편집 = 되돌리기 한 단계. 층 하나의 값만 바꾸고 나머지 층은 그대로 둔다.
function commitFloorEdit(level, patch) {
  const idx = currentSpec.floors.findIndex((f) => f.level === level);
  if (idx < 0) return;
  const before = currentSpec.floors[idx];
  // 다각형 층이면 폭·깊이·위치 변경을 shape에 반영한다(층고·용도는 그대로 필드).
  const after = before.shape
    ? { ...before, ...('height' in patch ? { height: patch.height } : {}), shape: patch.shape || transformShape(before.shape, patch) }
    : { ...before, ...patch };
  const [row] = diffFloors([before], [{ ...after, _src: before.level }]);
  if (!row) {
    renderSpec(currentSpec, null, false, { keepCamera: true });
    return;
  }
  history.push(snapshot());
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  prevValues = computeValues(currentSpec.site, currentSpec.floors);
  currentSpec = { ...currentSpec, floors: currentSpec.floors.map((f, i) => (i === idx ? after : f)) };
  rev += 1;
  renderSpec(currentSpec, null, true, { keepCamera: true });

  const now = computeValues(currentSpec.site, currentSpec.floors);
  appendMessage(
    'assistant',
    `<strong>${floorLabel(level)} 직접 수정</strong><br>${row.diffs.map(escapeHtml).join('<br>')}` +
      `<p style="margin:6px 0 0">바닥 ${signed(row.area, 1, '㎡')} → 연면적 ${fmt(now.gfa, 1)}㎡ (용적률 ${fmt(now.far, 1)}%) · 최고 높이 ${fmt(now.height, 1)}m</p>`,
    `직접 수정 · REV ${String(rev).padStart(2, '0')}`
  );
  saveDesign();
}

FE_FIELDS.forEach((key) => {
  const input = el(`fe_${key}`);
  input.addEventListener('change', () => {
    if (selectedLevel == null || !canEditFloors()) return;
    const rule = FE_RULES[key];
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(v) || v < rule.min || v > rule.max) {
      input.classList.add('invalid');
      feError.hidden = false;
      const topic = objParticle(rule.label) === '을' ? '은' : '는';
      feError.textContent = `${rule.label}${topic} ${rule.min}~${rule.max}m 사이 숫자여야 합니다. 기존 값을 유지합니다.`;
      return;
    }
    // 숫자 입력은 중심을 기준으로 바꾼다(한쪽 면을 고정하려면 3D에서 면을 끌면 된다).
    commitFloorEdit(selectedLevel, { [key]: round2(v) });
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur(); // blur → change 이벤트로 반영
  });
});

feClose.addEventListener('click', () => selectFloor(null));

editHint.addEventListener('click', (e) => {
  if (!e.target.closest('#faceEditToggle') || selectedLevel == null) return;
  setFaceEdit(faceEditLevel === selectedLevel ? null : selectedLevel);
});


// 층 목록: 처음 클릭하면 선택, 선택된 층을 다시 클릭하면 면 수정이 켜지고/꺼진다.
// (클릭할 때마다 목록을 다시 그리기 때문에 더블클릭은 성립하지 않는다)
layerPanel.addEventListener('click', (e) => {
  const row = e.target.closest('[data-level]');
  if (!row || !canEditFloors()) return;
  const level = Number(row.dataset.level);
  if (level !== selectedLevel) {
    selectFloor(level);
    return;
  }
  setFaceEdit(faceEditLevel === level ? null : level);
});
layerPanel.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-level]')) {
    e.preventDefault();
    e.target.click();
  }
});

// -- 3D에서 층 선택 + 면 밀고 당기기 --
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const faceHighlight = new THREE.Mesh(
  new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ color: 0x57c2d6, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthTest: false })
);
faceHighlight.renderOrder = 5;
faceHighlight.visible = false;
scene.add(faceHighlight);

let drag = null; // 면을 끄는 중: { level, axis, localNormal, worldNormal, start, plane, orig, patch, pointerId }
let downAt = null; // 캔버스를 누른 위치(클릭인지 시점 회전인지 구분)
// ---- 검볼(라이노식 이동 화살표) — 선택한 층을 동·서·남·북으로 옮긴다 ----

function makeArrow(dir, color) {
  const arrow = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 10), mat);
  shaft.position.y = 0.5;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 12), mat);
  head.position.y = 1.55;
  // 집기 쉬우라고 보이지 않는 굵은 기둥을 덧댄다(얇은 화살표를 정확히 찍지 않아도 잡힌다)
  const grab = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.1, 8), new THREE.MeshBasicMaterial({ visible: false }));
  grab.position.y = 1.05;
  arrow.add(shaft, head, grab);
  arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  arrow.userData.dir = dir.clone();
  arrow.userData.axis = Math.abs(dir.x) > 0.5 ? 'x' : 'z';
  arrow.userData.sign = dir.x + dir.z > 0 ? 1 : -1;
  arrow.renderOrder = 6;
  arrow.traverse((o) => {
    o.renderOrder = 6;
    o.userData.gizmo = arrow;
  });
  return arrow;
}

function ensureGizmo() {
  if (gizmoGroup) return gizmoGroup;
  gizmoGroup = new THREE.Group();
  gizmoGroup.visible = false;
  [
    [new THREE.Vector3(1, 0, 0), 0xe2604a],
    [new THREE.Vector3(-1, 0, 0), 0xe2604a],
    [new THREE.Vector3(0, 0, 1), 0x57c2d6],
    [new THREE.Vector3(0, 0, -1), 0x57c2d6]
  ].forEach(([dir, color]) => gizmoGroup.add(makeArrow(dir, color)));
  scene.add(gizmoGroup);
  return gizmoGroup;
}

// 선택한 층의 중심에 검볼을 놓는다. 크기는 층 크기에 맞춰 조금씩 키운다.
function updateGizmo(spec = currentSpec) {
  const f = selectedLevel != null ? spec.floors.find((x) => x.level === selectedLevel) : null;
  if (!f) {
    if (gizmoGroup) gizmoGroup.visible = false;
    return;
  }
  ensureGizmo();
  const { width, depth } = floorSize(f);
  const center = f.shape ? polyCentroid(f.shape) : [f.offsetX || 0, f.offsetZ || 0];
  let y = 0;
  stackFloors(spec.floors, (x, centerY) => {
    if (x.level === f.level) y = centerY;
  });
  const s = clamp(Math.max(width, depth) * 0.12, 0.9, 4);
  gizmoGroup.position.set(center[0], y, center[1]);
  gizmoGroup.scale.setScalar(s);
  // 화살표는 층 바깥쪽에서 시작하도록 방향만큼 밀어낸다(매스에 가려지지 않게).
  gizmoGroup.children.forEach((arrow) => {
    const reach = (arrow.userData.axis === 'x' ? width : depth) / 2 / s + 0.4;
    arrow.position.copy(arrow.userData.dir).multiplyScalar(reach);
  });
  gizmoGroup.visible = true;
}

function setRay(ev) {
  // 방금 다시 그린 매스나 막 움직인 카메라는 다음 렌더 프레임 전까지 월드 행렬이 옛값이므로 먼저 갱신한다.
  camera.updateMatrixWorld();
  massGroup.updateMatrixWorld(true);
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNdc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointerNdc, camera);
}

function pickFloor(ev) {
  setRay(ev);
  const meshes = massGroup.children.filter((o) => o.isMesh && o.userData.level != null);
  return raycaster.intersectObjects(meshes, false)[0] || null;
}

// 면의 로컬 법선 → 바뀌는 값. 아랫면은 아래층과 맞닿아 있어 밀고 당기기 대상에서 뺀다.
// 면의 법선 → 바뀌는 값. 다각형 층은 변이 비스듬해 법선이 축과 딱 맞지 않으므로 가장 가까운 축으로 본다.
// (한 변의 삼각형 조각 하나가 아니라 그 방향의 "면 전체"를 잡게 하려는 것)
function faceAxis(n, isPolygon) {
  if (n.y > 0.5) return 'height';
  if (n.y < -0.5) return null; // 아랫면은 아래층과 맞닿아 있어 제외
  if (isPolygon) return Math.abs(n.x) >= Math.abs(n.z) ? 'width' : 'depth';
  if (Math.abs(n.x) > 0.5) return 'width';
  if (Math.abs(n.z) > 0.5) return 'depth';
  return null;
}

// 끌 수 있는 면을 반투명 청록 판으로 덮는다.
// 다각형 층은 그 방향의 외곽(외접 사각형 한 면) 전체를 덮어, 조각난 변이 아니라 면 전체를 잡는 느낌을 준다.
function placeHighlight(mesh, n, floor) {
  const isPoly = !!floor?.shape;
  const axis = faceAxis(n, isPoly);
  if (!axis) {
    faceHighlight.visible = false;
    return null;
  }
  mesh.updateMatrixWorld();

  if (isPoly) {
    const b = polyBBox(floor.shape);
    const sign = axis === 'width' ? Math.sign(n.x) || 1 : axis === 'depth' ? Math.sign(n.z) || 1 : 1;
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const y = mesh.position.y;
    if (axis === 'height') {
      faceHighlight.position.set(cx, y + floor.height / 2 + 0.05, cz);
      faceHighlight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
      faceHighlight.scale.set(b.maxX - b.minX, b.maxZ - b.minZ, 1);
    } else if (axis === 'width') {
      faceHighlight.position.set(sign > 0 ? b.maxX + 0.05 : b.minX - 0.05, y, cz);
      faceHighlight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(sign, 0, 0));
      faceHighlight.scale.set(b.maxZ - b.minZ, floor.height, 1);
    } else {
      faceHighlight.position.set(cx, y, sign > 0 ? b.maxZ + 0.05 : b.minZ - 0.05);
      faceHighlight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, sign));
      faceHighlight.scale.set(b.maxX - b.minX, floor.height, 1);
    }
    faceHighlight.visible = true;
    return axis;
  }

  const p = mesh.geometry.parameters;
  const local = new THREE.Vector3((n.x * p.width) / 2, (n.y * p.height) / 2, (n.z * p.depth) / 2).addScaledVector(n, 0.03);
  faceHighlight.position.copy(mesh.localToWorld(local));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
  faceHighlight.quaternion.copy(mesh.quaternion).multiply(q);
  if (axis === 'width') faceHighlight.scale.set(p.depth, p.height, 1);
  else if (axis === 'depth') faceHighlight.scale.set(p.width, p.height, 1);
  else faceHighlight.scale.set(p.width, p.depth, 1);
  faceHighlight.visible = true;
  return axis;
}

// capture 단계에서 먼저 받아, 선택한 층의 면을 누른 경우에는 OrbitControls가 시점 회전을 시작하지 않게 막는다.
viewport.addEventListener(
  'pointerdown',
  (ev) => {
    if (ev.button !== 0 || ev.target !== renderer.domElement || !canEditFloors()) return;
    downAt = { x: ev.clientX, y: ev.clientY };
    if (selectedLevel == null) return;

    // 1순위: 검볼 화살표를 잡았는가 (층 이동)
    const arrow = pickGizmo(ev);
    if (arrow) {
      ev.stopPropagation();
      startArrowDrag(ev, arrow);
      return;
    }

    // 2순위: 더블클릭으로 "면 수정"을 켠 층의 면을 잡았는가
    if (faceEditLevel !== selectedLevel) return;
    const hit = pickFloor(ev);
    if (!hit || hit.object.userData.level !== selectedLevel) return;
    const floor = currentSpec.floors.find((f) => f.level === selectedLevel);
    const axis = faceAxis(hit.face.normal, !!floor.shape);
    if (!axis) return;

    ev.stopPropagation();
    const localNormal = hit.face.normal.clone();
    const worldNormal = localNormal.clone().applyQuaternion(hit.object.quaternion).normalize();
    // 끄는 방향(면 법선)을 포함하면서 화면을 가장 정면으로 보는 평면 위에서 마우스를 추적한다.
    const camDir = camera.getWorldDirection(new THREE.Vector3());
    const planeNormal = camDir.clone().addScaledVector(worldNormal, -camDir.dot(worldNormal));
    if (planeNormal.lengthSq() < 1e-6) planeNormal.set(0, 1, 0);
    drag = {
      level: selectedLevel,
      axis,
      localNormal,
      worldNormal,
      start: hit.point.clone(),
      plane: new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal.normalize(), hit.point),
      orig: { ...floor },
      patch: null,
      pointerId: ev.pointerId
    };
    downAt = null;
    viewport.classList.add('pulling');
    try {
      viewport.setPointerCapture(ev.pointerId); // 화면 밖으로 끌어도 계속 추적
    } catch (e) {
      // 캡처할 수 없는 포인터(합성 이벤트 등)는 일반 이벤트로 추적한다
    }
    prevValues = computeValues(currentSpec.site, currentSpec.floors);
  },
  true
);

viewport.addEventListener('pointermove', (ev) => {
  if (drag) {
    updateDrag(ev);
    return;
  }
  viewport.classList.remove('can-pull', 'can-pick', 'can-move');
  if (ev.target !== renderer.domElement || ev.buttons || !canEditFloors()) {
    faceHighlight.visible = false;
    return;
  }
  if (pickGizmo(ev)) {
    faceHighlight.visible = false;
    viewport.classList.add('can-move'); // 이동 화살표 위
    return;
  }
  const hit = pickFloor(ev);
  const floor = hit ? currentSpec.floors.find((x) => x.level === hit.object.userData.level) : null;
  if (hit && hit.object.userData.level === selectedLevel && faceEditLevel === selectedLevel) {
    viewport.classList.toggle('can-pull', !!placeHighlight(hit.object, hit.face.normal, floor));
  } else {
    faceHighlight.visible = false;
    if (hit) viewport.classList.add('can-pick');
  }
});

// 검볼 화살표 집기 — 화살표(보이지 않는 굵은 기둥 포함)만 대상으로 한다.
// 화살표와 매스가 겹쳐 보일 때는 카메라에 더 가까운 쪽을 집는다.
// (화살표는 얇아서 살짝 우선권만 준다 — GIZMO_BIAS 만큼)
const GIZMO_BIAS = 0.4;
function pickGizmoHit(ev) {
  if (!gizmoGroup?.visible || selectedLevel == null) return null;
  setRay(ev);
  gizmoGroup.updateMatrixWorld(true);
  return raycaster.intersectObjects(gizmoGroup.children, true)[0] || null;
}

function pickGizmo(ev) {
  const g = pickGizmoHit(ev);
  if (!g) return null;
  const floorHit = pickFloor(ev); // setRay를 다시 하지만 같은 좌표라 결과는 같다
  if (floorHit && floorHit.distance + GIZMO_BIAS < g.distance) return null; // 매스가 확실히 앞에 있으면 면 우선
  return g.object.userData.gizmo || g.object.parent;
}

// 화살표를 잡는 순간의 "손잡은 위치"를 기억해 두고, 이후에는 그 차이만큼만 옮긴다.
// (잡자마자 층이 커서 위치로 튀는 것을 막는다)
function startArrowDrag(ev, arrow) {
  const floor = currentSpec.floors.find((f) => f.level === selectedLevel);
  if (!floor) return;
  const axis = arrow.userData.axis; // 'x' | 'z'
  const axisVec = axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const camDir = camera.getWorldDirection(new THREE.Vector3());
  const planeNormal = camDir.clone().addScaledVector(axisVec, -camDir.dot(axisVec));
  if (planeNormal.lengthSq() < 1e-6) planeNormal.set(0, 1, 0);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormal.normalize(), gizmoGroup.position.clone());

  setRay(ev);
  const grab = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  if (!grab) return;

  const center = floor.shape ? polyCentroid(floor.shape) : [floor.offsetX || 0, floor.offsetZ || 0];
  drag = {
    kind: 'move',
    level: selectedLevel,
    axis,
    axisVec,
    plane,
    grabValue: grab.dot(axisVec), // 잡은 순간의 축 좌표
    startCenter: center,
    orig: { ...floor },
    patch: null,
    pointerId: ev.pointerId
  };
  downAt = null;
  viewport.classList.add('pulling');
  try {
    viewport.setPointerCapture(ev.pointerId);
  } catch (e) {
    // 캡처 불가 포인터는 일반 이벤트로 추적
  }
  prevValues = computeValues(currentSpec.site, currentSpec.floors);
}

function updateArrowDrag(ev) {
  setRay(ev);
  const p = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!p) return;
  const step = ev.shiftKey ? 1 : 0.1;
  const delta = Math.round((p.dot(drag.axisVec) - drag.grabValue) / step) * step; // 잡은 지점 기준 상대 이동
  const o = drag.orig;
  const dx = drag.axis === 'x' ? delta : 0;
  const dz = drag.axis === 'z' ? delta : 0;
  drag.patch = o.shape
    ? { shape: translatePoly(o.shape, dx, dz) }
    : { offsetX: round2((o.offsetX || 0) + dx), offsetZ: round2((o.offsetZ || 0) + dz) };

  const floors = currentSpec.floors.map((f) => (f.level === drag.level ? { ...f, ...drag.patch } : f));
  renderSpec({ ...currentSpec, floors }, null, true, { keepCamera: true });

  const moved = drag.axis === 'x' ? dx : dz;
  const name = drag.axis === 'x' ? '동서(X)' : '남북(Z)';
  const target = drag.startCenter[drag.axis === 'x' ? 0 : 1] + moved;
  dragLabel.innerHTML =
    `${name} 이동 <b>${signed(moved, 1, 'm')}</b> <span class="${moved >= 0 ? 'plus' : 'minus'}">(중심 ${fmt(target, 1)}m)</span>`;
  const vp = viewport.getBoundingClientRect();
  dragLabel.style.left = `${ev.clientX - vp.left}px`;
  dragLabel.style.top = `${ev.clientY - vp.top}px`;
  dragLabel.hidden = false;
}

function updateDrag(ev) {
  if (drag.kind === 'move') {
    updateArrowDrag(ev);
    return;
  }
  setRay(ev);
  const p = raycaster.ray.intersectPlane(drag.plane, new THREE.Vector3());
  if (!p) return;
  const step = ev.shiftKey ? 1 : 0.1;
  const delta = Math.round(p.sub(drag.start).dot(drag.worldNormal) / step) * step;
  const o = drag.orig;
  let patch;
  if (drag.axis === 'height') {
    patch = { height: round2(clamp(o.height + delta, FE_RULES.height.min, FE_RULES.height.max)) };
  } else if (o.shape) {
    // 다각형 층: 끈 반대쪽 변을 고정한 채 그 방향으로만 늘리고 줄인다.
    const b = polyBBox(o.shape);
    const along = drag.axis === 'width' ? { size: b.maxX - b.minX, lo: b.minX, hi: b.maxX } : { size: b.maxZ - b.minZ, lo: b.minZ, hi: b.maxZ };
    const positive = (drag.axis === 'width' ? drag.worldNormal.x : drag.worldNormal.z) > 0;
    const next = Math.max(FE_RULES[drag.axis].min, along.size + delta);
    const k = along.size > 0.01 ? next / along.size : 1;
    const anchor = positive ? [along.lo, along.lo] : [along.hi, along.hi];
    const about = drag.axis === 'width' ? [anchor[0], 0] : [0, anchor[0]];
    patch = { shape: drag.axis === 'width' ? scalePoly(o.shape, k, 1, about) : scalePoly(o.shape, 1, k, about) };
  } else {
    const size = drag.axis;
    const next = round2(Math.max(FE_RULES[size].min, o[size] + delta));
    const actual = next - o[size];
    // 반대쪽 면을 고정: 중심을 끈 방향으로 늘어난 길이의 절반만큼 옮긴다(회전된 층도 월드 좌표로 계산).
    patch = {
      [size]: next,
      offsetX: round2((o.offsetX || 0) + (drag.worldNormal.x * actual) / 2),
      offsetZ: round2((o.offsetZ || 0) + (drag.worldNormal.z * actual) / 2)
    };
  }
  drag.patch = patch;

  // 끄는 동안 매스·표제란 면적·레이어 패널·편집 패널을 실시간으로 다시 계산해 보여준다(아직 확정 전).
  const floors = currentSpec.floors.map((f) => (f.level === drag.level ? { ...f, ...patch } : f));
  renderSpec({ ...currentSpec, floors }, null, true, { keepCamera: true });
  const mesh = massGroup.children.find((m) => m.isMesh && m.userData.level === drag.level);
  if (mesh) placeHighlight(mesh, drag.localNormal);

  const key = drag.axis;
  const next = { ...o, ...patch };
  const valueOf = (f) => (key === 'height' ? f.height : floorSize(f)[key]);
  const d = valueOf(next) - valueOf(o);
  const name = { width: '폭', depth: '깊이', height: '층고' }[key];
  const areaText = key === 'height' ? '' : ` · 바닥 ${signed(plateArea(next) - plateArea(o), 1, '㎡')}`;
  dragLabel.innerHTML =
    `${name} ${fmt(valueOf(o), 1)} → <b>${fmt(valueOf(next), 1)}m</b> ` +
    `<span class="${d >= 0 ? 'plus' : 'minus'}">(${signed(d, 1, 'm')})</span>${areaText}`;
  const vp = viewport.getBoundingClientRect();
  dragLabel.style.left = `${ev.clientX - vp.left}px`;
  dragLabel.style.top = `${ev.clientY - vp.top}px`;
  dragLabel.hidden = false;
}

function finishDrag(commit) {
  const d = drag;
  drag = null;
  viewport.classList.remove('pulling', 'can-move');
  dragLabel.hidden = true;
  try {
    viewport.releasePointerCapture(d.pointerId);
  } catch (e) {
    // 이미 해제된 경우
  }
  if (commit && d.patch) commitFloorEdit(d.level, d.patch);
  else renderSpec(currentSpec, null, false, { keepCamera: true });
}

// 한 번 클릭: 층 전체 선택 / 더블클릭: 그 층의 "면 수정" 켜기
viewport.addEventListener('dblclick', (ev) => {
  if (ev.target !== renderer.domElement || !canEditFloors()) return;
  const hit = pickFloor(ev);
  if (!hit) {
    // 빈 곳을 더블클릭하면 선택된 층의 면 수정을 껐다 켠다(조준이 빗나가도 쓸 수 있게)
    if (selectedLevel != null) setFaceEdit(faceEditLevel === selectedLevel ? null : selectedLevel);
    return;
  }
  const level = hit.object.userData.level;
  if (level !== selectedLevel) selectFloor(level);
  setFaceEdit(level);
});

viewport.addEventListener('pointerup', (ev) => {
  if (drag) {
    finishDrag(true);
    return;
  }
  const start = downAt;
  downAt = null;
  if (!start || !canEditFloors()) return;
  if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 4) return; // 시점 회전이었으면 선택을 바꾸지 않는다
  const hit = pickFloor(ev);
  const level = hit ? hit.object.userData.level : null;
  if (level !== selectedLevel) selectFloor(level);
});
viewport.addEventListener('pointercancel', () => {
  if (drag) finishDrag(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !compareOverlay.hidden) return;
  if (drag) finishDrag(false);
  else if (faceEditLevel != null) setFaceEdit(null); else if (selectedLevel != null) selectFloor(null);
});

// ---- 대지 찾기: 주소 → 필지 경계 + 토지특성 + 건축물대장 + 주변 건물 + 지적도 미니맵 ----
// 자료마다 성공/실패를 따로 표시하고, 실패한 자료는 빼고 나머지로 진행한다.
function landKeys() {
  return { vworld: userKeys.vworld || '', datagokr: userKeys.datagokr || '' };
}

function renderSources(sources) {
  const rows = Object.entries(SOURCE_LABEL)
    .filter(([k]) => sources[k])
    .map(([k, label]) => {
      const s = sources[k];
      const why = s.ok ? s.note : `${s.reason}${s.detail ? ` — ${s.detail}` : ''}`;
      return `<div class="src ${s.ok ? 'ok' : 'bad'}">
        <span class="mark">${s.ok ? '✓' : '✕'}</span>
        <span><span class="name">${escapeHtml(label)}</span>${why ? `<br><span class="why">${escapeHtml(why)}</span>` : ''}</span>
      </div>`;
    })
    .join('');
  landSources.innerHTML = `<span class="tag">자료 상태</span>${rows}`;
  landSources.hidden = !rows;
}

function renderLandInfo(data) {
  const p = data.parcel;
  if (!p) {
    landInfo.hidden = true;
    landApplyBtn.hidden = true;
    return;
  }
  const z = data.zoneRatios;
  const bld = data.buildings || [];
  const bldText = bld.length
    ? bld
        .slice(0, 3)
        .map(
          (b) =>
            `${escapeHtml(b.name || '(이름 없음)')} — ${b.mainUse || '용도 미상'} · 지상 ${b.floorsAbove ?? '?'}층` +
            `${b.totalArea ? ` · 연면적 ${fmt(b.totalArea, 1)}㎡` : ''}${b.approvedAt ? ` · 사용승인 ${b.approvedAt}` : ''}`
        )
        .join('<br>')
    : '';
  landInfo.innerHTML =
    `<div class="li-addr">${escapeHtml(p.address || data.query || '선택한 필지')}</div>` +
    `<div class="li-sub">PNU ${escapeHtml(p.pnu || '-')}</div>` +
    '<dl>' +
    `<dt>측정 면적</dt><dd>${fmt(p.areaM2, 1)}㎡</dd>` +
    (data.land?.officialAreaM2 ? `<dt>공부상 면적</dt><dd>${fmt(data.land.officialAreaM2, 1)}㎡</dd>` : '') +
    (data.land?.useZone ? `<dt>용도지역</dt><dd>${escapeHtml(data.land.useZone)}</dd>` : '') +
    (data.land?.jimok ? `<dt>지목</dt><dd>${escapeHtml(data.land.jimok)}</dd>` : '') +
    (z ? `<dt>적용 비율</dt><dd>건폐율 ${z.bcr}% · 용적률 ${z.far}%</dd>` : '') +
    '</dl>' +
    (bldText ? `<div class="li-bld">기존 건물 ${bld.length}동<br>${bldText}</div>` : '') +
    (data.sources.building?.ok && !bld.length ? '<div class="li-bld">기존 건물: 등록된 건축물대장 없음</div>' : '');
  landInfo.hidden = false;
  landApplyBtn.hidden = false;
  landApplyBtn.disabled = !z && !data.land?.useZone;
  landApplyBtn.textContent = z
    ? '이 대지 경계·조건으로 초기 매스 만들기'
    : '용도지역을 못 읽어 비율을 직접 넣어야 합니다';
}

// 지적도 이미지(WMS) + 선택한 필지 외곽선
function renderMinimap(data) {
  const p = data.parcel;
  if (!p?.boundary?.length) {
    minimap.hidden = true;
    if (mmEmpty) mmEmpty.hidden = false;
    return;
  }
  minimap.hidden = false;
  if (mmEmpty) mmEmpty.hidden = true;
  if (mmTitle) mmTitle.textContent = p.address || '선택한 대지';
  const lons = p.boundary.map((c) => c[0]);
  const lats = p.boundary.map((c) => c[1]);
  const pad = Math.max((Math.max(...lons) - Math.min(...lons)) * 1.6, (Math.max(...lats) - Math.min(...lats)) * 1.6, 0.0012);
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const box = [cLon - pad, cLat - pad, cLon + pad, cLat + pad];

  mmFail.hidden = true;
  mmImage.hidden = false;
  mmImage.onerror = () => {
    mmImage.hidden = true;
    mmFail.hidden = false;
    mmFail.textContent = '지적도 이미지를 불러오지 못했습니다. VWorld 키와 도메인 등록을 확인해 주세요.';
    renderSources({ ...data.sources, cadastral: { ok: false, reason: '지적도 이미지 조회 실패', detail: '' } });
  };
  mmImage.src = cadastralMapUrl(box, 512, landKeys());

  const pts = p.boundary
    .map(([lon, lat]) => `${(((lon - box[0]) / (box[2] - box[0])) * 100).toFixed(2)},${(((box[3] - lat) / (box[3] - box[1])) * 100).toFixed(2)}`)
    .join(' ');
  mmOverlay.innerHTML = `<polygon class="parcel" points="${pts}" />`;
  mmCaption.textContent = `${p.address || ''} · 반경 약 ${Math.round(pad * 111320)}m`;
}

// 주변 건물: 발자국 폴리곤을 층수(또는 높이)만큼 세운다. 매스와 구분되도록 어둡고 반투명하게.
function renderNeighbors(data) {
  if (neighborGroup) {
    scene.remove(neighborGroup);
    neighborGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    neighborGroup = null;
  }
  const list = data?.neighbors || [];
  if (!list.length) return;

  neighborGroup = new THREE.Group();
  const fill = new THREE.MeshStandardMaterial({ color: 0x8595a0, roughness: 0.95, transparent: true, opacity: 0.72 });
  const edge = new THREE.LineBasicMaterial({ color: 0x46606d });
  list.forEach((b) => {
    if (!b.local || b.local.length < 3) return;
    const shape = new THREE.Shape(b.local.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(2, b.height), bevelEnabled: false });
    geo.rotateX(-Math.PI / 2); // XY 평면에서 만든 뒤 눕혀서 높이가 +Y가 되게 한다
    const mesh = new THREE.Mesh(geo, fill);
    neighborGroup.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(geo), edge));
  });
  neighborGroup.visible = showNeighbors;
  scene.add(neighborGroup);
  neighborsBtn.hidden = false;
}

// 주변 건물은 맥락용이라 끄고 볼 수 있게 한다.
function setNeighborsVisible(on) {
  showNeighbors = on;
  if (neighborGroup) neighborGroup.visible = on;
  neighborsBtn.classList.toggle('on', on);
  neighborsBtn.textContent = on ? '주변 건물 끄기' : '주변 건물 켜기';
}

// 조회 결과를 화면 좌표(미터)로 바꿔 저장한다. 원점은 필지 중심.
function prepareLandData(data, query) {
  const p = data.parcel;
  if (p?.boundary?.length > 2) {
    const [lon0, lat0] = [p.boundary.reduce((s, c) => s + c[0], 0) / p.boundary.length, p.boundary.reduce((s, c) => s + c[1], 0) / p.boundary.length];
    data.origin = [lon0, lat0];
    data.boundaryLocal = ringToLocal(p.boundary, lon0, lat0);
    const [cx, cz] = centroid(data.boundaryLocal);
    data.boundaryLocal = data.boundaryLocal.map(([x, z]) => [+(x - cx).toFixed(2), +(z - cz).toFixed(2)]);
    data.localAreaM2 = +polygonArea(data.boundaryLocal).toFixed(1);
    // 주변 건물도 같은 원점으로. 가까운 것부터 120동만 남겨 저장 용량을 줄인다.
    data.neighbors = (data.neighbors || [])
      .map((b) => {
        const local = ringToLocal(b.ring, lon0, lat0).map(([x, z]) => [+(x - cx).toFixed(2), +(z - cz).toFixed(2)]);
        const c = centroid(local);
        return { name: b.name, floors: b.floors, height: b.height, local, dist: Math.hypot(c[0], c[1]) };
      })
      .filter((b) => b.local.length > 2 && b.dist < 200)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 120);
  }
  data.query = query || '';
  return data;
}

function showLand(data) {
  landData = data;
  renderLandInfo(data);
  renderSources(data.sources);
  renderMinimap(data);
  renderNeighbors(data);
}

async function runLandSearch() {
  const q = landQuery.value.trim();
  if (!q) return;
  landResults.hidden = false;
  landResults.innerHTML = '<p class="empty">검색 중...</p>';
  try {
    const data = await searchLand(q, landKeys());
    if (!data.items.length) {
      landResults.innerHTML = '<p class="empty">검색 결과가 없습니다. 지번을 포함해 적어 보세요(예: 서울 서초구 방배동 987-12).</p>';
      return;
    }
    landResults.innerHTML = data.items
      .map(
        (it, i) =>
          `<button type="button" data-i="${i}"><b>${escapeHtml(it.address)}</b>${it.road ? escapeHtml(it.road) + ' · ' : ''}${it.kind}</button>`
      )
      .join('');
    landResults.dataset.items = JSON.stringify(data.items);
  } catch (e) {
    landResults.innerHTML = `<p class="empty" style="color:var(--pencil)">${escapeHtml(e.message)}</p>`;
  }
}

async function pickLandCandidate(item) {
  landResults.innerHTML = `<p class="empty">${escapeHtml(item.address)} 자료를 불러오는 중...</p>`;
  try {
    const data = prepareLandData(await loadParcel(item.lon, item.lat, landKeys()), item.address);
    landResults.hidden = true;
    showLand(data);
    saveDesign();
  } catch (e) {
    landResults.innerHTML = `<p class="empty" style="color:var(--pencil)">${escapeHtml(e.message)}</p>`;
  }
}

// 조회한 경계·조건을 대지 조건 입력칸에 넣고 초기 매스를 만든다.
function applyLandToSite() {
  if (!landData?.parcel) return;
  const z = landData.zoneRatios;
  const site = {
    name: landData.parcel.address || landData.query,
    pnu: landData.parcel.pnu,
    zoning: landData.land?.useZone || '',
    siteArea: landData.land?.officialAreaM2 || landData.localAreaM2 || landData.parcel.areaM2,
    coverageRatio: z ? z.bcr : Number(fieldInput('coverageRatio').value) || 60,
    farRatio: z ? z.far : Number(fieldInput('farRatio').value) || 200,
    floorHeight: Number(fieldInput('floorHeight').value) || 3.3,
    setback: Number(fieldInput('setback').value) || 1,
    sunRule: currentSunRule,
    boundary: landData.boundaryLocal
  };
  setSiteInputs(site);
  generateBtn.click();
  appendMessage(
    'system',
    escapeHtml(
      `조회한 대지(${site.name})로 초기 매스를 만들었습니다. 면적 ${fmt(site.siteArea, 1)}㎡` +
        `${site.zoning ? ` · ${site.zoning}` : ''} · 건폐율 ${site.coverageRatio}% · 용적률 ${site.farRatio}%` +
        (z ? ' (용도지역 기본 비율 가정)' : ' (비율은 입력값 사용)')
    )
  );
}

landSearchBtn.addEventListener('click', runLandSearch);
landQuery.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runLandSearch();
  }
});
landResults.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-i]');
  if (!btn) return;
  const items = JSON.parse(landResults.dataset.items || '[]');
  const item = items[Number(btn.dataset.i)];
  if (item) pickLandCandidate(item);
});
landApplyBtn.addEventListener('click', applyLandToSite);
neighborsBtn.addEventListener('click', () => setNeighborsVisible(!showNeighbors));
mmToggle.addEventListener('click', () => {
  const collapsed = minimap.classList.toggle('collapsed');
  mmToggle.textContent = collapsed ? '펼치기' : '접기';
});
