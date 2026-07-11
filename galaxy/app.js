'use strict';

const COLORS = { 'AI-native': '#9db8ff', 'AI-enabled': '#ffd98e', 'Non-AI': '#f07b5a' };
const RING = '#7fe8c3';
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
let groupBy = 'sector';
let morph = null;
let b2aOn = false;
let floorFilter = null;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const B2A_COLOR = '#38d4f0';

// Agent-stack floors, in the order the report presents them, grouped by layer.
const B2A_STACK = [
  ['Act', ['Browser & computer use', 'Compute, sandboxes & runtime', 'Memory & context', 'Integrations & tooling', 'Build / dev frameworks']],
  ['Be trusted', ['Identity, access & trust', 'Observability, testing & safety', 'Communication (email, phone)', 'Payments & spend', 'Insurance & liability']],
  ['Human', ['Human escalation & labor']],
];
const AUTONOMY_ORDER = ['Human-approves-each', 'Agent-within-mandate', 'Agent-to-agent'];
const AUTONOMY_SHORT = { 'Human-approves-each': 'Human-approves', 'Agent-within-mandate': 'Agent-within-mandate', 'Agent-to-agent': 'Agent-to-agent' };
const PAYMENTS_FLOOR = 'Payments & spend';

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

/* ---------- geography buckets ---------- */

const BAY = new Set(['san francisco', 'oakland', 'berkeley', 'palo alto', 'menlo park', 'mountain view', 'sunnyvale', 'san jose', 'santa clara', 'redwood city', 'san mateo', 'south san francisco', 'burlingame', 'emeryville', 'fremont', 'cupertino', 'los altos', 'foster city', 'san carlos', 'campbell', 'hayward', 'walnut creek', 'sausalito', 'mill valley', 'san bruno', 'daly city', 'stanford', 'milpitas', 'pleasanton', 'san rafael', 'saratoga', 'los gatos', 'alameda', 'santa cruz']);
const SOCAL = new Set(['los angeles', 'santa monica', 'culver city', 'venice', 'pasadena', 'irvine', 'san diego', 'long beach', 'newport beach', 'west hollywood', 'glendale', 'burbank', 'el segundo', 'manhattan beach', 'costa mesa', 'carlsbad', 'encinitas', 'la jolla', 'torrance', 'anaheim', 'santa barbara', 'hawthorne']);
const EUROPE = new Set(['germany', 'france', 'spain', 'switzerland', 'sweden', 'denmark', 'netherlands', 'ireland', 'italy', 'portugal', 'poland', 'austria', 'belgium', 'finland', 'norway', 'estonia', 'czech republic', 'czechia', 'greece', 'romania', 'hungary', 'croatia', 'lithuania', 'latvia', 'luxembourg', 'iceland', 'ukraine', 'bulgaria', 'slovakia', 'slovenia', 'serbia', 'cyprus', 'malta', 'armenia', 'georgia']);
const LATAM = new Set(['mexico', 'brazil', 'colombia', 'argentina', 'chile', 'peru', 'panama', 'uruguay', 'ecuador', 'costa rica', 'guatemala', 'bolivia', 'venezuela', 'dominican republic', 'el salvador', 'paraguay', 'honduras', 'puerto rico', 'nicaragua']);
const AFRICA = new Set(['nigeria', 'kenya', 'ghana', 'egypt', 'south africa', 'morocco', 'tunisia', 'uganda', 'rwanda', 'ethiopia', 'senegal', 'ivory coast', "côte d'ivoire", 'tanzania', 'zambia', 'algeria', 'cameroon', 'benin', 'togo', 'zimbabwe', 'mauritius']);
const MIDEAST = new Set(['israel', 'united arab emirates', 'saudi arabia', 'qatar', 'bahrain', 'kuwait', 'jordan', 'lebanon', 'turkey', 'oman']);
const APAC = new Set(['singapore', 'indonesia', 'vietnam', 'pakistan', 'japan', 'south korea', 'korea', 'china', 'hong kong', 'taiwan', 'philippines', 'thailand', 'malaysia', 'bangladesh', 'sri lanka', 'nepal', 'australia', 'new zealand', 'kazakhstan', 'myanmar', 'cambodia']);
const US_METRO = { NY: 'New York', WA: 'Seattle', TX: 'Texas', MA: 'Boston', FL: 'Miami' };

function geoOf(c) {
  const h = (c.h || '').split(';')[0].trim();
  if (!h) return 'Remote / unlisted';
  const parts = h.split(',').map(s => s.trim());
  const country = parts[parts.length - 1];
  const lc = country.toLowerCase();
  if (lc === 'remote') return 'Remote / unlisted';
  if (country === 'USA') {
    const state = parts.length >= 3 ? parts[parts.length - 2] : '';
    const city = (parts[0] || '').toLowerCase();
    if (state === 'CA') {
      if (BAY.has(city)) return 'SF Bay Area';
      if (SOCAL.has(city)) return 'Southern California';
      return 'California — other';
    }
    return US_METRO[state] || 'US — other';
  }
  if (country === 'United Kingdom') return 'United Kingdom';
  if (country === 'India') return 'India';
  if (country === 'Canada') return 'Canada';
  if (EUROPE.has(lc)) return 'Europe';
  if (LATAM.has(lc)) return 'Latin America';
  if (AFRICA.has(lc)) return 'Africa';
  if (MIDEAST.has(lc)) return 'Middle East';
  if (APAC.has(lc)) return 'Asia-Pacific';
  return 'Rest of world';
}

/* ---------- grouping ---------- */

function groupKey(c) {
  if (groupBy === 'geo') return 'G:' + (c.geo || (c.geo = geoOf(c)));
  if (groupBy === 'model') return 'M:' + (c.mo || 'Unknown');
  if (c.se) return 'S:' + c.se;
  if (c.fn) return 'F:' + c.fn;
  return 'U:Uncategorized';
}

function subName(c) {
  if (groupBy === 'sector') return c.su || 'General';
  return c.se || c.fn || 'General';
}

function init(data) {
  DATA = data;
  batches = data.batches;
  companies = data.companies;
  state.tIdx = batches.length - 1;

  document.getElementById('brand-sub').textContent =
    companies.length.toLocaleString() + ' companies · ' + batches[0] + ' → ' + batches[batches.length - 1];

  buildLayout(false);
  buildSprites();
  buildFilters();
  buildTimeline();
  buildSearch();

  rebuildQuadtree();
  document.querySelectorAll('#groupby .chip').forEach(b =>
    b.addEventListener('click', () => setGroupBy(b.dataset.g)));

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
  ringColor: RING,
  reducedMotion: REDUCED_MOTION,
  isVisible: c => isVisible(c),
  passesFilters: c => passesFilters(c),
  inTime: c => inTime(c),
  b2aActive: () => b2aOn,
  floorFilter: () => floorFilter,
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

const TYPE_LABEL = { S: 'Sector', F: 'Horizontal function', G: 'Region', M: 'Business model', U: '' };

function buildLayout(animate) {
  const byGroup = d3.group(companies, groupKey);

  // detect name collisions between sector-groups and function-groups
  const names = new Map();
  for (const key of byGroup.keys()) {
    const n = key.slice(2);
    names.set(n, (names.get(n) || 0) + 1);
  }

  groups = [];
  for (const [key, list] of byGroup) {
    const bySub = d3.group(list, subName);
    const subs = [];
    for (const [sName, subList] of bySub) {
      const n = subList.length;
      const r = 5.6 * Math.sqrt(n) + 4;
      subs.push({ name: sName, list: subList, r: r + 2.5 });
    }
    subs.sort((a, b) => b.list.length - a.list.length);
    d3.packSiblings(subs);
    const enc = d3.packEnclose(subs);

    const base = key.slice(2);
    let label = base;
    if (names.get(base) > 1) label += key[0] === 'S' ? ' (vertical)' : ' (horizontal)';

    groups.push({
      key, label,
      type: TYPE_LABEL[key[0]] || '',
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
        const c = list[i];
        c.tx = sub.cx + rr * Math.cos(th);
        c.ty = sub.cy + rr * Math.sin(th);
        c.group = g;
        c.subName = sub.name;
        if (!animate) { c.x = c.tx; c.y = c.ty; }
        else { c.x0 = c.x; c.y0 = c.y; }
      }
    }
  }
}

function rebuildQuadtree() {
  quadtree = d3.quadtree().x(d => d.x).y(d => d.y).addAll(companies);
}

function setGroupBy(g) {
  if (g === groupBy) return;
  groupBy = g;
  document.querySelectorAll('#groupby .chip').forEach(b =>
    b.classList.toggle('on', b.dataset.g === groupBy));
  closePanel();
  setHover(null);
  buildLayout(true);
  if (REDUCED_MOTION) {
    for (const c of companies) { c.x = c.tx; c.y = c.ty; }
    rebuildQuadtree();
  } else {
    morph = { t0: performance.now(), dur: 1200 };
  }
  flyHome(900);
  if (yc3d) yc3d.relayout();
  dirty = true;
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
    const center = color === COLORS['Non-AI'] ? '#ffe3d1' : '#ffffff';
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
    g.strokeStyle = RING;
    g.lineWidth = 2.5;
    g.stroke();
  }
  return c;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

/* B2A marker: a thin cyan outer ring, drawn over the dot for agent-serving
   companies. Sits outside the (aurora) acquired ring so a company that is both
   shows both rings. */
let b2aRingSprite = null;
function makeB2ARing() {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE;
  const g = c.getContext('2d');
  const cx = SPRITE / 2;
  g.beginPath();
  g.arc(cx, cx, SPRITE / 6 + 9, 0, Math.PI * 2);
  g.strokeStyle = B2A_COLOR;
  g.lineWidth = 2;
  g.stroke();
  return c;
}

function buildSprites() {
  for (const [ai, color] of Object.entries(COLORS)) {
    sprites[ai + '|Active'] = makeSprite(color);
    sprites[ai + '|Inactive'] = makeSprite(color, { dim: true });
    sprites[ai + '|Acquired'] = makeSprite(color, { ring: true });
  }
  b2aRingSprite = makeB2ARing();
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

let homed = false;

function frame(now) {
  if (!homed && canvas.clientWidth > 320 && canvas.clientHeight > 200) {
    homed = true;
    resize();
    flyHome(0);
  }
  let animating = appearAt.size > 0;
  if (morph) {
    const t = Math.min(1, (now - morph.t0) / morph.dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    for (const c of companies) {
      c.x = c.x0 + (c.tx - c.x0) * e;
      c.y = c.y0 + (c.ty - c.y0) * e;
    }
    if (t >= 1) {
      morph = null;
      for (const c of companies) { c.x = c.tx; c.y = c.ty; }
      rebuildQuadtree();
    }
    animating = true;
  }
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
  if (!morph) {
    ctx.lineWidth = 1 / t.k;
    for (const g of groups) {
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(196, 164, 120, 0.09)';
      ctx.stroke();
    }
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
    if (b2aOn && !c.sa) alpha *= 0.15;
    if (floorFilter && c.af !== floorFilter) alpha *= 0.15;
    ctx.globalAlpha = alpha;
    ctx.drawImage(spriteFor(c), c.x - R, c.y - R, R * 2, R * 2);
    if (c.sa) ctx.drawImage(b2aRingSprite, c.x - R, c.y - R, R * 2, R * 2);
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

    // nebula dust — rust, teal, deep blue washes
    g.globalCompositeOperation = 'lighter';
    const clouds = [
      ['94,47,23', 0.16], ['15,63,68', 0.15], ['22,41,79', 0.13],
      ['94,47,23', 0.10], ['15,63,68', 0.10],
    ];
    for (const [rgb, a] of clouds) {
      const x = rng() * w, y = rng() * h;
      const r = (0.28 + rng() * 0.3) * Math.max(w, h);
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${rgb},${a})`);
      grad.addColorStop(0.55, `rgba(${rgb},${a * 0.35})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = grad;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';

    // distant starfield
    for (let i = 0; i < 340; i++) {
      const x = rng() * w, y = rng() * h, r = rng() * 0.9 + 0.2;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      const warm = rng() > 0.7;
      g.fillStyle = warm
        ? `rgba(235,205,170,${0.05 + rng() * 0.14})`
        : `rgba(175,190,225,${0.05 + rng() * 0.13})`;
      g.fill();
    }

    // a few bright glint stars with cross flares
    for (let i = 0; i < 7; i++) {
      const x = rng() * w, y = rng() * h;
      const len = 5 + rng() * 9, a = 0.25 + rng() * 0.3;
      const warm = rng() > 0.5;
      const col = warm ? `235,210,180` : `190,205,240`;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const lg = g.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
        lg.addColorStop(0, `rgba(${col},0)`);
        lg.addColorStop(0.5, `rgba(${col},${a})`);
        lg.addColorStop(1, `rgba(${col},0)`);
        g.strokeStyle = lg;
        g.lineWidth = 0.8;
        g.beginPath();
        g.moveTo(x - dx * len, y - dy * len);
        g.lineTo(x + dx * len, y + dy * len);
        g.stroke();
      }
      g.beginPath();
      g.arc(x, y, 1.1, 0, Math.PI * 2);
      g.fillStyle = `rgba(${col},${a + 0.25})`;
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
    ctx.fillStyle = `rgba(242, 237, 226, ${0.9 * alpha})`;
    ctx.fillText(text, sx, sy + 5);
    ctx.font = `400 ${Math.max(10, fs * 0.72)}px Inter, sans-serif`;
    ctx.fillStyle = `rgba(158, 152, 138, ${0.9 * alpha})`;
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
        ctx.fillStyle = `rgba(226, 218, 200, ${0.75 * sa})`;
        ctx.fillText(sub.name, sfx, sfy + ssr - 4);
      }
    }
  }
}

/* ---------- interaction ---------- */

function pick(mx, my) {
  if (morph) return null;
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
  const k = Math.max(0.05, Math.min(availW, h - 90) / (2 * worldR * 1.06));
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
  const floorVal = c.af
    ? `${esc(shortFloor(c.af))}${c.pa ? ' · ' + esc(c.pa) : ''}${(c.afp || c.pa) ? ' <span class="prov-tag">provisional</span>' : ''}`
    : '';
  const rows = [
    ['HQ', c.h], ['Batch', batches[c.b]],
    [c.se ? 'Sector' : 'Function', chain],
    ['Agent floor', floorVal],
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
      `<div class="p-row"><div class="p-key">${r[0]}</div><div class="p-val">${r[0] === 'Sector' || r[0] === 'Function' || r[0] === 'Agent floor' ? r[1] : esc(String(r[1]))}</div></div>`
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

  // B2A overlay chip — highlights the agent-serving companies in place. It is an
  // overlay, not a customer filter: it dims everything else and keeps each star
  // in its current cluster, so it combines with the other filters.
  const b2aCount = companies.filter(c => c.sa).length;
  const groupChips = wrap.querySelectorAll('.f-group .f-chips');
  const custChips = groupChips[groupChips.length - 1];
  if (custChips && b2aCount) {
    const chip = document.createElement('button');
    chip.className = 'chip chip-b2a';
    chip.id = 'b2a-chip';
    chip.innerHTML = `B2A <span class="cnt">${b2aCount}</span>`;
    chip.title = `Serves agents (B2A) — highlight the ${b2aCount} companies building for AI agents`;
    chip.addEventListener('click', toggleB2A);
    custChips.appendChild(chip);
  }
}

function toggleB2A() {
  b2aOn = !b2aOn;
  floorFilter = null;
  const chip = document.getElementById('b2a-chip');
  if (chip) chip.classList.toggle('on', b2aOn);
  const panelEl = document.getElementById('b2a-floors');
  if (b2aOn) { buildB2AFloors(); panelEl.hidden = false; }
  else { panelEl.hidden = true; }
  dirty = true;
  if (yc3d) yc3d.refresh();
}

function selectFloor(floor) {
  floorFilter = (floorFilter === floor) ? null : floor;
  buildB2AFloors();
  dirty = true;
  if (yc3d) yc3d.refresh();
}

function buildB2AFloors() {
  const wrap = document.getElementById('b2a-floors');
  const b2a = companies.filter(c => c.sa);
  const byFloor = {};
  for (const c of b2a) (byFloor[c.af] = byFloor[c.af] || []).push(c);
  let hasProv = false;

  const groupsHtml = B2A_STACK.map(([group, floors]) => {
    const rows = floors.map(f => {
      const list = byFloor[f] || [];
      if (!list.length) return '';
      const prov = list.filter(c => c.afp).length;
      if (prov) hasProv = true;
      const on = floorFilter === f;
      const dagger = prov ? '<span class="prov-mark">†</span>' : '';
      let extra = '';
      if (f === PAYMENTS_FLOOR) {
        const byAuto = {};
        for (const c of list) if (c.pa) byAuto[c.pa] = (byAuto[c.pa] || 0) + 1;
        const parts = AUTONOMY_ORDER.filter(a => byAuto[a]).map(a => `${AUTONOMY_SHORT[a]} ${byAuto[a]}`);
        if (parts.length) extra = `<div class="floor-auto">${parts.join(' · ')}</div>`;
      }
      return `<button class="floor-row${on ? ' on' : ''}" data-floor="${escAttr(f)}">
        <span class="floor-name">${esc(shortFloor(f))}${dagger}</span>
        <span class="floor-n">${list.length}</span>
      </button>${extra}`;
    }).join('');
    return `<div class="floor-group"><div class="f-title">${esc(group)}</div>${rows}</div>`;
  }).join('');

  wrap.innerHTML = `
    <div class="f-title" style="color:#8fe6f5">Agent stack · ${b2a.length}</div>
    ${groupsHtml}
    ${hasProv ? `<div class="floor-note">† includes provisional first-pass floor reads (19 companies). Payment-autonomy values are all provisional.</div>` : ''}`;
  wrap.querySelectorAll('.floor-row').forEach(el =>
    el.addEventListener('click', () => selectFloor(el.dataset.floor)));
}

function shortFloor(f) {
  return f
    .replace('Browser & computer use', 'Browser & computer')
    .replace('Compute, sandboxes & runtime', 'Compute & sandboxes')
    .replace('Observability, testing & safety', 'Observability & testing')
    .replace('Communication (email, phone)', 'Communication')
    .replace('Identity, access & trust', 'Identity & access')
    .replace('Build / dev frameworks', 'Dev frameworks')
    .replace('Human escalation & labor', 'Human escalation');
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
  document.querySelectorAll('#filters .chip').forEach(chip => {
    if (!chip.dataset.k) return;
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
