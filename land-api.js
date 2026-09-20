// 대지 자료 조회 — VWorld(지적·토지특성·주변 건물·지적도 이미지) + 공공데이터포털(건축물대장).
//
// 참고: "OSC LH매입임대지도" 예제(2_next.js시연/demo-1h-app)
//   · 필지 경계: VWorld req/data LP_PA_CBND_BUBUN (POINT/BOX geomFilter)
//   · 토지특성: VWorld ned/data/getLandCharacteristics (용도지역·지목·면적)
//   · 주변 건물: VWorld req/data LT_C_BLDGINFO (발자국 + 지상층수) — 3D Tiles 대신 이 쪽이 지적과 딱 맞는다
//   · 건축물대장: 공공데이터포털 BldRgstHubService (PNU 19자리를 sigungu/bjdong/bun/ji로 쪼개 사용)
//
// 자료마다 성공/실패를 따로 담아 돌려준다(sources). 한 곳이 실패해도 나머지는 그대로 쓴다.

const VWORLD = 'https://api.vworld.kr';
const BLD = 'https://apis.data.go.kr/1613000/BldRgstHubService';

// 서울시 도시계획 조례 기준 상한(예제 scale.ts와 같은 표). 인허가 확정값이 아니라 기본 가정값이다.
const ZONES = [
  [/제1종전용주거/, { bcr: 50, far: 100 }],
  [/제2종전용주거/, { bcr: 40, far: 120 }],
  [/제1종일반주거/, { bcr: 60, far: 150 }],
  [/제2종일반주거/, { bcr: 60, far: 200 }],
  [/제3종일반주거/, { bcr: 50, far: 250 }],
  [/준주거/, { bcr: 60, far: 400 }],
  [/중심상업/, { bcr: 60, far: 1000 }],
  [/일반상업/, { bcr: 60, far: 800 }],
  [/근린상업/, { bcr: 60, far: 600 }],
  [/유통상업/, { bcr: 60, far: 600 }],
  [/전용공업|일반공업/, { bcr: 70, far: 300 }],
  [/준공업/, { bcr: 60, far: 400 }],
  [/녹지/, { bcr: 20, far: 100 }],
  [/일반주거/, { bcr: 60, far: 200 }]
];

export function zoneRatios(useZone) {
  if (!useZone) return null;
  for (const [re, v] of ZONES) if (re.test(useZone)) return { ...v, zone: useZone };
  return null;
}

// 자료 한 건의 상태. ok면 data, 실패면 왜 실패했는지 사람이 읽을 수 있게 남긴다.
const okSource = (note) => ({ ok: true, note: note || '' });
const failSource = (reason, detail) => ({ ok: false, reason, detail: detail ? String(detail).replace(/\s+/g, ' ').slice(0, 300) : '' });

async function vworldGet(path, params, key) {
  const qs = new URLSearchParams({ ...params, key, domain: 'http://localhost' });
  const r = await fetch(`${VWORLD}/${path}?${qs}`, { cache: 'no-store' });
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    // WMS 등 이미지 응답이거나 오류 HTML
  }
  const status = json?.response?.status;
  const errText = json?.response?.error?.text || json?.error?.text;
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`);
  if (status === 'ERROR' || errText) throw new Error(errText || `VWorld 오류: ${text.slice(0, 200)}`);
  return json;
}

// --- 주소 검색: 지번 주소 → 좌표 후보 목록 ---
async function searchAddress(query, key) {
  const out = [];
  for (const type of ['PARCEL', 'ROAD']) {
    try {
      const j = await vworldGet(
        'req/search',
        { service: 'search', request: 'search', version: '2.0', size: '10', page: '1', query, type: 'ADDRESS', category: type, format: 'json' },
        key
      );
      const items = j?.response?.result?.items || [];
      items.forEach((it) => {
        const lon = Number(it.point?.x);
        const lat = Number(it.point?.y);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        out.push({
          address: it.address?.parcel || it.address?.road || it.title || query,
          road: it.address?.road || '',
          lon,
          lat,
          kind: type === 'PARCEL' ? '지번' : '도로명'
        });
      });
    } catch (e) {
      if (type === 'PARCEL') throw e; // 지번 검색이 실패하면 키 문제일 가능성이 높다
    }
  }
  // 같은 좌표(같은 필지)는 한 번만
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.lon.toFixed(6)},${x.lat.toFixed(6)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- 필지 경계: 좌표 한 점이 속한 연속지적 폴리곤 ---
function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

// 위경도 ring → ㎡ (국지 평면 근사 후 신발끈 공식)
function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const mx = 111320 * Math.cos(lat0);
  const my = 110540;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = [ring[i][0] * mx, ring[i][1] * my];
    const [x2, y2] = [ring[j][0] * mx, ring[j][1] * my];
    a += x2 * y1 - x1 * y2;
  }
  return Math.abs(a / 2);
}

async function fetchParcel(lon, lat, key) {
  const j = await vworldGet(
    'req/data',
    {
      service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN',
      geomFilter: `POINT(${lon} ${lat})`, geometry: 'true', crs: 'EPSG:4326', size: '5', format: 'json'
    },
    key
  );
  const features = j?.response?.result?.featureCollection?.features || [];
  if (!features.length) throw new Error('이 좌표에서 필지를 찾지 못했습니다.');
  const f = features[0];
  const p = f.properties || {};
  const rings = ringsOf(f.geometry);
  // 한 지번이 MultiPolygon으로 오는 경우가 있어 가장 넓은 외곽선을 쓴다
  const outer = rings.map((r) => r[0]).sort((a, b) => ringAreaM2(b) - ringAreaM2(a))[0] || [];
  return {
    pnu: p.pnu || p.PNU || '',
    address: p.addr || p.jibun || '',
    boundary: outer,
    parts: rings.length,
    areaM2: +ringAreaM2(outer).toFixed(1)
  };
}

// --- 토지특성: 용도지역·지목·공부상 면적 ---
async function fetchLandCharacteristics(pnu, key) {
  const year = new Date().getFullYear();
  for (const y of [year, year - 1, year - 2]) {
    const j = await vworldGet(
      'ned/data/getLandCharacteristics',
      { pnu, stdrYear: String(y), numOfRows: '1', pageNo: '1', format: 'json' },
      key
    );
    const field = j?.landCharacteristicss?.field;
    const row = Array.isArray(field) ? field[0] : field;
    if (row) {
      return {
        year: y,
        useZone: row.prposArea1Nm || row.prposArea2Nm || '',
        jimok: row.lndcgrCodeNm || '',
        officialAreaM2: Number(row.lndpclAr) || null,
        useSituation: row.ladUseSittnNm || '',
        slope: row.tpgrphHgCodeNm || ''
      };
    }
  }
  throw new Error('토지특성 자료가 없습니다(최근 3개 연도).');
}

// --- 건축물대장: 기존 건물 ---
// 공공데이터포털 키는 Decoding(원문)과 Encoding(퍼센트 인코딩) 두 형태로 발급된다.
// 이미 인코딩된 키를 다시 인코딩하면 "등록되지 않은 서비스키"로 거부되므로 형태를 보고 그대로 쓴다.
export function serviceKeyParam(key) {
  return /%[0-9A-Fa-f]{2}/.test(key) ? key : encodeURIComponent(key);
}

function pnuToBldQuery(pnu, serviceKey) {
  return (
    `serviceKey=${serviceKeyParam(serviceKey)}&sigunguCd=${pnu.slice(0, 5)}&bjdongCd=${pnu.slice(5, 10)}` +
    `&platGbCd=${pnu.slice(10, 11) === '2' ? 1 : 0}&bun=${pnu.slice(11, 15)}&ji=${pnu.slice(15, 19)}` +
    '&numOfRows=30&pageNo=1&_type=json'
  );
}

async function fetchBuildingLedger(pnu, key) {
  const r = await fetch(`${BLD}/getBrTitleInfo?${pnuToBldQuery(pnu, key)}`, { cache: 'no-store' });
  const text = await r.text();
  const errMsg = (text.match(/errMsg"?\s*[:>]\s*"?([A-Z_]+)/) || [])[1];
  const code = (text.match(/returnReasonCode"?\s*[:>]\s*"?(\d+)/) || [])[1];
  if (errMsg) throw new Error(`${errMsg}${code ? ` (코드 ${code})` : ''}`);
  let j;
  try {
    j = JSON.parse(text);
  } catch (e) {
    throw new Error(`응답을 읽지 못했습니다: ${text.slice(0, 150)}`);
  }
  const items = j?.response?.body?.items?.item;
  const rows = !items ? [] : Array.isArray(items) ? items : [items];
  if (!rows.length) return { buildings: [], note: '이 필지에 등록된 건축물대장이 없습니다(나대지이거나 미등록).' };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    buildings: rows.map((b) => ({
      name: String(b.bldNm || '').trim(),
      mainUse: String(b.mainPurpsCdNm || '').trim(),
      structure: String(b.strctCdNm || '').trim(),
      archArea: num(b.archArea),
      totalArea: num(b.totArea),
      bcr: num(b.bcRat),
      far: num(b.vlRat),
      floorsAbove: num(b.grndFlrCnt),
      floorsBelow: num(b.ugrndFlrCnt),
      height: num(b.heit),
      approvedAt: /^\d{8}$/.test(String(b.useAprDay || '')) ? String(b.useAprDay).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : ''
    }))
  };
}

// --- 주변 건물: 발자국 + 지상층수 ---
async function fetchNeighborBuildings(lon, lat, key, radius = 220) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const box = `BOX(${(lon - dLon).toFixed(6)},${(lat - dLat).toFixed(6)},${(lon + dLon).toFixed(6)},${(lat + dLat).toFixed(6)})`;
  const j = await vworldGet(
    'req/data',
    {
      service: 'data', request: 'GetFeature', data: 'LT_C_BLDGINFO',
      geomFilter: box, crs: 'EPSG:4326', size: '500', format: 'json', geometry: 'true'
    },
    key
  );
  const features = j?.response?.result?.featureCollection?.features || [];
  const out = [];
  features.forEach((f) => {
    const p = f.properties || {};
    const floors = Math.max(1, parseInt(p.grnd_flr, 10) || 0);
    const height = Number(p.height) > 0 ? Number(p.height) : floors * 3.3;
    ringsOf(f.geometry).forEach((rings) => {
      out.push({ name: String(p.bld_nm || '').trim(), floors, height, ring: rings[0] });
    });
  });
  return out;
}

export function registerLandRoutes(app, resolveKey) {
  // resolveKey(kind, userKey) → .env 키 우선, 없으면 사용자가 입력한 키
  const need = (kind, userKey) => {
    const k = resolveKey(kind, userKey);
    if (!k) {
      const label = kind === 'vworld' ? 'VWorld' : '공공데이터포털';
      const err = new Error(`${label} 키가 없습니다. .env에 넣거나 화면 "API 키 직접 입력"에 넣어 주세요.`);
      err.noKey = true;
      throw err;
    }
    return k;
  };

  app.get('/api/land/search', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (!q) return res.status(400).json({ error: '검색할 주소를 입력해 주세요.' });
      const key = need('vworld', req.query.vworldKey);
      const items = await searchAddress(q, key);
      res.json({ items, sources: { vworld: items.length ? okSource() : failSource('검색 결과 없음', '주소를 다르게 적어 보세요(예: 서울 서초구 방배동 987-12)') } });
    } catch (e) {
      res.status(e.noKey ? 401 : 502).json({ error: e.message, sources: { vworld: failSource('주소 검색 실패', e.message) } });
    }
  });

  // 필지 + 토지특성 + 건축물대장 + 주변 건물을 한 번에. 각각 성공/실패를 따로 담는다.
  app.get('/api/land/parcel', async (req, res) => {
    const lon = Number(req.query.lon);
    const lat = Number(req.query.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return res.status(400).json({ error: 'lon, lat 값이 필요합니다.' });
    }
    const sources = {};
    const result = { lon, lat };

    let vworldKey = '';
    try {
      vworldKey = need('vworld', req.query.vworldKey);
    } catch (e) {
      sources.parcel = failSource('VWorld 키 없음', e.message);
      sources.land = failSource('VWorld 키 없음', e.message);
      sources.neighbors = failSource('VWorld 키 없음', e.message);
    }

    if (vworldKey) {
      try {
        result.parcel = await fetchParcel(lon, lat, vworldKey);
        sources.parcel = okSource(result.parcel.parts > 1 ? `여러 조각 중 가장 넓은 경계를 씁니다(${result.parcel.parts}조각).` : '');
      } catch (e) {
        sources.parcel = failSource('필지 경계 조회 실패', e.message);
      }

      if (result.parcel?.pnu) {
        try {
          result.land = await fetchLandCharacteristics(result.parcel.pnu, vworldKey);
          const z = zoneRatios(result.land.useZone);
          if (z) result.zoneRatios = z;
          sources.land = okSource(z ? `${z.zone} → 건폐율 ${z.bcr}% · 용적률 ${z.far}% (조례 기준 상한 가정)` : '용도지역에 해당하는 기본 비율표가 없습니다.');
        } catch (e) {
          sources.land = failSource('토지특성(용도지역) 조회 실패', e.message);
        }
      }

      try {
        result.neighbors = await fetchNeighborBuildings(lon, lat, vworldKey);
        sources.neighbors = okSource(`주변 건물 ${result.neighbors.length}동`);
      } catch (e) {
        sources.neighbors = failSource('주변 건물 조회 실패', e.message);
      }
    }

    if (result.parcel?.pnu) {
      try {
        const key = need('datagokr', req.query.datagokrKey);
        const bld = await fetchBuildingLedger(result.parcel.pnu, key);
        result.buildings = bld.buildings;
        sources.building = okSource(bld.note || `건축물대장 ${bld.buildings.length}건`);
      } catch (e) {
        sources.building = failSource(e.noKey ? '공공데이터포털 키 없음' : '건축물대장 조회 실패', e.message);
      }
    } else {
      sources.building = failSource('건축물대장 조회 안 함', '필지(PNU)를 먼저 찾아야 합니다.');
    }

    res.json({ ...result, sources });
  });

  // 지적도 이미지(WMS) — 미니맵 배경
  app.get('/api/land/map', async (req, res) => {
    try {
      const key = need('vworld', req.query.vworldKey);
      const bbox = String(req.query.bbox || '');
      const width = Math.min(1024, Number(req.query.w) || 320);
      const height = Math.min(1024, Number(req.query.h) || 320);
      if (!/^[-\d.,]+$/.test(bbox)) return res.status(400).json({ error: 'bbox 값이 필요합니다.' });
      const qs = new URLSearchParams({
        service: 'WMS', request: 'GetMap', version: '1.3.0', format: 'image/png', transparent: 'false',
        layers: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun', styles: 'lp_pa_cbnd_bubun,lp_pa_cbnd_bonbun',
        crs: 'EPSG:4326', bbox, width: String(width), height: String(height),
        key, domain: 'http://localhost'
      });
      const r = await fetch(`${VWORLD}/req/wms?${qs}`, { cache: 'no-store' });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) {
        const text = await r.text();
        return res.status(502).json({ error: `지적도 조회 실패 (${r.status})`, detail: text.replace(/\s+/g, ' ').slice(0, 200) });
      }
      res.set('content-type', type);
      res.send(Buffer.from(await r.arrayBuffer()));
    } catch (e) {
      res.status(e.noKey ? 401 : 502).json({ error: e.message });
    }
  });
}
