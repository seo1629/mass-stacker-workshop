// 내보내기 — 설계 JSON, 3D 모델(DAE / GLB).
//
// · JSON: 설계 조건·대지 정보·층별 상세·면적/높이·자료 출처·설계 이력 (제안서 작성용)
// · DAE : COLLADA 1.4.1 문서를 직접 만든다(three r160에는 ColladaExporter가 없다).
//         우리 형상은 박스와 다각형 압출이라 삼각형만 쓰면 되어 간단하다.
// · GLB : three의 GLTFExporter(binary)
//
// 3D에는 주변 건물과 지적 경계를 넣을지 고를 수 있다.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const pad = (n) => String(n).padStart(2, '0');

export function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

export function safeName(s, fallback = 'mass-stacker') {
  const t = String(s || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_');
  return t || fallback;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- 내보낼 3D 묶음 만들기 ----
// massMeshes: 설계 매스(층) 메시들, neighbors: 주변 건물 그룹, boundary: 미터 좌표 필지 경계
export function buildExportScene({ massMeshes, floorLabels, neighborGroup, boundary, includeNeighbors, includeBoundary }) {
  const root = new THREE.Group();
  root.name = 'MassStacker';

  const design = new THREE.Group();
  design.name = 'Design';
  massMeshes.forEach((mesh, i) => {
    const clone = new THREE.Mesh(
      mesh.geometry.clone(),
      new THREE.MeshStandardMaterial({ color: 0xdedad0, roughness: 0.9, metalness: 0 })
    );
    clone.applyMatrix4(mesh.matrixWorld);
    clone.name = `Floor_${floorLabels[i] || i + 1}`;
    design.add(clone);
  });
  root.add(design);

  if (includeNeighbors && neighborGroup) {
    const group = new THREE.Group();
    group.name = 'NeighborBuildings';
    neighborGroup.children.filter((o) => o.isMesh).forEach((mesh, i) => {
      const clone = new THREE.Mesh(
        mesh.geometry.clone(),
        new THREE.MeshStandardMaterial({ color: 0x9aa7ae, roughness: 1, metalness: 0 })
      );
      clone.applyMatrix4(mesh.matrixWorld);
      clone.name = `Neighbor_${i + 1}`;
      group.add(clone);
    });
    if (group.children.length) root.add(group);
  }

  if (includeBoundary && boundary?.length > 2) {
    // 경계선은 어느 뷰어에서나 보이도록 얇은 판(두께 0.05m)으로 넣는다.
    const shape = new THREE.Shape(boundary.map(([x, z]) => new THREE.Vector2(x, -z)));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x57c2d6, roughness: 1 }));
    plate.name = 'SiteBoundary';
    root.add(plate);
  }
  return root;
}

// ---- GLB ----
export function exportGLB(scene) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(
      scene,
      (result) => resolve(new Blob([result], { type: 'model/gltf-binary' })),
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
      { binary: true }
    );
  });
}

// ---- DAE (COLLADA 1.4.1) ----
const xmlEscape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fixed = (v) => (Math.abs(v) < 1e-6 ? '0' : v.toFixed(4));

function meshToGeometry(mesh, index) {
  const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
  geo.applyMatrix4(mesh.matrixWorld);
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const norm = geo.getAttribute('normal');
  const count = pos.count;

  const posArr = [];
  const normArr = [];
  for (let i = 0; i < count; i++) {
    posArr.push(fixed(pos.getX(i)), fixed(pos.getY(i)), fixed(pos.getZ(i)));
    normArr.push(fixed(norm.getX(i)), fixed(norm.getY(i)), fixed(norm.getZ(i)));
  }
  const p = [];
  for (let i = 0; i < count; i++) p.push(i, i);
  geo.dispose();

  const id = `geom${index}`;
  const name = xmlEscape(mesh.name || id);
  return {
    id,
    name,
    matIndex: index,
    triangles: count / 3,
    color: mesh.material?.color ? mesh.material.color.toArray().map((c) => c.toFixed(4)).join(' ') : '0.8 0.8 0.8',
    xml:
      `    <geometry id="${id}" name="${name}">\n` +
      '      <mesh>\n' +
      `        <source id="${id}-pos">\n` +
      `          <float_array id="${id}-pos-array" count="${posArr.length}">${posArr.join(' ')}</float_array>\n` +
      '          <technique_common>\n' +
      `            <accessor source="#${id}-pos-array" count="${count}" stride="3">\n` +
      '              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>\n' +
      '            </accessor>\n' +
      '          </technique_common>\n' +
      '        </source>\n' +
      `        <source id="${id}-norm">\n` +
      `          <float_array id="${id}-norm-array" count="${normArr.length}">${normArr.join(' ')}</float_array>\n` +
      '          <technique_common>\n' +
      `            <accessor source="#${id}-norm-array" count="${count}" stride="3">\n` +
      '              <param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/>\n' +
      '            </accessor>\n' +
      '          </technique_common>\n' +
      '        </source>\n' +
      `        <vertices id="${id}-vtx"><input semantic="POSITION" source="#${id}-pos"/></vertices>\n` +
      `        <triangles material="mat${index}-symbol" count="${count / 3}">\n` +
      `          <input semantic="VERTEX" source="#${id}-vtx" offset="0"/>\n` +
      `          <input semantic="NORMAL" source="#${id}-norm" offset="1"/>\n` +
      `          <p>${p.join(' ')}</p>\n` +
      '        </triangles>\n' +
      '      </mesh>\n' +
      '    </geometry>\n'
  };
}

export function exportDAE(scene) {
  const meshes = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (o.isMesh && o.geometry?.getAttribute('position')) meshes.push(o);
  });
  const geoms = meshes.map((m, i) => meshToGeometry(m, i));
  const now = new Date().toISOString();

  const effects = geoms
    .map(
      (g) =>
        `    <effect id="effect${g.matIndex}">\n` +
        '      <profile_COMMON><technique sid="common"><lambert>\n' +
        `        <diffuse><color>${g.color} 1</color></diffuse>\n` +
        '      </lambert></technique></profile_COMMON>\n' +
        '    </effect>\n'
    )
    .join('');
  const materials = geoms
    .map((g) => `    <material id="material${g.matIndex}" name="${g.name}-mat"><instance_effect url="#effect${g.matIndex}"/></material>\n`)
    .join('');
  const nodes = geoms
    .map(
      (g) =>
        `      <node id="node${g.matIndex}" name="${g.name}" type="NODE">\n` +
        `        <instance_geometry url="#${g.id}">\n` +
        '          <bind_material><technique_common>\n' +
        `            <instance_material symbol="mat${g.matIndex}-symbol" target="#material${g.matIndex}"/>\n` +
        '          </technique_common></bind_material>\n' +
        '        </instance_geometry>\n' +
        '      </node>\n'
    )
    .join('');

  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">\n' +
    '  <asset>\n' +
    '    <contributor><authoring_tool>Mass Stacker</authoring_tool></contributor>\n' +
    `    <created>${now}</created>\n    <modified>${now}</modified>\n` +
    '    <unit name="meter" meter="1"/>\n    <up_axis>Y_UP</up_axis>\n' +
    '  </asset>\n' +
    `  <library_effects>\n${effects}  </library_effects>\n` +
    `  <library_materials>\n${materials}  </library_materials>\n` +
    `  <library_geometries>\n${geoms.map((g) => g.xml).join('')}  </library_geometries>\n` +
    '  <library_visual_scenes>\n    <visual_scene id="Scene" name="Scene">\n' +
    nodes +
    '    </visual_scene>\n  </library_visual_scenes>\n' +
    '  <scene><instance_visual_scene url="#Scene"/></scene>\n' +
    '</COLLADA>\n';

  return { xml, meshCount: meshes.length, triangleCount: geoms.reduce((t, g) => t + g.triangles, 0) };
}
