'use strict';

const COLORS = { 'AI-native': '#a78bfa', 'AI-enabled': '#2dd4bf', 'Non-AI': '#8a93a6' };
const GOLD = '#fbbf24';
const DOT_R = 2.1;
const GA = Math.PI * (3 - Math.sqrt(5));

const canvas = document.getElementById('galaxy');
const ctx = canvas.getContext('2d');
const tooltip = document.getElementById('tooltip');
const panel = document.getElementById('panel');
const panelBody = document.getElementById('panel-body');

let DATA, batches, companies, groups, quadtree;
let transform = d3.zoomIdentity;
let worldR = 1000;
let dirty = true;
let hovered = null, selected = null;
let clusterCtx = null;
let labelHits = [];
let playTimer = null;
let appearAt = new Map();
let mode = '2d';
let yc3d = null;

const state = {
  filters: { ai: new Set(), st: new Set(), ly: new Set(), hv: new Set(), cu: new Set() },
  tIdx: 0,
};

const FILTER_DEFS = [
  { key: 'ai', title: 'AI category', values: ['AI-native', 'AI-enabled', 'Non-AI'] },
  { key: 'st', title: 'Status', values: ['Active', 'Acquired', 'Inactive'] },
  { key: 'ly', title: 'Layer', values: ['Application', 'Infrastructure and tooling', 'Supply-chain'] },
  { key: 'hv', title: 'Orientation', values: ['Vertical', 'Horizontal'] },
  { key: 'cu', title: 'Customer', values: ['B2B', 'B2C', 'B2B2C', 'Developer'] },
];

/* ---------- data & layout ---------- */

fetch('data.json').then(r => r.json()).then(init);

function groupKey(c) {
  if (c.se) return 'S:' + c.se;
  if (c.fn) return 'F:' + c.fn;
  return 'U:Uncategorized';
}

function init(data) {
  DATA = data;
  batches = data.batches;
  companies = data.companies;
  state.tIdx = batches.length - 1;

  document.getElementById('brand-sub').textContent =
    companies.length.toLocaleString() + ' companies · ' + batches[0] + ' → ' + batches[batches.length - 1];

  buildLayout();
  buildSprites();
  buildFilters();
  buildTimeline();
  buildSearch();

  quadtree = d3.quadtree().x(d => d.x).y(d => d.y).addAll(companies);

  const zoom = d3.zoom()
    .scaleExtent([0.35, 80])
    .on('start', () => canvas.classList.add('dragging'))
    .on('end', () => canvas.classList.remove('dragging'))
    .on('zoom', ev => { transform = ev.transform; dirty = true; });
  d3.select(canvas).call(zoom).on('dblclick.zoom', null);
  canvas.__zoom_behavior = zoom;

  window.addEventListener('resize', () => { resize(); dirty = true; });
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', () => { setHover(null); });
  canvas.addEventListener('click', onClick);
  document.getElementById('reset-view').addEventListener('click', () => flyHome());
  document.getElementById('panel-close').addEventListener('click', closePanel);
  document.querySelectorAll('#mode-toggle button').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  resize();
  flyHome(0);
  updateCounts();
  requestAnimationFrame(frame);

  window.__yc = { groups: () => groups, openCluster, showCompany, companies: () => companies };
}

/* ---------- 2d / 3d mode ---------- */

const bridge = {
  companies: () => companies,
  groups: () => groups,
  batches: () => batches,
  colors: COLORS,
  isVisible: c => isVisible(c),
  passesFilters: c => passesFilters(c),
  inTime: c => inTime(c),
  getSelected: () => selected,
  showCompany: (c, g) => { showCompany(c, g); },
  openCluster: g => openCluster(g),
  closePanel: () => closePanel(),
  setHover: (c, mx, my) => setHover(c, mx, my),
};

async function setMode(m) {
  if (m === mode) return;
  mode = m;
  document.querySelectorAll('#mode-toggle button').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === mode));
  const c3 = document.getElementById('galaxy3d');
  const lbl = document.getElementById('labels3d');
  if (mode === '3d') {
    canvas.style.display = 'none';
    tooltip.hidden = true;
    c3.style.display = 'block';
    lbl.style.display = 'block';
    if (!yc3d) {
      try {
        const mod = await import('./app3d.js');
        yc3d = mod.init(bridge);
      } catch (e) {
        console.error('3D init failed', e);
        setMode('2d');
        return;
      }
    }
    yc3d.start();
    yc3d.refresh();
  } else {
    if (yc3d) yc3d.stop();
    c3.style.display = 'none';
    lbl.style.display = 'none';
    canvas.style.display = 'block';
    tooltip.hidden = true;
    dirty = true;
  }
}

function flyToCompany(c) {
  if (mode === '3d' && yc3d) yc3d.flyToCompany(c);
  else flyTo(c.x, c.y, 24);
}

function flyToGroup(g) {
  if (mode === '3d' && yc3d) yc3d.flyToGroup(g);
  else flyTo(g.x, g.y, g.r * 1.15);
}

function buildLayout() {
  const byGroup = d3.group(companies, groupKey);

  // detect name collisions between sector-groups and function-groups
  const names = new Map();
  for (const key of byGroup.keys()) {
    const n = key.slice(2);
    names.set(n, (names.get(n) || 0) + 1);
  }

  groups = [];
  for (const [key, list] of byGroup) {
    const bySub = d3.group(list, c => c.su || 'General');
    const subs = [];
    for (const [subName, subList] of bySub) {
      const n = subList.length;
      const r = 5.6 * Math.sqrt(n) + 4;
      subs.push({ name: subName, list: subList, r: r + 2.5 });
    }
    subs.sort((a, b) => b.list.length - a.list.length);
    d3.packSiblings(subs);
    const enc = d3.packEnclose(subs);

    const base = key.slice(2);
    let label = base;
    if (names.get(base) > 1) label += key[0] === 'S' ? ' (vertical)' : ' (horizontal)';

    groups.push({
      key, label,
      type: key[0] === 'S' ? 'Sector' : (key[0] === 'F' ? 'Horizontal function' : ''),
      subs, count: list.length,
      encX: enc.x, encY: enc.y,
      r: enc.r + 7,
    });
  }

  groups.sort((a, b) => b.count - a.count);
  const packed = groups.map(g => ({ g, r: g.r + 13 }));
  d3.packSiblings(packed);
  const world = d3.packEnclose(packed);
  worldR = world.r;

  for (const p of packed) {
    const g = p.g;
    g.x = p.x - world.x;
    g.y = p.y - world.y;
    for (const sub of g.subs) {
      sub.cx = g.x + sub.x - g.encX;
      sub.cy = g.y + sub.y - g.encY;
      // phyllotaxis dots inside the sub-cluster
      const list = sub.list;
      const seed = hash(sub.name) % 360 * Math.PI / 180;
      for (let i = 0; i < list.length; i++) {
        const rr = 5.6 * Math.sqrt(i + 0.4);
        const th = i * GA + seed;
        list[i].x = sub.cx + rr * Math.cos(th);
        list[i].y = sub.cy + rr * Math.sin(th);
        list[i].group = g;
        list[i].subName = sub.name;
      }
    }
  }
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/* ---------- sprites ---------- */

const sprites = {};
const SPRITE = 64;

function makeSprite(color, { dim = false, ring = false } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d');
  const cx = SPRITE / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  if (dim) {
    grad.addColorStop(0, hexA(color, 0.55));
    grad.addColorStop(0.3, hexA(color, 0.22));
    grad.addColorStop(1, hexA(color, 0));
  } else {
    const center = color === COLORS['Non-AI'] ? '#c9d0dd' : '#ffffff';
    grad.addColorStop(0, center);
    grad.addColorStop(0.15, color);
    grad.addColorStop(0.42, hexA(color, 0.42));
    grad.addColorStop(1, hexA(color, 0));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, SPRITE, SPRITE);
  if (ring) {
    g.beginPath();
    g.arc(cx, cx, SPRITE / 6 + 5, 0, Math.PI * 2);
    g.strokeStyle = GOLD;
    g.lineWidth = 2.5;
    g.stroke();
  }
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

function buildSprites() {
  for (const [ai, color] of Object.entries(COLORS)) {
    sprites[ai + '|Active'] = makeSprite(color);
    sprites[ai + '|Inactive'] = makeSprite(color, { dim: true });
    sprites[ai + '|Acquired'] = makeSprite(color, { ring: true });
  }
}

function spriteFor(c) {
  const ai = COLORS[c.ai] ? c.ai : 'Non-AI';
  const st = (c.st === 'Acquired' || c.st === 'Inactive') ? c.st : 'Active';
  return sprites[ai + '|' + st];
}

/* ---------- visibility ---------- */

function passesFilters(c) {
  const f = state.filters;
  return (!f.ai.size || f.ai.has(c.ai)) &&
         (!f.st.size || f.st.has(c.st)) &&
         (!f.ly.size || f.ly.has(c.ly)) &&
         (!f.hv.size || f.hv.has(c.hv)) &&
         (!f.cu.size || f.cu.has(c.cu));
}

function inTime(c) { return c.b <= state.tIdx; }
function isVisible(c) { return inTime(c) && passesFilters(c); }

/* ---------- render ---------- */

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.__dpr = dpr;
}

function frame(now) {
  let animating = false;
  if (appearAt.size) animating = true;
  if (dirty || animating) {
    draw(now);
    dirty = false;
  }
  requestAnimationFrame(frame);
}

function draw(now) {
  const dpr = canvas.__dpr || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // faint background stars
  drawBackdrop(w, h);

  const t = transform;
  ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);

  // cluster halos
  ctx.lineWidth = 1 / t.k;
  for (const g of groups) {
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(90, 110, 170, 0.10)';
    ctx.stroke();
  }

  const R = DOT_R * 5;
  for (const c of companies) {
    if (!inTime(c)) { appearAt.delete(c); continue; }
    let alpha = 1;
    const ap = appearAt.get(c);
    if (ap !== undefined) {
      const p = (now - ap) / 500;
      if (p >= 1) appearAt.delete(c);
      else alpha = Math.max(0, p);
    }
    if (!passesFilters(c)) alpha *= 0.06;
    ctx.globalAlpha = alpha;
    ctx.drawImage(spriteFor(c), c.x - R, c.y - R, R * 2, R * 2);
  }
  ctx.globalAlpha = 1;

  // selection ring
  if (selected && isVisible(selected)) {
    ctx.beginPath();
    ctx.arc(selected.x, selected.y, DOT_R + 6 / t.k, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.6 / t.k;
    ctx.stroke();
  }

  drawLabels(dpr, t);
}

let backdrop = null;
function drawBackdrop(w, h) {
  if (!backdrop || backdrop.width !== w || backdrop.height !== h) {
    backdrop = document.createElement('canvas');
    backdrop.width = w; backdrop.height = h;
    const g = backdrop.getContext('2d');
    const rng = d3.randomLcg(42);
    for (let i = 0; i < 340; i++) {
      const x = rng() * w, y = rng() * h, r = rng() * 0.9 + 0.2;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = `rgba(160,175,215,${0.05 + rng() * 0.13})`;
      g.fill();
    }
  }
  ctx.drawImage(backdrop, 0, 0);
}

function drawLabels(dpr, t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  labelHits = [];

  for (const g of groups) {
    const sr = g.r * t.k;
    if (sr < 26) continue;
    const alpha = Math.min(1, (sr - 26) / 44);
    const sx = t.applyX(g.x);
    const sy = t.applyY(g.y) + sr;
    const fs = Math.max(11.5, Math.min(17, sr * 0.11));
    ctx.font = `500 ${fs}px 'Space Grotesk', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const text = g.label;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = `rgba(226, 232, 244, ${0.9 * alpha})`;
    ctx.fillText(text, sx, sy + 5);
    ctx.font = `400 ${Math.max(10, fs * 0.72)}px Inter, sans-serif`;
    ctx.fillStyle = `rgba(120, 133, 165, ${0.9 * alpha})`;
    ctx.fillText(String(g.count), sx, sy + 5 + fs + 3);
    labelHits.push({ g, x0: sx - tw / 2 - 6, x1: sx + tw / 2 + 6, y0: sy, y1: sy + 5 + fs * 1.9 });

    // sub-cluster labels once zoomed in
    if (t.k > 2 && g.subs.length > 1) {
      for (const sub of g.subs) {
        if (sub.name === 'General' || sub.list.length < 3) continue;
        const ssr = sub.r * t.k;
        if (ssr < 52) continue;
        const sa = Math.min(1, (ssr - 52) / 60) * Math.min(1, alpha + 0.4);
        const sfx = t.applyX(sub.cx), sfy = t.applyY(sub.cy);
        ctx.font = `400 11px Inter, sans-serif`;
        ctx.fillStyle = `rgba(190, 200, 228, ${0.75 * sa})`;
        ctx.fillText(sub.name, sfx, sfy + ssr - 4);
      }
    }
  }
}

/* ---------- interaction ---------- */

function pick(mx, my) {
  const [wx, wy] = transform.invert([mx, my]);
  const found = quadtree.find(wx, wy, Math.max(DOT_R * 3, 9 / transform.k));
  if (found && isVisible(found)) return found;
  return null;
}

function onMove(ev) {
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const c = pick(mx, my);
  setHover(c, mx, my);
  if (!c) {
    const overLabel = labelHits.some(l => mx >= l.x0 && mx <= l.x1 && my >= l.y0 && my <= l.y1);
    canvas.classList.toggle('pointing', overLabel);
  } else {
    canvas.classList.add('pointing');
  }
}

function setHover(c, mx, my) {
  hovered = c;
  if (!c) { tooltip.hidden = true; return; }
  tooltip.innerHTML = `<div class="tt-name">${esc(c.n)}</div><div class="tt-line">${esc(c.o || '')}</div>`;
  tooltip.hidden = false;
  const stageRect = canvas.getBoundingClientRect();
  let tx = mx + 14, ty = my + 14;
  const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
  if (tx + tw > stageRect.width - 10) tx = mx - tw - 14;
  if (ty + th > stageRect.height - 10) ty = my - th - 14;
  tooltip.style.left = tx + 'px';
  tooltip.style.top = ty + 'px';
}

function onClick(ev) {
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
  const c = pick(mx, my);
  if (c) { showCompany(c, clusterCtx); return; }
  const l = labelHits.find(l => mx >= l.x0 && mx <= l.x1 && my >= l.y0 && my <= l.y1);
  if (l) { openCluster(l.g); return; }
  closePanel();
}

/* ---------- camera ---------- */

function flyTo(x, y, r, ms = 750) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const railW = 218, panelW = panel.hidden ? 0 : 340;
  const availW = w - railW - panelW;
  const k = Math.min(80, 0.5 * Math.min(availW, h) / r);
  const t = d3.zoomIdentity.translate(railW + availW / 2 - x * k, h / 2 - y * k).scale(k);
  d3.select(canvas).transition().duration(ms).call(canvas.__zoom_behavior.transform, t);
}

function flyHome(ms = 750) {
  if (mode === '3d' && yc3d) { yc3d.flyHome(); return; }
  const railW = 218, panelW = panel.hidden ? 0 : 340;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const availW = w - railW - panelW;
  const k = Math.min(availW, h - 90) / (2 * worldR * 1.06);
  const t = d3.zoomIdentity.translate(railW + availW / 2, h / 2 - 10).scale(k);
  const sel = d3.select(canvas);
  if (ms) sel.transition().duration(ms).call(canvas.__zoom_behavior.transform, t);
  else sel.call(canvas.__zoom_behavior.transform, t);
}

/* ---------- panel ---------- */

function ycUrl(c) {
  const slug = c.n.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return 'https://www.ycombinator.com/companies/' + slug;
}

function showCompany(c, fromCluster) {
  selected = c;
  clusterCtx = fromCluster || null;
  const chain = c.se ? `${esc(c.se)}${c.su ? ' · ' + esc(c.su) : ''}` : (c.fn ? esc(c.fn) : '—');
  const rows = [
    ['HQ', c.h], ['Batch', batches[c.b]],
    [c.se ? 'Sector' : 'Function', chain],
    ['Layer', c.ly], ['Orientation', c.hv], ['Customer', c.cu], ['Model', c.mo],
  ].filter(r => r[1]);
  panelBody.innerHTML = `
    ${clusterCtx ? `<button class="p-back" id="p-back">← ${esc(clusterCtx.label)}</button>` : ''}
    <div class="p-name">${esc(c.n)}</div>
    <div class="p-chips">
      <span class="pill ${c.ai === 'AI-native' ? 'ai-native' : c.ai === 'AI-enabled' ? 'ai-enabled' : ''}">${esc(c.ai)}</span>
      <span class="pill st-${esc(c.st)}">${esc(c.st)}</span>
    </div>
    <div class="p-oneliner">${esc(c.o || '')}</div>
    <div class="p-rows">${rows.map(r =>
      `<div class="p-row"><div class="p-key">${r[0]}</div><div class="p-val">${r[0] === 'Sector' || r[0] === 'Function' ? r[1] : esc(String(r[1]))}</div></div>`
    ).join('')}</div>
    <div class="p-links">
      ${c.w ? `<a href="${escAttr(cleanUrl(c.w))}" target="_blank" rel="noopener">Website ↗</a>` : ''}
      <a class="ghost" href="${escAttr(ycUrl(c))}" target="_blank" rel="noopener">YC page ↗</a>
    </div>`;
  panel.hidden = false;
  document.body.classList.add('panel-open');
  const back = document.getElementById('p-back');
  if (back) back.addEventListener('click', () => openCluster(clusterCtx));
  dirty = true;
  if (yc3d) yc3d.refresh();
}

function openCluster(g) {
  selected = null;
  clusterCtx = g;
  panel.hidden = false;
  document.body.classList.add('panel-open');
  flyToGroup(g);
  const visible = [];
  const bySub = new Map();
  for (const sub of g.subs) {
    const vis = sub.list.filter(isVisible);
    if (vis.length) bySub.set(sub.name, vis);
    visible.push(...vis);
  }
  const sections = [...bySub.entries()].sort((a, b) => b[1].length - a[1].length);
  panelBody.innerHTML = `
    <div class="cl-title">${esc(g.label)}</div>
    <div class="cl-sub">${g.type}${g.type ? ' · ' : ''}${visible.length} of ${g.count} companies shown</div>
    ${sections.map(([name, list]) => `
      ${(sections.length > 1 && name !== 'General') ? `<div class="cl-section">${esc(name)} (${list.length})</div>` : (sections.length > 1 ? `<div class="cl-section">Other (${list.length})</div>` : '')}
      ${list.map(c => `
        <div class="cl-item" data-i="${companies.indexOf(c)}">
          <div class="cl-item-name"><span class="cl-item-dot" style="background:${COLORS[c.ai] || COLORS['Non-AI']}"></span>${esc(c.n)}</div>
          <div class="cl-item-line">${esc(c.o || '')}</div>
        </div>`).join('')}
    `).join('')}`;
  panel.hidden = false;
  panelBody.parentElement.scrollTop = 0;
  panelBody.querySelectorAll('.cl-item').forEach(el => {
    el.addEventListener('click', () => {
      const c = companies[+el.dataset.i];
      showCompany(c, g);
      flyToCompany(c);
    });
  });
  dirty = true;
  if (yc3d) yc3d.refresh();
}

function closePanel() {
  panel.hidden = true;
  document.body.classList.remove('panel-open');
  selected = null;
  clusterCtx = null;
  dirty = true;
  if (yc3d) yc3d.refresh();
}

/* ---------- filters ---------- */

function buildFilters() {
  const wrap = document.getElementById('filters');
  wrap.innerHTML = FILTER_DEFS.map(def => `
    <div class="f-group">
      <div class="f-title">${def.title}</div>
      <div class="f-chips">${def.values.map(v => `
        <button class="chip" data-k="${def.key}" data-v="${escAttr(v)}">${shortName(v)}<span class="cnt"></span></button>
      `).join('')}</div>
    </div>`).join('');
  wrap.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const set = state.filters[chip.dataset.k];
      const v = chip.dataset.v;
      if (set.has(v)) set.delete(v); else set.add(v);
      chip.classList.toggle('on');
      updateCounts();
      dirty = true;
    });
  });
}

function shortName(v) {
  if (v === 'Infrastructure and tooling') return 'Infra & tooling';
  return v;
}

function updateCounts() {
  let visible = 0;
  const counts = {};
  for (const def of FILTER_DEFS) counts[def.key] = {};
  for (const c of companies) {
    if (isVisible(c)) visible++;
    if (!inTime(c)) continue;
    for (const def of FILTER_DEFS) {
      const f = { ...state.filters, [def.key]: new Set() };
      const passOthers = FILTER_DEFS.every(d2 =>
        d2.key === def.key || !state.filters[d2.key].size || state.filters[d2.key].has(c[d2.key]));
      if (passOthers) {
        const v = c[def.key];
        counts[def.key][v] = (counts[def.key][v] || 0) + 1;
      }
    }
  }
  document.getElementById('visible-count').innerHTML =
    `<b>${visible.toLocaleString()}</b> of ${companies.length.toLocaleString()} companies`;
  document.querySelectorAll('.chip').forEach(chip => {
    const n = counts[chip.dataset.k][chip.dataset.v] || 0;
    chip.querySelector('.cnt').textContent = n;
  });
  if (yc3d) yc3d.refresh();
}

/* ---------- timeline ---------- */

function buildTimeline() {
  const scrub = document.getElementById('scrubber');
  scrub.max = batches.length - 1;
  scrub.value = batches.length - 1;
  scrub.addEventListener('input', () => setTime(+scrub.value, false));
  document.getElementById('play').addEventListener('click', togglePlay);
  updateTimelineLabel();
}

function setTime(idx, animate) {
  const prev = state.tIdx;
  state.tIdx = idx;
  if (animate && idx > prev) {
    const now = performance.now();
    for (const c of companies) {
      if (c.b > prev && c.b <= idx) appearAt.set(c, now);
    }
  }
  document.getElementById('scrubber').value = idx;
  updateTimelineLabel();
  updateCounts();
  dirty = true;
}

function updateTimelineLabel() {
  const idx = state.tIdx;
  const cum = companies.filter(c => c.b <= idx).length;
  const inBatch = companies.filter(c => c.b === idx);
  const aiShare = inBatch.length ? Math.round(100 * inBatch.filter(c => c.ai === 'AI-native').length / inBatch.length) : 0;
  document.getElementById('timeline-label').innerHTML =
    `<b>${batches[idx]}</b> · ${cum.toLocaleString()} cos · ${aiShare}% AI-native`;
}

function togglePlay() {
  if (playTimer) { stopPlay(); return; }
  if (state.tIdx >= batches.length - 1) setTime(0, false);
  document.getElementById('play-icon').hidden = true;
  document.getElementById('pause-icon').hidden = false;
  playTimer = setInterval(() => {
    if (state.tIdx >= batches.length - 1) { stopPlay(); return; }
    setTime(state.tIdx + 1, true);
  }, 1000);
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  document.getElementById('play-icon').hidden = false;
  document.getElementById('pause-icon').hidden = true;
}

/* ---------- search ---------- */

function buildSearch() {
  const input = document.getElementById('search');
  const results = document.getElementById('search-results');
  let items = [];
  let active = -1;

  function render(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) { results.hidden = true; return; }
    const starts = [], contains = [];
    for (const c of companies) {
      const n = c.n.toLowerCase();
      if (n.startsWith(q)) starts.push(c);
      else if (n.includes(q)) contains.push(c);
      if (starts.length > 8) break;
    }
    items = starts.concat(contains).slice(0, 8);
    active = -1;
    if (!items.length) { results.hidden = true; return; }
    results.innerHTML = items.map((c, i) => `
      <div class="sr-item" data-i="${i}">
        <span class="sr-name">${esc(c.n)}</span>
        <span class="sr-meta">${esc(batches[c.b])} · ${esc(c.se || c.fn || '')}</span>
      </div>`).join('');
    results.hidden = false;
    results.querySelectorAll('.sr-item').forEach(el => {
      el.addEventListener('mousedown', ev => { ev.preventDefault(); choose(items[+el.dataset.i]); });
    });
  }

  function choose(c) {
    results.hidden = true;
    input.value = c.n;
    if (c.b > state.tIdx) setTime(batches.length - 1, false);
    showCompany(c, null);
    flyToCompany(c);
  }

  input.addEventListener('input', () => render(input.value));
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
  input.addEventListener('keydown', ev => {
    if (results.hidden) return;
    if (ev.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); }
    else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); }
    else if (ev.key === 'Enter') { if (items[Math.max(0, active)]) choose(items[Math.max(0, active)]); return; }
    else if (ev.key === 'Escape') { results.hidden = true; return; }
    else return;
    ev.preventDefault();
    results.querySelectorAll('.sr-item').forEach((el, i) => el.classList.toggle('active', i === active));
  });
}

/* ---------- utils ---------- */

function cleanUrl(u) {
  try {
    const url = new URL(u);
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_id'].forEach(p => url.searchParams.delete(p));
    return url.toString();
  } catch { return u; }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escAttr(s) { return esc(s); }
