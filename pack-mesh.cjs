// Packs nailong-mesh.json into the compact binary the page loads (nailong-mesh.bin).
// Run after build-mesh.cjs (which calls this automatically). Layout:
//   "NLM1" | uint32 header length | header JSON (utf8) | padding to 4 | typed-array payloads (each 4-aligned)
// The header carries every non-array field plus, for each array, its path, storage type, offset, length and the
// scale it was quantized with (value = stored * scale). Positions, normals and skin weights are 16-bit; index and
// tet references use the smallest unsigned type that fits.
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'nailong.js'), 'utf8');
const geometry = src.slice(0, src.indexOf('// ===== physics.js =====')).replace("import * as THREE from 'three';", '');
const { eyeSkinning } = new Function(geometry + ';return {eyeSkinning};')();

function pack(mesh) {
  const rm = mesh.renderMesh;
  // precompute the eye skinning so the page does not search triangles at startup
  const eyeRM = { ...rm, rest: Float32Array.from(rm.rest), restNormal: Float32Array.from(rm.restNormal), index: Uint32Array.from(rm.index) };
  const eyes = eyeSkinning(eyeRM);

  const arrays = [];
  const meta = JSON.parse(JSON.stringify(mesh, (k, v) => (Array.isArray(v) && v.length > 16 && typeof v[0] === 'number') ? undefined : v));
  // start: store only data[start…]; the reader restores a full-length array with zeros before it
  const add = (p, data, type, scale, start = 0) => arrays.push({ path: p, data: start ? data.slice(start) : data, type, scale, start, full: data.length });
  const maxAbs = a => { let m = 0; for (const x of a) m = Math.max(m, Math.abs(x)); return m || 1; };
  const uint = (a) => { let m = 0; for (const x of a) if (x > m) m = x; return m < 256 ? 'u8' : m < 65536 ? 'u16' : 'u32'; };

  add('simMesh.rest', mesh.simMesh.rest, 'f32');
  add('simMesh.tets', mesh.simMesh.tets, uint(mesh.simMesh.tets));
  add('simMesh.region', mesh.simMesh.region, 'u8');
  add('renderMesh.rest', rm.rest, 'i16', maxAbs(rm.rest) / 32767);
  add('renderMesh.restNormal', rm.restNormal, 'i16', 1 / 32767);
  add('renderMesh.mat', rm.mat, 'u8');
  add('renderMesh.ctr', rm.ctr, 'i16', maxAbs(rm.ctr) / 32767, rm.bodyVertCount * 4); // all zeros on the body
  add('renderMesh.index', rm.index, uint(rm.index));
  add('emb.tetOf', mesh.emb.tetOf, uint(mesh.emb.tetOf));
  add('emb.w', mesh.emb.w, 'i16', maxAbs(mesh.emb.w) / 32767);
  eyes.forEach((e, k) => {
    add(`renderMesh.eyeSkin.${k}.tri`, e.tri, 'u32');
    add(`renderMesh.eyeSkin.${k}.bw`, e.bw, 'f32');
    add(`renderMesh.eyeSkin.${k}.hgt`, e.hgt, 'f32');
    add(`renderMesh.eyeSkin.${k}.eyeTris`, e.eyeTris, 'u32');
  });
  meta.renderMesh.eyeSkin = eyes.map(() => ({}));

  const T = { f32: Float32Array, i16: Int16Array, u8: Uint8Array, u16: Uint16Array, u32: Uint32Array };
  const chunks = arrays.map(a => {
    const C = T[a.type], out = new C(a.data.length);
    for (let i = 0; i < a.data.length; i++) out[i] = a.scale ? Math.round(a.data[i] / a.scale) : a.data[i];
    return out;
  });
  const entries = [];
  let off = 0;
  chunks.forEach((c, i) => { entries.push({ path: arrays[i].path, type: arrays[i].type, offset: off, length: c.length, ...(arrays[i].scale ? { scale: arrays[i].scale } : {}), ...(arrays[i].start ? { start: arrays[i].start, full: arrays[i].full } : {}) }); off += Math.ceil(c.byteLength / 4) * 4; });
  const header = Buffer.from(JSON.stringify({ meta, arrays: entries }), 'utf8');
  const headStart = 8, dataStart = Math.ceil((headStart + header.length) / 4) * 4;
  const buf = Buffer.alloc(dataStart + off);
  buf.write('NLM1', 0, 'ascii'); buf.writeUInt32LE(header.length, 4); header.copy(buf, headStart);
  chunks.forEach((c, i) => Buffer.from(c.buffer, c.byteOffset, c.byteLength).copy(buf, dataStart + entries[i].offset));
  return buf;
}

module.exports = pack;
if (require.main === module) {
  const mesh = JSON.parse(fs.readFileSync(path.join(__dirname, 'nailong-mesh.json'), 'utf8'));
  const buf = pack(mesh);
  fs.writeFileSync(path.join(__dirname, 'nailong-mesh.bin'), buf);
  console.log(JSON.stringify({ bytes: buf.length }));
}
