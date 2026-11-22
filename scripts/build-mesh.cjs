// Regenerate after editing Nailong's SDF or render geometry in nailong.js.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'nailong.js'), 'utf8');
const geometry = source.slice(0, source.indexOf('// ===== physics.js =====')).replace("import * as THREE from 'three';", '');
const build = new Function('existingSim',geometry + '\nconst simMesh=existingSim||buildSimMesh(.24),renderMesh=buildRenderMesh();return {simMesh,renderMesh,emb:embed(simMesh.rest,simMesh.tets,renderMesh.rest,[renderMesh.krillV0,renderMesh.rest.length/3-renderMesh.krillV0])};');
const existing=process.argv.includes('--render-only')?JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'mesh', 'nailong-mesh.json'),'utf8')).simMesh:null;
const mesh = build(existing);
console.log(require('./check-mesh.cjs')(mesh));
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'mesh', 'nailong-mesh.json'), JSON.stringify(mesh, (_, v) => ArrayBuffer.isView(v) ? Array.from(v) : v));
// the page loads the compact binary; the JSON stays as the build cache (read by --render-only and the checks)
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'mesh', 'nailong-mesh.bin'), require('./pack-mesh.cjs')(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'mesh', 'nailong-mesh.json'), 'utf8'))));
console.log(JSON.stringify({nodes:mesh.simMesh.rest.length/3,tetrahedra:mesh.simMesh.tets.length/4,vertices:mesh.renderMesh.rest.length/3}));
