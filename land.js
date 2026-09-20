// 대지 자료(주소 검색·필지 경계·주변 건물) 조회와 좌표 변환.
// 위경도는 화면 계산에 쓰기 어려우므로, 필지 중심을 원점으로 한 "미터 좌표"로 바꿔서 쓴다.
//   x = 동쪽(+), z = 남쪽(+)  — 앱의 offsetX/offsetZ와 같은 방향

export const M_PER_LAT = 110540;
export const mPerLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

/** 위경도 점 → 원점(lon0, lat0) 기준 미터 좌표 [x, z] */
export function toLocal([lon, lat], lon0, lat0) {
  return [(lon - lon0) * mPerLon(lat0), (lat0 - lat) * M_PER_LAT];
}

export function ringToLocal(ring, lon0, lat0) {
  return ring.map((p) => toLocal(p, lon0, lat0));
}

/** 미터 좌표 폴리곤의 면적(㎡) */
export function polygonArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(a / 2);
}

export function centroid(ring) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return [cx, cz];
}

export function bbox(ring) {
  const xs = ring.map((p) => p[0]);
  const zs = ring.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

function convexHull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src) => {
    const out = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
}

/**
 * 필지를 감싸는 최소 면적 직사각형(회전 캘리퍼스).
 * 필지 모양을 따라 매스를 앉히려고 쓴다 — 각도와 가로·세로, 중심을 돌려준다.
 */
export function minAreaRect(ring) {
  const hull = convexHull(ring);
  if (hull.length < 3) {
    const b = bbox(ring);
    return { angleDeg: 0, width: b.maxX - b.minX, depth: b.maxZ - b.minZ, center: centroid(ring) };
  }
  let best = null;
  for (let i = 0; i < hull.length; i++) {
    const [x1, z1] = hull[i];
    const [x2, z2] = hull[(i + 1) % hull.length];
    const angle = Math.atan2(z2 - z1, x2 - x1);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const [x, z] of hull) {
      const u = x * cos - z * sin;
      const v = x * sin + z * cos;
      minU = Math.min(minU, u); maxU = Math.max(maxU, u);
      minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (!best || area < best.area) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = {
        area,
        angle,
        width: maxU - minU,
        depth: maxV - minV,
        center: [cu * Math.cos(angle) - cv * Math.sin(angle), cu * Math.sin(angle) + cv * Math.cos(angle)]
      };
    }
  }
  return { angleDeg: +((best.angle * 180) / Math.PI).toFixed(2), width: +best.width.toFixed(2), depth: +best.depth.toFixed(2), center: best.center };
}

// ---- 서버 조회 (키는 서버가 .env → 입력한 키 순으로 쓴다) ----
function withKeys(params, keys) {
  const qs = new URLSearchParams(params);
  if (keys.vworld) qs.set('vworldKey', keys.vworld);
  if (keys.datagokr) qs.set('datagokrKey', keys.datagokr);
  return qs;
}

export async function searchLand(query, keys) {
  const r = await fetch(`/api/land/search?${withKeys({ q: query }, keys)}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `주소 검색 실패 (${r.status})`);
  return data;
}

export async function loadParcel(lon, lat, keys) {
  const r = await fetch(`/api/land/parcel?${withKeys({ lon, lat }, keys)}`);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `대지 조회 실패 (${r.status})`);
  return data;
}

export function cadastralMapUrl(bboxLonLat, size, keys) {
  return `/api/land/map?${withKeys({ bbox: bboxLonLat.join(','), w: size, h: size }, keys)}`;
}
