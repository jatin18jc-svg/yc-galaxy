import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const GA = Math.PI * (3 - Math.sqrt(5));

function fibDir(i, n) {
  const y = 1 - 2 * (i + 0.5) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = i * GA;
  return new THREE.Vector3(Math.cos(th) * r, y, Math.sin(th) * r);
}

function relax3(nodes, pad, iters, gravity) {
  const d = new THREE.Vector3();
  for (let it = 0; it < iters; it++) {
    for (const nd of nodes) nd.p.multiplyScalar(1 - gravity);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        d.subVectors(b.p, a.p);
        let L = d.length();
        if (L < 1e-6) { d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5); L = d.length(); }
        const need = a.r + b.r + pad;
        if (L < need) {
          d.multiplyScalar((need - L) / L * 0.5);
          a.p.sub(d);
          b.p.add(d);
        }
      }
    }
  }
}

function makeDotTexture() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,0,0,1)');
  grad.addColorStop(0.35, 'rgba(255,0,0,0.4)');
  grad.addColorStop(1, 'rgba(255,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'lighter';
  grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S * 0.16);
  grad.addColorStop(0, 'rgba(0,255,0,1)');
  grad.addColorStop(1, 'rgba(0,255,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(c);
}

function makeRingTexture() {
  const S = 64, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(255,0,0,1)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.24, 0, Math.PI * 2);
  g.stroke();
  return new THREE.CanvasTexture(c);
}

function makeNebulaTexture(rgb) {
  const S = 256, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighter';
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 7; i++) {
    const x = S * (0.3 + rnd() * 0.4), y = S * (0.3 + rnd() * 0.4);
    const r = S * (0.16 + rnd() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${rgb},${0.04 + rnd() * 0.04})`);
    grad.addColorStop(0.6, `rgba(${rgb},${0.015 + rnd() * 0.015})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  return new THREE.CanvasTexture(c);
}

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * (uScale / -mv.z), 1.0, 46.0);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
uniform sampler2D uTex;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  vec3 col = vColor * t.r + vec3(1.0) * t.g * 0.85;
  gl_FragColor = vec4(col * vAlpha, vAlpha);
}`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

export function init(app) {
  const canvas = document.getElementById('galaxy3d');
  const labelWrap = document.getElementById('labels3d');
  const companies = app.companies();
  const reduced = !!app.reducedMotion;
  let groups = app.groups();
  let worldR = 0, HOME_DIST = 0;

  /* ----- 3D layout (re-runnable) ----- */
  function computeLayout() {
    for (const g of groups) {
      const sn = g.subs.map((s, j) => ({
        s, r: 4.8 * Math.cbrt(s.list.length) + 3.5,
        p: fibDir(j, g.subs.length).multiplyScalar(10),
      }));
      sn.forEach(nd => nd.p.multiplyScalar(nd.r));
      relax3(sn, 2.5, 140, 0.012);
      let gr = 0;
      for (const nd of sn) gr = Math.max(gr, nd.p.length() + nd.r);
      g.r3 = gr + 5;
      g.subs3 = sn;
    }
    const gn = groups.map((g, i) => ({ g, r: g.r3, p: fibDir(i, groups.length).multiplyScalar(g.r3 + 60) }));
    relax3(gn, 12, 260, 0.008);
    let R = 0;
    for (const nd of gn) {
      nd.g.c3 = nd.p;
      R = Math.max(R, nd.p.length() + nd.r);
      for (const sub of nd.g.subs3) {
        const center = new THREE.Vector3().addVectors(nd.p, sub.p);
        sub.c3 = center;
        const list = sub.s.list;
        for (let i = 0; i < list.length; i++) {
          const rr = Math.max(0, sub.r - 2.5) * Math.cbrt((i + 0.5) / list.length);
          const d = fibDir(i, list.length).multiplyScalar(rr);
          list[i].p3 = new THREE.Vector3(center.x + d.x, center.y + d.y, center.z + d.z);
        }
      }
    }
    worldR = R;
    HOME_DIST = R * 2.35;
  }
  computeLayout();

  /* ----- renderer, scene, camera ----- */
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.5, worldR * 40);
  camera.position.set(0, worldR * 0.4, HOME_DIST);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = !reduced;
  controls.autoRotateSpeed = 0.45;
  controls.minDistance = 10;
  controls.maxDistance = worldR * 5;
  canvas.addEventListener('pointerdown', () => { controls.autoRotate = false; }, { once: true });

  /* ----- points geometry ----- */
  const n = companies.length;
  const pos = new Float32Array(n * 3);
  const posTgt = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  const alphaTgt = new Float32Array(n);
  const BASE = 6.2 * HOME_DIST / 1000;
  for (let i = 0; i < n; i++) {
    const c = companies[i];
    pos.set([c.p3.x, c.p3.y, c.p3.z], i * 3);
    posTgt.set([c.p3.x, c.p3.y, c.p3.z], i * 3);
    const color = new THREE.Color(app.colors[c.ai] || app.colors['Non-AI']);
    col.set([color.r, color.g, color.b], i * 3);
    size[i] = BASE * (c.st === 'Inactive' ? 0.72 : 1);
    alpha[i] = 1;
    alphaTgt[i] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: makeDotTexture() }, uScale: { value: 800 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  /* ----- acquired rings ----- */
  const RINGC = new THREE.Color(app.ringColor || '#7fe8c3');
  const acqIdx = [];
  companies.forEach((c, i) => { if (c.st === 'Acquired') acqIdx.push(i); });
  const rn = acqIdx.length;
  const rpos = new Float32Array(rn * 3), rcol = new Float32Array(rn * 3);
  const rsize = new Float32Array(rn), ralpha = new Float32Array(rn);
  for (let j = 0; j < rn; j++) {
    rcol.set([RINGC.r, RINGC.g, RINGC.b], j * 3);
    rsize[j] = BASE * 1.5;
    ralpha[j] = 1;
  }
  const rgeo = new THREE.BufferGeometry();
  rgeo.setAttribute('position', new THREE.BufferAttribute(rpos, 3));
  rgeo.setAttribute('aColor', new THREE.BufferAttribute(rcol, 3));
  rgeo.setAttribute('aSize', new THREE.BufferAttribute(rsize, 1));
  rgeo.setAttribute('aAlpha', new THREE.BufferAttribute(ralpha, 1));
  const rmat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: makeRingTexture() }, uScale: { value: 800 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const rings = new THREE.Points(rgeo, rmat);
  rings.frustumCulled = false;
  scene.add(rings);

  function syncRingPositions() {
    for (let j = 0; j < rn; j++) {
      const i = acqIdx[j];
      rpos[j * 3] = pos[i * 3];
      rpos[j * 3 + 1] = pos[i * 3 + 1];
      rpos[j * 3 + 2] = pos[i * 3 + 2];
    }
    rgeo.attributes.position.needsUpdate = true;
  }
  syncRingPositions();

  /* ----- B2A rings (agent-serving companies) ----- */
  const B2AC = new THREE.Color('#38d4f0');
  const b2aIdx = [];
  companies.forEach((c, i) => { if (c.sa) b2aIdx.push(i); });
  const bn = b2aIdx.length;
  const bpos = new Float32Array(bn * 3), bcol = new Float32Array(bn * 3);
  const bsize = new Float32Array(bn), balpha = new Float32Array(bn);
  for (let j = 0; j < bn; j++) {
    bcol.set([B2AC.r, B2AC.g, B2AC.b], j * 3);
    bsize[j] = BASE * 2.1;
    balpha[j] = 1;
  }
  const bgeo = new THREE.BufferGeometry();
  bgeo.setAttribute('position', new THREE.BufferAttribute(bpos, 3));
  bgeo.setAttribute('aColor', new THREE.BufferAttribute(bcol, 3));
  bgeo.setAttribute('aSize', new THREE.BufferAttribute(bsize, 1));
  bgeo.setAttribute('aAlpha', new THREE.BufferAttribute(balpha, 1));
  const bmat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: makeRingTexture() }, uScale: { value: 800 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const b2aRings = new THREE.Points(bgeo, bmat);
  b2aRings.frustumCulled = false;
  scene.add(b2aRings);
  function syncB2APositions() {
    for (let j = 0; j < bn; j++) {
      const i = b2aIdx[j];
      bpos[j * 3] = pos[i * 3];
      bpos[j * 3 + 1] = pos[i * 3 + 1];
      bpos[j * 3 + 2] = pos[i * 3 + 2];
    }
    bgeo.attributes.position.needsUpdate = true;
  }
  syncB2APositions();

  /* ----- background stars + nebulae ----- */
  {
    const sn2 = 900;
    const sp = new Float32Array(sn2 * 3);
    for (let i = 0; i < sn2; i++) {
      const d = fibDir(i, sn2).multiplyScalar(worldR * (6 + (i % 37) / 12));
      sp.set([d.x, d.y, d.z], i * 3);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
      size: 1.4, sizeAttenuation: false, color: 0xbfae95, transparent: true, opacity: 0.35,
    })));
  }

  const nebulae = [];
  {
    const defs = [
      ['214,112,60', new THREE.Vector3(-0.8, 0.35, -1)],
      ['52,170,168', new THREE.Vector3(0.9, -0.25, -0.8)],
      ['90,120,220', new THREE.Vector3(0.1, 0.75, 0.9)],
    ];
    for (const [rgb, dir] of defs) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeNebulaTexture(rgb),
        transparent: true, opacity: 0.28,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      sp.userData.dir = dir.clone().normalize();
      nebulae.push(sp);
      scene.add(sp);
    }
  }
  function placeNebulae() {
    for (const sp of nebulae) {
      sp.position.copy(sp.userData.dir).multiplyScalar(worldR * 3.4);
      sp.scale.set(worldR * 6.5, worldR * 6.5, 1);
    }
  }
  placeNebulae();

  /* ----- selection marker ----- */
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeRingTexture(), color: 0xffffff, depthTest: false, transparent: true,
  }));
  marker.scale.set(9, 9, 1);
  marker.visible = false;
  scene.add(marker);

  /* ----- cluster labels (HTML overlay) ----- */
  let labelEls = [];
  function buildLabels() {
    for (const el of labelEls) el.remove();
    labelEls = groups.map(g => {
      const el = document.createElement('div');
      el.className = 'g3-label';
      el.innerHTML = `${esc(g.label)}<small>${g.count}</small>`;
      el.addEventListener('click', () => app.openCluster(g));
      labelWrap.appendChild(el);
      return el;
    });
  }
  buildLabels();

  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), rightV = new THREE.Vector3();
  function updateLabels(w, h) {
    rightV.setFromMatrixColumn(camera.matrixWorld, 0);
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i], el = labelEls[i];
      vA.copy(g.c3).applyMatrix4(camera.matrixWorldInverse);
      if (vA.z > -1) { el.style.display = 'none'; continue; }
      vA.copy(g.c3).project(camera);
      vB.copy(g.c3).addScaledVector(rightV, g.r3).project(camera);
      const sx = (vA.x + 1) / 2 * w, sy = (-vA.y + 1) / 2 * h;
      const sr = Math.hypot((vB.x - vA.x) / 2 * w, (vB.y - vA.y) / 2 * h);
      if (sr < 36 || sx < -100 || sx > w + 100 || sy < -60 || sy > h + 60) { el.style.display = 'none'; continue; }
      let a = Math.min(1, (sr - 36) / 55);
      if (sr > h * 0.75) a *= Math.max(0, 1 - (sr - h * 0.75) / (h * 0.35));
      if (a <= 0.02) { el.style.display = 'none'; continue; }
      el.style.display = 'block';
      el.style.left = sx + 'px';
      el.style.top = (sy + sr * 0.72) + 'px';
      el.style.opacity = a.toFixed(2);
      el.style.fontSize = Math.max(11.5, Math.min(16, sr * 0.11)) + 'px';
    }
  }

  /* ----- visibility / refresh ----- */
  function refresh() {
    const b2a = app.b2aActive && app.b2aActive();
    for (let i = 0; i < n; i++) {
      const c = companies[i];
      let a = 0;
      if (app.inTime(c)) {
        a = app.passesFilters(c) ? (c.st === 'Inactive' ? 0.4 : 1) : 0.04;
        if (b2a && !c.sa) a = Math.min(a, 0.15);
      }
      alphaTgt[i] = a;
    }
    const sel = app.getSelected();
    if (sel && sel.p3 && app.isVisible(sel)) {
      marker.position.copy(sel.p3);
      marker.visible = true;
    } else {
      marker.visible = false;
    }
  }

  /* ----- re-cluster ----- */
  let moving = false;
  function relayout() {
    groups = app.groups();
    computeLayout();
    for (let i = 0; i < n; i++) {
      const c = companies[i];
      posTgt.set([c.p3.x, c.p3.y, c.p3.z], i * 3);
    }
    if (reduced) {
      pos.set(posTgt);
      geo.attributes.position.needsUpdate = true;
      syncRingPositions();
      syncB2APositions();
    } else {
      moving = true;
    }
    controls.maxDistance = worldR * 5;
    placeNebulae();
    buildLabels();
    refresh();
    flyHome();
  }

  /* ----- camera tweens ----- */
  let anim = null;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  function tweenTo(target, dist, dur = 900) {
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
    dir.normalize();
    anim = {
      t0: performance.now(), dur,
      fromT: controls.target.clone(), toT: target.clone(),
      fromP: camera.position.clone(), toP: target.clone().addScaledVector(dir, dist),
    };
  }

  /* ----- picking ----- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function pickAt(ev) {
    if (moving) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    ndc.set(mx / rect.width * 2 - 1, -(my / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    raycaster.params.Points.threshold = Math.max(1.5, camera.position.distanceTo(controls.target) / 300);
    const hits = raycaster.intersectObject(points);
    for (const h of hits) {
      if (alphaTgt[h.index] > 0.5) return { c: companies[h.index], mx, my };
    }
    return null;
  }

  let down = null;
  canvas.addEventListener('pointermove', ev => {
    if (down) return;
    const hit = pickAt(ev);
    canvas.classList.toggle('pointing', !!hit);
    app.setHover(hit ? hit.c : null, hit ? hit.mx : 0, hit ? hit.my : 0);
  });
  canvas.addEventListener('mouseleave', () => app.setHover(null));
  canvas.addEventListener('pointerdown', ev => { down = [ev.clientX, ev.clientY]; });
  canvas.addEventListener('pointerup', ev => {
    const wasDrag = down && Math.hypot(ev.clientX - down[0], ev.clientY - down[1]) > 5;
    down = null;
    if (wasDrag) return;
    const hit = pickAt(ev);
    if (hit) { app.showCompany(hit.c, null); refresh(); }
    else app.closePanel();
  });

  /* ----- render loop ----- */
  let rafId = null;
  let lastW = 0, lastH = 0;

  function loop(now) {
    rafId = requestAnimationFrame(loop);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (w !== lastW || h !== lastH) {
      lastW = w; lastH = h;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      mat.uniforms.uScale.value = h;
      rmat.uniforms.uScale.value = h;
    }
    if (anim) {
      const t = Math.min(1, (now - anim.t0) / anim.dur);
      const e = ease(t);
      controls.target.lerpVectors(anim.fromT, anim.toT, e);
      camera.position.lerpVectors(anim.fromP, anim.toP, e);
      if (t >= 1) anim = null;
    }
    controls.update();

    if (marker.visible) {
      const md = camera.position.distanceTo(marker.position);
      marker.scale.set(md * 0.045, md * 0.045, 1);
    }

    if (moving) {
      let maxd = 0;
      for (let i = 0; i < n * 3; i++) {
        const d = posTgt[i] - pos[i];
        pos[i] += d * 0.09;
        const ad = Math.abs(d);
        if (ad > maxd) maxd = ad;
      }
      if (maxd < 0.15) {
        pos.set(posTgt);
        moving = false;
      }
      geo.attributes.position.needsUpdate = true;
      syncRingPositions();
      syncB2APositions();
    }

    let changed = false;
    for (let i = 0; i < n; i++) {
      const d = alphaTgt[i] - alpha[i];
      if (Math.abs(d) > 0.004) { alpha[i] += d * 0.14; changed = true; }
      else if (alpha[i] !== alphaTgt[i]) { alpha[i] = alphaTgt[i]; changed = true; }
    }
    if (changed) {
      geo.attributes.aAlpha.needsUpdate = true;
      for (let j = 0; j < rn; j++) ralpha[j] = alpha[acqIdx[j]];
      rgeo.attributes.aAlpha.needsUpdate = true;
      for (let j = 0; j < bn; j++) balpha[j] = alpha[b2aIdx[j]];
      bgeo.attributes.aAlpha.needsUpdate = true;
    }

    updateLabels(w, h);
    renderer.render(scene, camera);
  }

  return {
    start() { if (!rafId) rafId = requestAnimationFrame(loop); },
    stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      for (const el of labelEls) el.style.display = 'none';
    },
    refresh,
    relayout,
    flyToCompany(c) { tweenTo(c.p3, 90); },
    flyToGroup(g) { tweenTo(g.c3, g.r3 * 2.7); },
    flyHome() { tweenTo(new THREE.Vector3(0, 0, 0), HOME_DIST); },
  };
}
