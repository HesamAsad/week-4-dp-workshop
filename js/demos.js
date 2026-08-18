/* ===================================================================
   COMP90073 · Workshop Week 4 — interactive labs
   K-anonymity (Incognito) and differential privacy.
   Every lab is self-contained, deterministic (seeded), and mounts
   lazily when its slide becomes visible.
   =================================================================== */
(function (global) {
  'use strict';

  const D = {};
  const running = new Map();

  /* ---------- DOM helpers ---------- */

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === 'class') el.className = value;
      else if (key === 'html') el.innerHTML = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value !== null && value !== undefined) el.setAttribute(key, value);
    });
    (children || []).forEach(child => {
      if (child === null || child === undefined || child === false) return;
      el.append(child instanceof Node ? child : document.createTextNode(child));
    });
    return el;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs || {}).forEach(([key, value]) => el.setAttribute(key, value));
    return el;
  }

  function svgText(attrs, content) {
    const el = svgEl('text', attrs);
    el.textContent = content;
    return el;
  }

  function button(label, onClick, className) {
    return h('button', { class: `btn ${className || ''}`, type: 'button', onclick: onClick }, [label]);
  }

  /* Ordered so the compound token wins before its parts. */
  const MATH_TOKENS = /(e\^ε|Δf|ε|δ|√)/g;
  const escapeHtml = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const labelHtml = text => escapeHtml(text).replace(MATH_TOKENS, '<span class="nocaps">$1</span>');

  function metric(label, value, tone, hint) {
    return h('div', { class: `metric ${tone || ''}` }, [
      h('span', { class: 'metric-label', html: labelHtml(label) }, []),
      h('strong', { class: 'metric-value' }, [value]),
      hint ? h('span', { class: 'metric-hint' }, [hint]) : null
    ]);
  }

  const setMetric = (node, value, hint) => {
    node.querySelector('.metric-value').textContent = value;
    const hintEl = node.querySelector('.metric-hint');
    if (hintEl && hint !== undefined) hintEl.textContent = hint;
  };

  /** Segmented button group. Returns { node, value(), set(v) }. */
  function segmented(label, options, initial, onChange) {
    let current = initial;
    const buttons = options.map(option => button(option.label, () => {
      current = option.value;
      sync();
      onChange(current);
    }));
    const sync = () => buttons.forEach((btn, index) => {
      const active = options[index].value === current;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    sync();
    const node = h('div', { class: 'seg-control' }, [
      label ? h('span', { class: 'seg-label' }, [label]) : null,
      h('div', { class: 'btn-group' }, buttons)
    ]);
    return { node, value: () => current, set(value) { current = value; sync(); } };
  }

  /** Labelled range slider. Returns { node, value(), set(v) }. */
  function slider(config) {
    const format = config.format || (value => String(value));
    const readout = h('b', { class: 'range-value' }, [format(config.value)]);
    const input = h('input', {
      type: 'range',
      min: String(config.min), max: String(config.max), step: String(config.step),
      value: String(config.value),
      'aria-label': config.aria || config.label
    });
    input.addEventListener('input', () => {
      readout.textContent = format(Number(input.value));
      config.onInput(Number(input.value));
    });
    const node = h('label', { class: 'slider-control' }, [
      h('span', { class: 'slider-label' }, [config.label]), readout, input
    ]);
    return {
      node,
      value: () => Number(input.value),
      set(value) { input.value = String(value); readout.textContent = format(value); }
    };
  }

  function verdictBox(initial) {
    return h('div', { class: 'verdict', role: 'status' }, [initial || '']);
  }

  const setVerdict = (node, tone, message) => {
    node.className = `verdict ${tone}`;
    node.textContent = message;
  };

  /* ---------- maths helpers ---------- */

  function mulberry32(seed) {
    return function () {
      let t = seed += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

  /** Inverse-CDF sample from Laplace(0, b) using a uniform on (-1/2, 1/2). */
  const laplace = (rnd, b) => {
    const u = rnd() - 0.5;
    return -b * Math.sign(u) * Math.log(Math.max(1e-12, 1 - 2 * Math.abs(u)));
  };

  const fmtEps = e => (e >= 10 ? e.toFixed(0) : e >= 1 ? e.toFixed(2) : e.toFixed(3));
  const money = v => `$${Math.round(v).toLocaleString()}`;

  /* ===================================================================
     PART 1 · the released table
     Question 1's 12-row dataset, verbatim from the worksheet.
     =================================================================== */

  /* [postcode, age, income (K), loan taken] */
  const ROWS = [
    ['3000', 29, 100, 'Y'], ['3100', 39, 70, 'N'], ['3022', 22, 60, 'Y'],
    ['3001', 46, 80, 'Y'], ['3140', 41, 110, 'Y'], ['3101', 27, 40, 'N'],
    ['3200', 25, 55, 'Y'], ['3516', 33, 80, 'N'], ['3097', 40, 30, 'Y'],
    ['3482', 52, 50, 'N'], ['3561', 41, 55, 'Y'], ['3000', 25, 45, 'Y']
  ];

  /* The three domain generalisation hierarchies, exactly as the worksheet
     writes them. Index = level in the ladder; index 0 is the raw domain. */
  const LADDERS = {
    P: {
      name: 'postcode', letter: 'P',
      levels: [
        { label: 'P0', domain: '30* · 31* · 3[2,4,5]*', f: z => (z.startsWith('30') ? '30*' : z.startsWith('31') ? '31*' : '3[2,4,5]*') },
        { label: 'P1', domain: '3[0,1]* · 3[2,4,5]*', f: z => (z.startsWith('30') || z.startsWith('31') ? '3[0,1]*' : '3[2,4,5]*') },
        { label: 'P2', domain: '3*', f: () => '3*' }
      ]
    },
    A: {
      name: 'age', letter: 'A',
      levels: [
        { label: 'A0', domain: '21-30 · 31-40 · 41+', f: a => (a <= 30 ? '21-30' : a <= 40 ? '31-40' : '41+') },
        { label: 'A1', domain: '21-30 · 31+', f: a => (a <= 30 ? '21-30' : '31+') },
        { label: 'A2', domain: '*', f: () => '*' }
      ]
    },
    I: {
      name: 'income', letter: 'I',
      levels: [
        { label: 'I0', domain: '0-49K · 50K-99K · 100K+', f: v => (v <= 49 ? '0-49K' : v <= 99 ? '50K-99K' : '100K+') },
        { label: 'I1', domain: '*', f: () => '*' }
      ]
    }
  };
  const ATTRS = ['P', 'A', 'I'];
  const COL = { P: 0, A: 1, I: 2 };

  const cellOf = (row, attr, level) => LADDERS[attr].levels[level].f(row[COL[attr]]);

  /** Smallest equivalence-class size induced by `levels` over attribute set `attrs`. */
  function minClassSize(attrs, levels) {
    const counts = new Map();
    ROWS.forEach(row => {
      const key = attrs.map(a => cellOf(row, a, levels[a])).join('|');
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Math.min(...counts.values());
  }

  const nodeKey = (attrs, levels) => attrs.map(a => `${a}${levels[a]}`).join(',');
  const nodeLabel = (attrs, levels) => `⟨${attrs.map(a => LADDERS[a].levels[levels[a]].label).join(',')}⟩`;

  /**
   * Basic Incognito, exactly as lecture 4 states it.
   *   · phase i tests only i-attribute nodes whose every (i−1)-subset survived
   *     phase i−1 (the subset property, used contrapositively);
   *   · inside a phase the sweep is breadth-first from the bottom of the
   *     lattice, and a node that satisfies k rules in everything above it
   *     without a further scan (the rollup / monotonicity property).
   * Returns the full trace so the lab can replay it one step at a time.
   */
  function runIncognito(k) {
    const steps = [];
    const phases = [];
    let survivingSets = [{ attrs: [], levels: {} }];   // S₀ — the empty node

    for (let dim = 1; dim <= ATTRS.length; dim++) {
      /* --- candidate generation: every (dim−1)-subset must have survived --- */
      const survivorKeys = new Set(survivingSets.map(s => nodeKey(s.attrs, s.levels)));
      const attrSets = combinations(ATTRS, dim);
      const candidates = [];

      attrSets.forEach(attrs => {
        enumerateLevels(attrs).forEach(levels => {
          const subsetsOk = combinations(attrs, dim - 1).every(sub =>
            survivorKeys.has(nodeKey(sub, levels)));
          if (subsetsOk) candidates.push({ attrs, levels, key: nodeKey(attrs, levels) });
        });
      });

      /* --- bottom-up sweep with rollup --- */
      const status = new Map();          // key -> 'pass' | 'fail' | 'implied'
      const byHeight = candidates.slice().sort((a, b) =>
        a.attrs.reduce((s, x) => s + a.levels[x], 0) - b.attrs.reduce((s, x) => s + b.levels[x], 0));

      byHeight.forEach(node => {
        if (status.has(node.key)) return;                     // already ruled in by rollup
        const size = minClassSize(node.attrs, node.levels);
        const pass = size >= k;
        status.set(node.key, pass ? 'pass' : 'fail');
        steps.push({
          dim, kind: 'test', key: node.key, attrs: node.attrs, levels: node.levels,
          pass, size, label: nodeLabel(node.attrs, node.levels)
        });
        if (!pass) return;
        /* rollup: everything at or above this node in the lattice also satisfies k */
        candidates.forEach(other => {
          if (status.has(other.key)) return;
          if (other.attrs.join() !== node.attrs.join()) return;
          if (node.attrs.every(a => other.levels[a] >= node.levels[a])) {
            status.set(other.key, 'implied');
            steps.push({
              dim, kind: 'imply', key: other.key, attrs: other.attrs, levels: other.levels,
              pass: true, from: nodeLabel(node.attrs, node.levels),
              label: nodeLabel(other.attrs, other.levels)
            });
          }
        });
      });

      const survivors = candidates.filter(c => status.get(c.key) !== 'fail');
      phases.push({ dim, candidates, status, survivors });
      survivingSets = survivors;
    }

    /* Minimal full-domain generalisations: satisfying, with nothing below them. */
    const full = phases[phases.length - 1].survivors;
    const minimal = full.filter(n =>
      !full.some(m => m !== n && ATTRS.every(a => n.levels[a] >= m.levels[a])));

    return { steps, phases, minimal, k };
  }

  function combinations(list, size) {
    if (size === 0) return [[]];
    if (size > list.length) return [];
    const out = [];
    const walk = (start, acc) => {
      if (acc.length === size) { out.push(acc.slice()); return; }
      for (let i = start; i < list.length; i++) { acc.push(list[i]); walk(i + 1, acc); acc.pop(); }
    };
    walk(0, []);
    return out;
  }

  function enumerateLevels(attrs) {
    let out = [{}];
    attrs.forEach(a => {
      const next = [];
      LADDERS[a].levels.forEach((_, level) => out.forEach(base => next.push({ ...base, [a]: level })));
      out = next;
    });
    return out;
  }

  /* -------------------------------------------------------------------
     Lab 1 · running Incognito (Question 1)
     ------------------------------------------------------------------- */

  D.incognito = function (root) {
    let k = 3;
    let run = runIncognito(k);
    let cursor = 0;                       // how many steps have been revealed
    let timer = null;

    const scannedMetric = metric('Tables scanned', '0', 'attack-tone', 'each one is a full pass over the data');
    const freeMetric = metric('Ruled in free', '0', 'privacy-tone', 'by rollup, never scanned');
    const prunedMetric = metric('Never generated', '0', 'model-tone', 'of the 18 full-domain nodes');
    const resultMetric = metric('Minimal solutions', '—', '', 'lowest satisfying nodes');

    const lattices = h('div', { class: 'lattice-panel' }, []);
    const trace = h('div', { class: 'lattice-panel trace-panel' }, [
      h('div', { class: 'lattice-title' }, ['algorithm trace']),
      h('div', { class: 'step-trace' }, [])
    ]);
    const verdict = verdictBox('Press Step to test the first node. Incognito always starts at the bottom of the lattice — the least generalised table.');

    const stepBtn = button('Step', () => { advance(1); }, 'active');
    const runBtn = button('Run to the end', () => { toggleRun(); });
    const resetBtn = button('Reset', () => { stop(); cursor = 0; render(); });
    const kControl = segmented('target k', [2, 3, 4, 5].map(v => ({ value: v, label: String(v) })), k, v => {
      stop(); k = v; run = runIncognito(k); cursor = 0; render();
    });

    root.append(
      h('div', { class: 'lab-toolbar' }, [
        h('div', { class: 'toolbar-left' }, [kControl.node]),
        h('div', { class: 'btn-group' }, [stepBtn, runBtn, resetBtn])
      ]),
      h('div', { class: 'metric-row metric-row-four' }, [scannedMetric, freeMetric, prunedMetric, resultMetric]),
      h('div', { class: 'incognito-stage' }, [lattices, trace]),
      verdict
    );

    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
      runBtn.textContent = 'Run to the end';
      runBtn.classList.remove('active');
    }
    function toggleRun() {
      if (timer) { stop(); return; }
      runBtn.textContent = 'Pause';
      runBtn.classList.add('active');
      timer = setInterval(() => {
        if (cursor >= run.steps.length) { stop(); return; }
        advance(1);
      }, 420);
    }
    function advance(n) {
      cursor = Math.min(run.steps.length, cursor + n);
      render();
    }

    function render() {
      const seen = run.steps.slice(0, cursor);
      const state = new Map();
      seen.forEach(s => state.set(s.key, s.kind === 'test' ? (s.pass ? 'pass' : 'fail') : 'implied'));
      const current = seen.length ? seen[seen.length - 1] : null;

      const scanned = seen.filter(s => s.kind === 'test').length;
      const free = seen.filter(s => s.kind === 'imply').length;
      setMetric(scannedMetric, String(scanned));
      setMetric(freeMetric, String(free));

      /* 3-D nodes that candidate generation never even produced. */
      const fullPhase = run.phases[2];
      const totalFull = LADDERS.P.levels.length * LADDERS.A.levels.length * LADDERS.I.levels.length;
      const reached = cursor >= run.steps.length;
      setMetric(prunedMetric, reached ? String(totalFull - fullPhase.candidates.length) : '—',
        reached ? `only ${fullPhase.candidates.length} survived candidate generation` : 'of the 18 full-domain nodes');
      setMetric(resultMetric,
        reached ? run.minimal.map(n => nodeLabel(n.attrs, n.levels)).join('  ') : '—',
        reached ? `${run.minimal.length} incomparable answer${run.minimal.length === 1 ? '' : 's'}` : 'lowest satisfying nodes');

      /* --- lattices, one panel per phase reached so far --- */
      const maxDim = current ? current.dim : 1;
      const panels = [];
      for (let dim = 1; dim <= maxDim; dim++) {
        const phase = run.phases[dim - 1];
        const groups = new Map();
        phase.candidates.forEach(node => {
          const set = node.attrs.join('');
          if (!groups.has(set)) groups.set(set, []);
          groups.get(set).push(node);
        });
        const groupNodes = [...groups.entries()].map(([set, nodes]) => {
          const height = node => node.attrs.reduce((s, a) => s + node.levels[a], 0);
          const levels = new Map();
          nodes.forEach(node => {
            const lv = height(node);
            if (!levels.has(lv)) levels.set(lv, []);
            levels.get(lv).push(node);
          });
          const rows = [...levels.keys()].sort((a, b) => b - a).map(lv =>
            h('div', { class: 'lattice-level' }, levels.get(lv).map(node => {
              const st = state.get(node.key);
              const isMinimal = reached && run.minimal.some(m => m.key === node.key);
              const cls = ['node', st || 'untested',
                current && current.key === node.key && current.dim === dim ? 'current' : '',
                isMinimal ? 'minimal' : ''].filter(Boolean).join(' ');
              const scan = seen.find(s => s.key === node.key && s.kind === 'test');
              return h('span', { class: cls }, [
                nodeLabel(node.attrs, node.levels),
                scan ? h('span', { class: 'node-k' }, [`k=${scan.size}`]) : null
              ]);
            })));
          return h('div', { class: 'lattice-group' }, [
            ...rows,
            h('div', { class: 'lattice-title' }, [set.split('').map(a => LADDERS[a].name).join(' × ')])
          ]);
        });
        panels.push(h('div', { class: 'lattice-phase' }, [
          h('div', { class: 'lattice-title' }, [
            `phase ${dim} · `, h('b', {}, [`${dim}-attribute nodes`]),
            ` · ${phase.candidates.length} candidate${phase.candidates.length === 1 ? '' : 's'}`
          ]),
          h('div', { class: 'lattice-groups' }, groupNodes)
        ]));
      }
      lattices.replaceChildren(
        ...panels,
        h('div', { class: 'lattice-legend' }, [
          h('span', { class: 'legend-pass' }, ['scanned, satisfies k']),
          h('span', { class: 'legend-fail' }, ['scanned, fails k']),
          h('span', { class: 'legend-implied' }, ['free by rollup']),
          h('span', { class: 'legend-pruned' }, ['not yet reached'])
        ])
      );

      /* --- trace --- */
      const lines = seen.slice().reverse().map(s => h('div', { class: s.kind === 'test' ? (s.pass ? 't-pass' : 't-fail') : '' }, [
        s.kind === 'test'
          ? h('span', {}, [`scan ${s.label} → smallest class ${s.size} · `, h('b', {}, [s.pass ? `satisfies k=${run.k}` : `fails k=${run.k}`])])
          : h('span', { class: 'trace-dim' }, [`${s.label} ruled in by rollup from `, h('b', {}, [s.from]), ' — no scan needed'])
      ]));
      trace.replaceChildren(
        h('div', { class: 'lattice-title' }, ['algorithm trace · newest first']),
        h('div', { class: 'step-trace' }, lines.length ? lines : [h('div', { class: 'trace-dim' }, ['nothing scanned yet'])])
      );

      /* The panel scrolls, so follow the node the algorithm is working on
         rather than leaving the class staring at an off-screen phase. */
      const currentNode = lattices.querySelector('.node.current') || lattices.querySelector('.node.minimal');
      if (currentNode) {
        const panel = lattices.getBoundingClientRect();
        const node = currentNode.getBoundingClientRect();
        if (node.bottom > panel.bottom) lattices.scrollTop += node.bottom - panel.bottom + 10;
        else if (node.top < panel.top) lattices.scrollTop -= panel.top - node.top + 10;
      }

      stepBtn.disabled = cursor >= run.steps.length;

      /* --- narration --- */
      if (!current) {
        setVerdict(verdict, '', 'Press Step. Incognito begins with one attribute at a time, at the bottom of each ladder.');
      } else if (!reached) {
        if (current.kind === 'imply') {
          setVerdict(verdict, 'ok', `${current.label} is k-anonymous because ${current.from} already is, and generalising further can only merge classes together. Monotonicity buys this without touching the data.`);
        } else if (current.pass) {
          setVerdict(verdict, 'ok', `${current.label} holds: the smallest equivalence class has ${current.size} records. Everything above it in this lattice is now settled too.`);
        } else {
          setVerdict(verdict, 'bad', `${current.label} fails — one class holds only ${current.size} record${current.size === 1 ? '' : 's'}. By the subset property, every higher-dimensional node containing this one is dead as well, so it will never be generated.`);
        }
      } else {
        const names = run.minimal.map(n => nodeLabel(n.attrs, n.levels)).join(' and ');
        setVerdict(verdict, 'ok',
          `Done. ${scanned} scans, ${free} nodes ruled in for free, and ${totalFull - fullPhase.candidates.length} of the ${totalFull} full-domain nodes never generated at all. The minimal ${run.k}-anonymous generalisations are ${names} — income is suppressed in both, because it already failed on its own.`);
      }
    }

    render();
    return { stop };
  };

  /* -------------------------------------------------------------------
     Lab 2 · the table Incognito hands back, and what it costs
     ------------------------------------------------------------------- */

  D.releasedTable = function (root) {
    const palette = ['group-a', 'group-b', 'group-c', 'group-d', 'group-e', 'group-f'];
    let levels = { P: 0, A: 2, I: 1 };

    const kMetric = metric('Smallest class', '—', 'privacy-tone', 'the achieved k');
    const classMetric = metric('Equivalence classes', '—', 'model-tone', 'distinct QI patterns');
    const lossMetric = metric('Information loss', '—', 'attack-tone', 'mean of 1 − 1/|cell| over cells');
    const diversityMetric = metric('Least diverse class', '—', '', 'distinct loan values inside it');

    const tableWrap = h('div', { class: 'table-wrap' }, []);
    const badge = h('div', { class: 'k-badge' }, []);
    const verdict = verdictBox('');

    const controls = ATTRS.map(attr => segmented(LADDERS[attr].name,
      LADDERS[attr].levels.map((lv, i) => ({ value: i, label: lv.label })),
      levels[attr], value => { levels[attr] = value; render(); }));

    const presets = h('div', { class: 'btn-group' }, [
      button('⟨P0,A2,I1⟩', () => set({ P: 0, A: 2, I: 1 })),
      button('⟨P2,A0,I1⟩', () => set({ P: 2, A: 0, I: 1 })),
      button('⟨P0,A0,I0⟩ (raw)', () => set({ P: 0, A: 0, I: 0 }))
    ]);

    function set(next) {
      levels = { ...next };
      controls.forEach((c, i) => c.set(levels[ATTRS[i]]));
      render();
    }

    root.append(
      h('div', { class: 'generalisation-controls' }, [...controls.map(c => c.node), presets]),
      h('div', { class: 'metric-row metric-row-four' }, [kMetric, classMetric, lossMetric, diversityMetric]),
      badge,
      tableWrap,
      verdict
    );

    function render() {
      const shaped = ROWS.map((row, index) => {
        const cells = ATTRS.map(a => cellOf(row, a, levels[a]));
        return { index, cells, loan: row[3], key: cells.join('|') };
      });
      const groups = new Map();
      shaped.forEach(item => {
        if (!groups.has(item.key)) groups.set(item.key, []);
        groups.get(item.key).push(item);
      });
      const keys = [...groups.keys()];
      const minK = Math.min(...keys.map(key => groups.get(key).length));
      const diversity = Math.min(...keys.map(key => new Set(groups.get(key).map(i => i.loan)).size));
      const homogeneous = new Set(keys.filter(key => new Set(groups.get(key).map(i => i.loan)).size === 1));

      /* Lecture 4's penalty, averaged over records: 1 − 1/(number of values in
         this table's domain that generalise to the released cell). */
      const loss = shaped.reduce((total, item) => {
        const perAttr = ATTRS.map((a, i) => {
          const raw = new Set(ROWS.map(r => r[COL[a]]));
          const merged = [...raw].filter(v => LADDERS[a].levels[levels[a]].f(v) === item.cells[i]).length;
          return 1 - 1 / merged;
        });
        return total + perAttr.reduce((s, v) => s + v, 0) / ATTRS.length;
      }, 0) / shaped.length;

      setMetric(kMetric, String(minK));
      setMetric(classMetric, String(groups.size));
      setMetric(lossMetric, `${(loss * 100).toFixed(0)}%`);
      setMetric(diversityMetric, String(diversity),
        diversity === 1 ? 'a class gives its answer away' : 'every class mixes Y and N');
      kMetric.classList.toggle('is-leak', minK < 3);
      diversityMetric.classList.toggle('is-leak', diversity === 1);

      badge.className = `k-badge ${minK >= 3 ? 'pass' : 'fail'}`;
      badge.textContent = minK >= 3
        ? `${minK}-anonymous — satisfies the worksheet's k = 3`
        : `Not 3-anonymous — one class holds only ${minK} record${minK === 1 ? '' : 's'}`;

      const table = h('table', { class: 'data-table' }, [
        h('thead', {}, [h('tr', {}, ['#', 'Postal code', 'Age', 'Income (K)', 'Loan taken', 'Class size']
          .map(label => h('th', {}, [label])))]),
        h('tbody', {}, shaped.map(item => h('tr', {
          class: `${palette[keys.indexOf(item.key) % palette.length]} ${homogeneous.has(item.key) ? 'exposed' : ''}`
        }, [
          h('td', {}, [String(item.index + 1)]),
          ...item.cells.map(v => h('td', {}, [v])),
          h('td', {}, [item.loan]),
          h('td', {}, [String(groups.get(item.key).length)])
        ])))
      ]);
      tableWrap.replaceChildren(table);

      if (minK < 3) {
        setVerdict(verdict, 'bad', `Not released. Incognito would have rejected this node — ${minK === 1 ? 'a class of one is a re-identification' : 'a class this small is below the threshold'}.`);
      } else if (diversity === 1) {
        setVerdict(verdict, 'warn', `3-anonymity holds, and yet a whole class shares one loan outcome — identity is hidden, the answer is not. That gap is what week 3's homogeneity attack exploited, and it is exactly why differential privacy changes the question from "who is this row?" to "would the output change if this person left?".`);
      } else {
        setVerdict(verdict, 'ok', `3-anonymity holds with ${loss * 100 < 1 ? 'no' : `${(loss * 100).toFixed(0)}%`} average information loss. Note what had to go: one whole quasi-identifier is suppressed, and income was suppressed before the search even reached two dimensions.`);
      }
    }

    render();
    return {};
  };

  /* ===================================================================
     PART 2 · defining the guarantee
     =================================================================== */

  /* -------------------------------------------------------------------
     Lab 3 · randomised response (Question 2)
     ------------------------------------------------------------------- */

  D.randomisedResponse = function (root) {
    let p = 0.5;
    let n = 2000;
    let truth = 0.30;

    /* Warner's mechanism as the lecture states it: truth with probability p,
       otherwise a uniform coin. Both conditionals, and their ratio: */
    const prYesGivenY = () => p + (1 - p) * 0.5;
    const prYesGivenN = () => (1 - p) * 0.5;
    const ratio = () => prYesGivenY() / prYesGivenN();          // = (1+p)/(1−p)
    const eps = () => Math.log(ratio());

    const epsMetric = metric('Privacy cost ε', '—', 'privacy-tone', 'ln of the ratio below');
    const ratioMetric = metric('Likelihood ratio', '—', 'attack-tone', 'Pr[Yes|Y] ÷ Pr[Yes|N]');
    const estMetric = metric('Estimated “Yes” rate', '—', 'model-tone', 'from the noisy answers only');
    const errMetric = metric('95% interval', '—', '', 'width grows as p falls');

    const bars = h('div', { class: 'ratio-bars' }, []);
    const verdict = verdictBox('');

    const pSlider = slider({
      label: 'p (answer truthfully)', min: 0.02, max: 0.98, step: 0.01, value: p,
      format: v => v.toFixed(2), onInput: v => { p = v; render(); }
    });
    const nSlider = slider({
      label: 'respondents n', min: 200, max: 20000, step: 200, value: n,
      format: v => v.toLocaleString(), onInput: v => { n = v; render(); }
    });
    const truthSlider = slider({
      label: 'true “Yes” rate', min: 0.05, max: 0.95, step: 0.01, value: truth,
      format: v => `${(v * 100).toFixed(0)}%`, onInput: v => { truth = v; render(); }
    });

    const solveBtn = button('Solve for ε = ln 7', () => {
      /* (1+p)/(1−p) = 7  ⟹  p = 3/4 */
      p = 0.75; pSlider.set(p); render();
    }, 'active');
    const lectureBtn = button('The lecture’s p = 0.5', () => { p = 0.5; pSlider.set(p); render(); });

    root.append(
      h('div', { class: 'lab-toolbar' }, [
        h('div', { class: 'toolbar-left' }, [pSlider.node, truthSlider.node, nSlider.node]),
        h('div', { class: 'btn-group' }, [solveBtn, lectureBtn])
      ]),
      h('div', { class: 'metric-row metric-row-four' }, [epsMetric, ratioMetric, estMetric, errMetric]),
      bars,
      verdict
    );

    function render() {
      const yesY = prYesGivenY(), yesN = prYesGivenN();
      setMetric(epsMetric, `ln ${ratio().toFixed(3)} = ${eps().toFixed(3)}`);
      setMetric(ratioMetric, ratio().toFixed(3), `= (1+p)/(1−p) with p = ${p.toFixed(2)}`);

      /* Utility: the unbiased estimator from lecture 6, x̂ = (Z/n − ½(1−p))/p,
         and its exact standard error. */
      const q = truth * p + 0.5 * (1 - p);          // Pr[a given respondent says Yes]
      const se = Math.sqrt(q * (1 - q) / n) / p;
      setMetric(estMetric, `${(truth * 100).toFixed(0)}% ± ${(1.96 * se * 100).toFixed(1)}%`,
        'unbiased: E[x̂] = x');
      setMetric(errMetric, `±${(1.96 * se * 100).toFixed(1)} points`, `n = ${n.toLocaleString()}, p = ${p.toFixed(2)}`);

      bars.replaceChildren(...[
        ['Pr[Yes | truth = Y]', yesY, 'truth'],
        ['Pr[Yes | truth = N]', yesN, 'lie']
      ].map(([label, value, tone]) => h('div', { class: 'ratio-row' }, [
        h('span', { class: 'ratio-label' }, [label]),
        h('div', { class: 'ratio-track' }, [h('div', { class: `ratio-fill ${tone}`, style: `width:${value * 100}%` }, [])]),
        h('span', { class: 'ratio-value' }, [value.toFixed(3)])
      ])));

      const atTarget = Math.abs(eps() - Math.log(7)) < 5e-3;
      if (atTarget) {
        setVerdict(verdict, 'ok',
          `p = 3/4. The ratio is exactly 7, so ε = ln 7 ≈ ${Math.log(7).toFixed(3)} — the worksheet's answer. Setting (1+p)/(1−p) = 7 gives 1+p = 7−7p, so p = 3/4. Note the direction: a larger p means more truth, a larger ratio, and a weaker guarantee.`);
      } else if (Math.abs(p - 0.5) < 1e-9) {
        setVerdict(verdict, 'ok',
          `p = 0.5 is the coin-flip version from lecture 6: the ratio is (0.5+0.25)/0.25 = 3, so the mechanism is ln 3-differentially private. Now push p up to reach ln 7.`);
      } else {
        setVerdict(verdict, eps() < Math.log(7) ? 'ok' : 'warn',
          `At p = ${p.toFixed(2)} each respondent is ${ratio().toFixed(2)}× more likely to say Yes when the truth is Yes, so ε = ${eps().toFixed(3)}. The estimate stays unbiased at every p — only its interval changes, from ±${(1.96 * se * 100).toFixed(1)} points here.`);
      }
    }

    render();
    return {};
  };

  /* -------------------------------------------------------------------
     Lab 4 · a mechanism that is not ε-DP for any ε (Question 6)
     ------------------------------------------------------------------- */

  D.notDP = function (root) {
    const NAMES = ['Ana', 'Bo', 'Cai', 'Dev', 'Eve'];
    let removed = 3;                       // index of the record D′ drops
    let mechanism = 'sample';

    const ratioMetric = metric('Worst-case ratio', '—', 'attack-tone', 'over all outputs O');
    const epsMetric = metric('Smallest ε that works', '—', 'privacy-tone', 'from the definition');
    const witnessMetric = metric('The witness output', '—', 'model-tone', 'the O that breaks it');

    const compare = h('div', { class: 'dist-compare' }, []);
    const verdict = verdictBox('');

    const removeControl = segmented('D′ drops', NAMES.map((name, i) => ({ value: i, label: name })), removed,
      v => { removed = v; render(); });
    const mechControl = segmented('mechanism', [
      { value: 'sample', label: 'return a random record' },
      { value: 'laplace', label: 'Laplace count instead' }
    ], mechanism, v => { mechanism = v; render(); });

    root.append(
      h('div', { class: 'lab-toolbar' }, [h('div', { class: 'toolbar-left' }, [mechControl.node, removeControl.node])]),
      h('div', { class: 'metric-row' }, [ratioMetric, epsMetric, witnessMetric]),
      compare,
      verdict
    );

    function render() {
      if (mechanism === 'sample') {
        const inD1 = NAMES.map(() => 1 / NAMES.length);
        const inD2 = NAMES.map((_, i) => (i === removed ? 0 : 1 / (NAMES.length - 1)));

        setMetric(ratioMetric, '∞', `Pr = ${(1 / NAMES.length).toFixed(2)} against 0`);
        setMetric(epsMetric, 'none exists', 'no finite ε satisfies the definition');
        setMetric(witnessMetric, `O = {${NAMES[removed]}}`, 'possible under D, impossible under D′');
        ratioMetric.classList.add('is-leak');

        compare.replaceChildren(
          distCard('D — all five records', NAMES, inD1, removed),
          distCard(`D′ — ${NAMES[removed]} removed`, NAMES, inD2, removed)
        );
        setVerdict(verdict, 'bad',
          `Take O = {${NAMES[removed]}}. Then Pr[M(D) ∈ O] = 1/|D| = ${(1 / NAMES.length).toFixed(2)} while Pr[M(D′) ∈ O] = 0, so the requirement Pr[M(D) ∈ O] ≤ e^ε · Pr[M(D′) ∈ O] reads ${(1 / NAMES.length).toFixed(2)} ≤ 0. No ε, however large, can rescue it — e^ε multiplied by zero is still zero. Releasing a real record cannot be private, no matter which record.`);
      } else {
        /* Same neighbouring pair, answered with Laplace instead. */
        const eps = 1.0, sens = 1, b = sens / eps;
        const grid = [];
        for (let x = -6; x <= 8; x += 0.5) grid.push(x);
        const f1 = 5, f2 = 4;                                   // counts under D and D′
        const pdf = (x, mu) => Math.exp(-Math.abs(x - mu) / b) / (2 * b);
        const worst = Math.max(...grid.map(x => pdf(x, f1) / pdf(x, f2)));

        setMetric(ratioMetric, worst.toFixed(3), `bounded by e^ε = ${Math.exp(eps).toFixed(3)}`);
        setMetric(epsMetric, `ε = ${eps.toFixed(1)}`, 'holds for every output simultaneously');
        setMetric(witnessMetric, 'none', 'every output is possible under both');
        ratioMetric.classList.remove('is-leak');

        const labels = grid.filter((_, i) => i % 2 === 0).map(x => x.toFixed(0));
        compare.replaceChildren(
          distCard('count(D) = 5 + Lap(1/ε) · relative likelihood', labels,
            labels.map(x => pdf(Number(x), f1) * 2), -1),
          distCard('count(D′) = 4 + Lap(1/ε) · relative likelihood', labels,
            labels.map(x => pdf(Number(x), f2) * 2), -1)
        );
        setVerdict(verdict, 'ok',
          `The difference is support, not shape. Laplace noise gives every output a strictly positive density under both datasets, so the ratio is finite everywhere and is capped at e^ε = ${Math.exp(eps).toFixed(2)}. Sampling a record leaves outputs that one dataset can produce and the other simply cannot — and one such output is enough to break the definition.`);
      }
    }

    function distCard(title, labels, values, witness) {
      const max = Math.max(...values, 1e-9);
      return h('div', { class: 'dist-card' }, [
        h('h5', {}, [title]),
        ...labels.map((label, i) => h('div', {
          class: `record-bar ${i === witness ? 'is-witness' : ''}`
        }, [
          h('span', { class: 'record-name' }, [label]),
          h('div', { class: 'record-track' }, [
            h('div', { class: `record-fill ${values[i] === 0 ? 'absent' : ''}`, style: `width:${values[i] / max * 100}%` }, [])
          ]),
          h('span', { class: 'record-prob' }, [values[i] === 0 ? '0' : values[i].toFixed(2)])
        ]))
      ]);
    }

    render();
    return {};
  };

  /* -------------------------------------------------------------------
     Lab 5 · what an ε actually buys (Question 5)
     ------------------------------------------------------------------- */

  D.epsilonMeaning = function (root) {
    let eps = 1;
    let prior = 0.5;

    const expMetric = metric('e^ε', '—', 'attack-tone', 'the allowed odds swing');
    const rangeMetric = metric('Posterior belief', '—', 'privacy-tone', 'after seeing the output');
    const swingMetric = metric('Belief can move by', '—', 'model-tone', 'percentage points');

    const track = h('div', { class: 'belief-track' }, []);
    const caption = h('div', { class: 'belief-caption' }, []);
    const verdict = verdictBox('');

    /* Slider is on ln ε so the interesting decade (0.01 – 1) is not squashed. */
    const epsSlider = slider({
      label: 'ε', min: Math.log(0.01), max: Math.log(50), step: 0.01, value: Math.log(eps),
      format: v => fmtEps(Math.exp(v)), onInput: v => { eps = Math.exp(v); render(); }
    });
    const priorSlider = slider({
      label: 'prior belief', min: 0.05, max: 0.95, step: 0.01, value: prior,
      format: v => `${(v * 100).toFixed(0)}%`, onInput: v => { prior = v; render(); }
    });

    const presets = h('div', { class: 'btn-group' }, [
      ['ε = 0.1', 0.1], ['ε = 1', 1], ['Census: 17.14', 17.14], ['ε = 50', 50]
    ].map(([label, value]) => button(label, () => {
      eps = value; epsSlider.set(Math.log(value)); render();
    })));

    root.append(
      h('div', { class: 'lab-toolbar' }, [
        h('div', { class: 'toolbar-left' }, [epsSlider.node, priorSlider.node]),
        presets
      ]),
      h('div', { class: 'metric-row' }, [expMetric, rangeMetric, swingMetric]),
      h('div', { class: 'belief-scale' }, [
        track,
        h('div', { class: 'belief-ticks' }, ['0%', '25%', '50%', '75%', '100%'].map(t => h('span', {}, [t]))),
        caption
      ]),
      verdict
    );

    /* ε-DP bounds the posterior odds: they move by at most a factor e^ε
       in either direction, whatever the adversary already knew. */
    const posterior = dir => {
      const odds = (prior / (1 - prior)) * Math.exp(dir * eps);
      return odds / (1 + odds);
    };

    function render() {
      const lo = posterior(-1), hi = posterior(+1);
      const eEps = Math.exp(eps);
      setMetric(expMetric, eEps >= 1e6 ? eEps.toExponential(2) : eEps.toFixed(eEps < 100 ? 2 : 0));
      setMetric(rangeMetric, `${(lo * 100).toFixed(1)}% – ${(hi * 100).toFixed(1)}%`,
        `started at ${(prior * 100).toFixed(0)}%`);
      setMetric(swingMetric, `${((hi - lo) * 100).toFixed(1)} pts`,
        (hi - lo) > 0.9 ? 'effectively no constraint' : 'the guarantee is binding');
      swingMetric.classList.toggle('is-leak', (hi - lo) > 0.9);

      track.replaceChildren(
        h('div', { class: 'belief-band', style: `left:${lo * 100}%; width:${Math.max(0.4, (hi - lo) * 100)}%` }, []),
        h('div', { class: 'belief-prior', style: `left:${prior * 100}%` }, [])
      );
      caption.replaceChildren(
        h('span', {}, ['An adversary who believed ']),
        h('b', {}, [`${(prior * 100).toFixed(0)}%`]),
        h('span', {}, [' that you are in the dataset may end up believing anywhere in ']),
        h('b', {}, [`${(lo * 100).toFixed(1)}% – ${(hi * 100).toFixed(1)}%`]),
        h('span', {}, ['.'])
      );

      if (eps <= 0.15) {
        setVerdict(verdict, 'ok', `ε = ${fmtEps(eps)} is the "very strong" rule of thumb from lecture 6: e^ε ≈ ${eEps.toFixed(2)}, so no output can move anyone's belief by more than ${((hi - lo) * 100).toFixed(1)} points. Strong, and expensive — the noise scales as Δf/ε.`);
      } else if (eps <= 1.2) {
        setVerdict(verdict, 'ok', `ε ≈ 1 is the standard "good guarantee". Belief about you can move from ${(prior * 100).toFixed(0)}% to at most ${(hi * 100).toFixed(1)}% or as low as ${(lo * 100).toFixed(1)}% — a real shift, but a bounded one.`);
      } else if (eps < 20) {
        setVerdict(verdict, 'warn', `e^ε = ${eEps.toFixed(0)} already lets belief run from ${(lo * 100).toFixed(1)}% to ${(hi * 100).toFixed(1)}%. The US Census Bureau's ε = 17.14 for person statistics is here — a reminder that deployed ε values are chosen against utility, not against this picture.`);
      } else {
        setVerdict(verdict, 'bad', `This is the worksheet's point. At ε = ${fmtEps(eps)}, e^ε ≈ ${eEps.toExponential(2)}: one dataset may produce a given output ${eEps.toExponential(1)} times more readily than its neighbour, and the posterior band covers essentially the whole axis. The inequality is still formally satisfied — it just no longer rules anything out. A guarantee that forbids nothing is not a guarantee.`);
      }
    }

    render();
    return {};
  };

  /* ===================================================================
     PART 3 · calibrating the noise
     =================================================================== */

  /* -------------------------------------------------------------------
     Lab 6 · sensitivity of sum and average (Questions 3 and 4)
     ------------------------------------------------------------------- */

  D.sensitivity = function (root) {
    let n = 25, lo = 0, hi = 100, eps = 1, query = 'sum', wideFirst = false;
    const rnd = mulberry32(20250818);
    /* Fixed uniform draws, so switching query or range re-uses the same people
       and the comparison on screen is like for like. */
    let units = Array.from({ length: 200 }, () => rnd());
    let data = null;

    const sensMetric = metric('Sensitivity Δf', '—', 'attack-tone', 'worst case over neighbours');
    const scaleMetric = metric('Laplace scale b', '—', 'privacy-tone', 'b = Δf / ε');
    const answerMetric = metric('One DP answer', '—', 'model-tone', 'true value + Lap(b)');
    const errorMetric = metric('Typical error', '—', '', 'std dev = √2 · b');

    const chart = svgEl('svg', { viewBox: '0 0 900 168', role: 'img', 'aria-label': 'Distribution of the differentially private answer around the true value' });
    const formula = h('div', { class: 'eq math small' }, []);
    const assumption = h('div', { class: 'assumption' }, []);
    const verdict = verdictBox('');

    const queryControl = segmented('query', [
      { value: 'sum', label: 'sum' }, { value: 'avg', label: 'average' }
    ], query, v => { query = v; rebuild(); });
    const wideControl = segmented('v₁ range', [
      { value: false, label: 'v₁ ∈ [l, h]  (Q3)' }, { value: true, label: 'v₁ ∈ [l, 2h]  (Q4)' }
    ], wideFirst, v => { wideFirst = v; rebuild(); });

    const nSlider = slider({ label: 'n', min: 5, max: 200, step: 1, value: n, onInput: v => { n = v; rebuild(); } });
    const hiSlider = slider({ label: 'h', min: 10, max: 500, step: 10, value: hi, onInput: v => { hi = v; rebuild(); } });
    const epsSlider = slider({
      label: 'ε', min: Math.log(0.05), max: Math.log(10), step: 0.01, value: Math.log(eps),
      format: v => fmtEps(Math.exp(v)), onInput: v => { eps = Math.exp(v); render(); }
    });

    root.append(
      h('div', { class: 'lab-toolbar' }, [
        h('div', { class: 'toolbar-left' }, [queryControl.node, wideControl.node, nSlider.node, hiSlider.node, epsSlider.node]),
        h('div', { class: 'btn-group' }, [button('New sample', () => { resample(); }, 'active')])
      ]),
      h('div', { class: 'metric-row metric-row-four' }, [sensMetric, scaleMetric, answerMetric, errorMetric]),
      formula,
      chart,
      assumption,
      verdict
    );

    function rebuild() {
      data = Array.from({ length: n }, (_, i) => {
        const top = (i === 0 && wideFirst) ? 2 * hi : hi;
        return lo + units[i] * (top - lo);
      });
      render();
    }
    function resample() {
      units = Array.from({ length: 200 }, () => rnd());
      rebuild();
    }

    function trueValue() {
      const total = data.reduce((s, v) => s + v, 0);
      return query === 'sum' ? total : total / data.length;
    }

    /* Adding or removing one record changes a sum by at most the largest value
       that record may take, and an average by at most that over n. */
    function sensitivity() {
      const worstRecord = wideFirst ? 2 * hi : hi;
      return query === 'sum' ? worstRecord : worstRecord / n;
    }

    function render() {
      if (!data || data.length !== n) { rebuild(); return; }
      const df = sensitivity(), b = df / eps, truth = trueValue();
      const draw = truth + laplace(mulberry32(Math.round(eps * 1e6) + n), b);

      setMetric(sensMetric, df >= 1 ? df.toFixed(df >= 10 ? 0 : 2) : df.toFixed(3),
        query === 'sum' ? (wideFirst ? '= 2h' : '= h') : (wideFirst ? '= 2h/n' : '= h/n'));
      setMetric(scaleMetric, b >= 1 ? b.toFixed(1) : b.toFixed(3));
      setMetric(answerMetric, draw.toFixed(1), `true value ${truth.toFixed(1)}`);
      setMetric(errorMetric, `± ${(Math.SQRT2 * b).toFixed(1)}`,
        `${(Math.SQRT2 * b / Math.abs(truth) * 100).toFixed(1)}% of the answer`);

      formula.innerHTML = query === 'sum'
        ? `\\[ M(v_1,\\dots,v_n)=\\sum_i v_i + Y,\\qquad Y\\sim \\mathrm{Lap}\\!\\left(\\frac{${wideFirst ? '2h' : 'h'}}{\\varepsilon}\\right) \\]`
        : `\\[ M(v_1,\\dots,v_n)=\\frac{1}{n}\\sum_i v_i + Y,\\qquad Y\\sim \\mathrm{Lap}\\!\\left(\\frac{${wideFirst ? '2h' : 'h'}/n}{\\varepsilon}\\right) \\]`;
      if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([formula]).catch(() => {});

      assumption.innerHTML = wideFirst
        ? `<b>Why 2h and not h:</b> sensitivity is a worst case over <em>every</em> neighbouring pair. The pair that moves the answer most is the one that adds or removes v₁, and v₁ may be as large as 2h — so the whole sum pays for the single widest record, even though the other n−1 values still live in [l, h].`
        : `<b>What this assumes:</b> that 0 ≤ l &lt; h, so the largest change one record can make is h. If l were negative the sensitivity would be max(|l|, h) instead. The worksheet takes the non-negative case; it is worth saying so out loud.`;

      /* Density of the released answer under both neighbouring worlds. */
      const W = 900, H = 168, pad = 34;
      const span = Math.max(4 * b, df * 2.5);
      const x0 = truth - span, x1 = truth + span;
      const sx = v => pad + (v - x0) / (x1 - x0) * (W - 2 * pad);
      const pdf = (v, mu) => Math.exp(-Math.abs(v - mu) / b) / (2 * b);
      const peak = pdf(truth, truth);
      const sy = d => H - 26 - (d / peak) * (H - 60);

      const path = mu => {
        let d = '';
        for (let i = 0; i <= 220; i++) {
          const v = x0 + (x1 - x0) * i / 220;
          d += `${i ? 'L' : 'M'}${sx(v).toFixed(1)},${sy(pdf(v, mu)).toFixed(1)}`;
        }
        return d;
      };

      chart.replaceChildren(
        svgEl('line', { class: 'grid-line', x1: pad, y1: H - 26, x2: W - pad, y2: H - 26 }),
        svgEl('path', { d: path(truth), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2 }),
        svgEl('path', { d: path(truth + df), fill: 'none', stroke: 'var(--accent-2)', 'stroke-width': 2.2, 'stroke-dasharray': '5 4' }),
        svgEl('line', { x1: sx(truth), y1: 22, x2: sx(truth), y2: H - 26, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .7 }),
        svgEl('circle', { cx: sx(draw), cy: sy(pdf(draw, truth)), r: 5, fill: 'var(--accent-3)' }),
        svgText({ class: 'axis-label', x: sx(truth), y: 16, 'text-anchor': 'middle', fill: 'var(--accent)' }, `f(D) = ${truth.toFixed(1)}`),
        svgText({ class: 'axis-label', x: clamp(sx(truth + df), pad, W - pad - 90), y: 16, fill: 'var(--accent-2)' }, `f(D′) = ${(truth + df).toFixed(1)}`),
        svgText({ class: 'axis-label', x: clamp(sx(draw), pad, W - pad - 80), y: sy(pdf(draw, truth)) - 12, fill: 'var(--accent-3)' }, `released ${draw.toFixed(1)}`),
        svgText({ class: 'axis-label', x: pad, y: H - 8 }, x0.toFixed(0)),
        svgText({ class: 'axis-label', x: W - pad, y: H - 8, 'text-anchor': 'end' }, x1.toFixed(0))
      );

      const rel = Math.SQRT2 * b / Math.abs(truth);
      setVerdict(verdict,
        rel < 0.02 ? 'ok' : rel < 0.15 ? 'warn' : 'bad',
        query === 'sum'
          ? `A sum over n = ${n} values pays Δf = ${df.toFixed(0)} regardless of n: the answer is ${truth.toFixed(0)} ± ${(Math.SQRT2 * b).toFixed(0)}. Adding people does not shrink that ± at all — it only grows the sum it sits beside, so the error falls in relative terms while staying identical in absolute ones.`
          : `An average divides the sensitivity by n, so Δf = ${df.toFixed(2)} and the ± is ${(Math.SQRT2 * b).toFixed(2)} against an answer of ${truth.toFixed(1)}. Compare the percentage with the sum's: it is identical, because an average is just the sum over n and the noise is divided by n too. What actually changes is the absolute error — it shrinks like 1/n against an answer that stays on the same scale, so a DP mean converges to the truth while a DP sum's error never moves.`);
    }

    rebuild();
    return {};
  };

  /* -------------------------------------------------------------------
     Lab 7 · unbounded values, and the clipping bound (Question 7)
     ------------------------------------------------------------------- */

  D.clipping = function (root) {
    let clip = 300000, eps = 1;
    const n = 500;

    /* A heavy-tailed income sample: bounded below by 0, unbounded above. */
    const rnd = mulberry32(90073);
    const incomes = Array.from({ length: n }, () => {
      const u1 = Math.max(rnd(), 1e-9), u2 = rnd();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      return Math.exp(10.9 + 0.85 * z);
    });
    const trueMean = incomes.reduce((s, v) => s + v, 0) / n;
    const maxIncome = Math.max(...incomes);

    const biasMetric = metric('Clipping bias', '—', 'model-tone', 'from the values you cut');
    const noiseMetric = metric('Noise (std dev)', '—', 'privacy-tone', '√2 · C / (n ε)');
    const totalMetric = metric('Expected error', '—', 'attack-tone', 'bias and noise together');
    const bestMetric = metric('Best bound here', '—', '', 'minimises the total');

    const chart = svgEl('svg', { viewBox: '0 0 900 260', role: 'img', 'aria-label': 'Error against the clipping bound' });
    const verdict = verdictBox('');

    const clipSlider = slider({
      label: 'clip bound C', min: Math.log(20000), max: Math.log(8000000), step: 0.01, value: Math.log(clip),
      format: v => money(Math.exp(v)), onInput: v => { clip = Math.exp(v); render(); }
    });
    const epsSlider = slider({
      label: 'ε', min: Math.log(0.1), max: Math.log(5), step: 0.01, value: Math.log(eps),
      format: v => fmtEps(Math.exp(v)), onInput: v => { eps = Math.exp(v); render(); }
    });
    const bestBtn = button('Jump to the best C', () => {
      clip = bestClip(); clipSlider.set(Math.log(clip)); render();
    }, 'active');
    const noClipBtn = button('Refuse to clip', () => {
      clip = 8000000; clipSlider.set(Math.log(clip)); render();
    });

    root.append(
      h('div', { class: 'lab-toolbar' }, [
        h('div', { class: 'toolbar-left' }, [clipSlider.node, epsSlider.node]),
        h('div', { class: 'btn-group' }, [bestBtn, noClipBtn])
      ]),
      h('div', { class: 'metric-row metric-row-four' }, [biasMetric, noiseMetric, totalMetric, bestMetric]),
      chart,
      verdict
    );

    /* Clipping makes the sensitivity of the mean C/n, at the price of a
       downward bias on every value above C. */
    const bias = C => trueMean - incomes.reduce((s, v) => s + Math.min(v, C), 0) / n;
    const noise = C => Math.SQRT2 * (C / n) / eps;
    const total = C => Math.hypot(bias(C), noise(C));

    function bestClip() {
      let best = null, bestVal = Infinity;
      for (let i = 0; i <= 400; i++) {
        const C = Math.exp(Math.log(20000) + (Math.log(8000000) - Math.log(20000)) * i / 400);
        const v = total(C);
        if (v < bestVal) { bestVal = v; best = C; }
      }
      return best;
    }

    function render() {
      const b = bias(clip), nz = noise(clip), tot = total(clip);
      const clipped = incomes.filter(v => v > clip).length;
      setMetric(biasMetric, money(b), `${clipped} of ${n} incomes cut`);
      setMetric(noiseMetric, money(nz), `C/n = ${money(clip / n)} sensitivity`);
      setMetric(totalMetric, money(tot), `${(tot / trueMean * 100).toFixed(1)}% of the true mean`);
      const best = bestClip();
      setMetric(bestMetric, money(best), `error ${money(total(best))}`);

      const W = 900, H = 260, pad = 52;
      const lx0 = Math.log(20000), lx1 = Math.log(8000000);
      const sx = C => pad + (Math.log(C) - lx0) / (lx1 - lx0) * (W - 2 * pad);
      const maxY = Math.max(...[20000, 100000, 8000000].map(total), total(20000)) * 1.05;
      const sy = v => H - 30 - clamp(v / maxY, 0, 1) * (H - 62);

      const curve = (fn, stroke, dash) => {
        let d = '';
        for (let i = 0; i <= 240; i++) {
          const C = Math.exp(lx0 + (lx1 - lx0) * i / 240);
          d += `${i ? 'L' : 'M'}${sx(C).toFixed(1)},${sy(fn(C)).toFixed(1)}`;
        }
        return svgEl('path', { d, fill: 'none', stroke, 'stroke-width': dash ? 1.8 : 2.6, 'stroke-dasharray': dash || 'none' });
      };

      chart.replaceChildren(
        svgEl('line', { class: 'grid-line', x1: pad, y1: H - 30, x2: W - pad, y2: H - 30 }),
        curve(bias, 'var(--accent-4)', '5 4'),
        curve(noise, 'var(--accent)', '5 4'),
        curve(total, 'var(--accent-2)'),
        svgEl('line', { x1: sx(best), y1: 20, x2: sx(best), y2: H - 30, stroke: 'var(--accent-3)', 'stroke-width': 1.4, 'stroke-dasharray': '3 3' }),
        svgEl('line', { x1: sx(clip), y1: 20, x2: sx(clip), y2: H - 30, stroke: 'var(--ink)', 'stroke-width': 1.2, opacity: .55 }),
        svgEl('circle', { cx: sx(clip), cy: sy(tot), r: 5, fill: 'var(--accent-2)' }),
        svgText({ class: 'axis-label', x: sx(best), y: 15, 'text-anchor': 'middle', fill: 'var(--accent-3)' }, 'best C'),
        svgText({ class: 'axis-label', x: pad, y: 20, fill: 'var(--accent-4)' }, 'bias from clipping'),
        svgText({ class: 'axis-label', x: W - pad, y: 20, 'text-anchor': 'end', fill: 'var(--accent)' }, 'noise ∝ C'),
        svgText({ class: 'axis-label', x: W / 2, y: H - 8, 'text-anchor': 'middle' }, 'clipping bound C  (log scale)'),
        svgText({ class: 'axis-label', x: pad, y: H - 8 }, '$20K'),
        svgText({ class: 'axis-label', x: W - pad, y: H - 8, 'text-anchor': 'end' }, '$8M')
      );

      if (clip > maxIncome * 0.9) {
        setVerdict(verdict, 'bad',
          `With no meaningful bound the sensitivity is whatever the richest person earns — here ${money(maxIncome)} — and the noise (${money(nz)}) dwarfs the answer (${money(trueMean)}). This is the worksheet's point: income starts at 0 and is unbounded, so the Laplace mechanism has no sensitivity to calibrate to and cannot be applied as-is.`);
      } else if (Math.abs(Math.log(clip / best)) < 0.25) {
        setVerdict(verdict, 'ok',
          `Near the sweet spot. Clip at ${money(clip)}, take the mean of the clipped values, and add Lap(C/(nε)). Total error ${money(tot)} against a true mean of ${money(trueMean)}. Crucially C is chosen in advance and published — it is a property of the mechanism, not of the data, so revealing it costs nothing.`);
      } else if (clip < best) {
        setVerdict(verdict, 'warn',
          `Clipping this hard is cheap in noise (${money(nz)}) but you have cut ${clipped} incomes down to ${money(clip)}, biasing the mean by ${money(b)}. Bias does not shrink with more respondents — noise does. Choosing C too low is the harder mistake to detect.`);
      } else {
        setVerdict(verdict, 'warn',
          `Almost nothing is being clipped, so the estimate is nearly unbiased — but sensitivity is C/n, and the noise has grown to ${money(nz)}. The bound is doing no statistical work and all of the privacy damage.`);
      }
    }

    render();
    return {};
  };

  /* ===================================================================
     PART 4 · composing and training
     =================================================================== */

  /* -------------------------------------------------------------------
     Lab 8 · the privacy budget (Question 9 and lecture 6)
     ------------------------------------------------------------------- */

  D.budget = function (root) {
    let totalEps = 1, queries = 4, strategy = 'split';

    const perMetric = metric('ε per query', '—', 'privacy-tone', 'total ÷ number of queries');
    const spentMetric = metric('Total ε spent', '—', 'attack-tone', 'sequential composition');
    const errMetric = metric('Error per answer', '—', 'model-tone', 'std dev, Δf = 1');
    const avgMetric = metric('Error after averaging', '—', '', 'if you repeat one query');

    const bar = h('div', { class: 'budget-bar' }, []);
    const chart = svgEl('svg', { viewBox: '0 0 900 230', role: 'img', 'aria-label': 'Error against the number of queries under a fixed budget' });
    const verdict = verdictBox('');

    const epsSlider = slider({
      label: 'total budget ε', min: 0.1, max: 5, step: 0.1, value: totalEps,
      format: v => v.toFixed(1), onInput: v => { totalEps = v; render(); }
    });
    const qSlider = slider({
      label: 'queries k', min: 1, max: 40, step: 1, value: queries,
      onInput: v => { queries = v; render(); }
    });
    const stratControl = segmented('you ask', [
      { value: 'split', label: 'k different queries' },
      { value: 'repeat', label: 'the same query k times' }
    ], strategy, v => { strategy = v; render(); });

    root.append(
      h('div', { class: 'lab-toolbar' }, [
        h('div', { class: 'toolbar-left' }, [epsSlider.node, qSlider.node] ),
        stratControl.node
      ]),
      h('div', { class: 'metric-row metric-row-four' }, [perMetric, spentMetric, errMetric, avgMetric]),
      bar,
      chart,
      verdict
    );

    /* Δf = 1 (a count). Each of k queries gets ε/k, so b = k/ε and the
       per-answer noise grows linearly in k. Averaging k independent answers
       divides the std dev by √k — which still leaves it growing like √k. */
    const perEps = k => totalEps / k;
    const perError = k => Math.SQRT2 * (k / totalEps);
    const avgError = k => perError(k) / Math.sqrt(k);

    function render() {
      setMetric(perMetric, perEps(queries).toFixed(3), `${queries} × ${perEps(queries).toFixed(3)} = ${totalEps.toFixed(1)}`);
      setMetric(spentMetric, totalEps.toFixed(2), 'ε₁ + ε₂ + … + ε_k');
      setMetric(errMetric, `± ${perError(queries).toFixed(1)}`, `on a count, Δf = 1`);
      setMetric(avgMetric, `± ${avgError(queries).toFixed(1)}`, strategy === 'repeat' ? 'this is what you actually get' : 'only if the query repeats');
      avgMetric.classList.toggle('is-leak', strategy === 'repeat' && avgError(queries) > avgError(1));

      bar.replaceChildren(...[
        ...Array.from({ length: Math.min(queries, 20) }, () =>
          h('div', { class: 'budget-slice spent', style: 'flex:1' }, [queries <= 12 ? `ε/${queries}` : ''])),
        queries > 20 ? h('div', { class: 'budget-slice left', style: 'flex:1' }, [`+${queries - 20} more`]) : null
      ].filter(Boolean));

      const W = 900, H = 230, pad = 52;
      const kMax = 40;
      const sx = k => pad + (k - 1) / (kMax - 1) * (W - 2 * pad);
      /* In "repeat" mode the whole point is the shallow rise of the averaged
         curve, which is invisible if the axis is scaled to the per-answer one. */
      const maxY = (strategy === 'repeat' ? avgError(kMax) : perError(kMax)) * 1.08;
      const sy = v => H - 30 - clamp(v / maxY, 0, 1) * (H - 58);
      const line = (fn, stroke, dash) => {
        let d = '';
        for (let k = 1; k <= kMax; k++) d += `${k === 1 ? 'M' : 'L'}${sx(k).toFixed(1)},${sy(fn(k)).toFixed(1)}`;
        return svgEl('path', { d, fill: 'none', stroke, 'stroke-width': dash ? 1.8 : 2.6, 'stroke-dasharray': dash || 'none' });
      };

      chart.replaceChildren(...[
        svgEl('line', { class: 'grid-line', x1: pad, y1: H - 30, x2: W - pad, y2: H - 30 }),
        line(perError, 'var(--accent-2)'),
        line(avgError, 'var(--accent-3)', '5 4'),
        svgEl('line', { x1: sx(queries), y1: 18, x2: sx(queries), y2: H - 30, stroke: 'var(--ink)', 'stroke-width': 1.1, opacity: .5 }),
        /* where a single unrepeated query would have landed */
        strategy === 'repeat'
          ? svgEl('line', { x1: pad, y1: sy(avgError(1)), x2: W - pad, y2: sy(avgError(1)), stroke: 'var(--ink-faint)', 'stroke-width': 1.2, 'stroke-dasharray': '3 4' })
          : null,
        strategy === 'repeat'
          ? svgText({ class: 'axis-label', x: pad + 6, y: sy(avgError(1)) - 7 }, `asking once: ±${avgError(1).toFixed(1)}`)
          : null,
        svgEl('circle', { cx: sx(queries), cy: sy(strategy === 'repeat' ? avgError(queries) : perError(queries)), r: 5, fill: strategy === 'repeat' ? 'var(--accent-3)' : 'var(--accent-2)' }),
        svgText({ class: 'axis-label', x: pad + 6, y: 18, fill: 'var(--accent-2)' }, 'error of one answer  ∝ k'),
        svgText({ class: 'axis-label', x: W - pad, y: 18, 'text-anchor': 'end', fill: 'var(--accent-3)' }, 'error after averaging  ∝ √k'),
        svgText({ class: 'axis-label', x: W / 2, y: H - 8, 'text-anchor': 'middle' }, 'number of queries k, under one fixed budget'),
        svgText({ class: 'axis-label', x: pad, y: H - 8 }, '1'),
        svgText({ class: 'axis-label', x: W - pad, y: H - 8, 'text-anchor': 'end' }, String(kMax))
      ].filter(Boolean));

      if (strategy === 'repeat') {
        setVerdict(verdict, 'bad',
          `This is the week 3 attack, and it now fails. Asking the same question ${queries}× under a fixed budget means each answer carries ε/${queries}, so its noise grows like k while averaging only removes √k of it — the net error rises from ±${avgError(1).toFixed(1)} at one query to ±${avgError(queries).toFixed(1)} at ${queries}. Repetition no longer buys accuracy, which is precisely what the noisy-counts mechanism of week 3 lacked.`);
      } else {
        setVerdict(verdict, queries <= 5 ? 'ok' : 'warn',
          `Sequential composition: k mechanisms at ε₁ … ε_k release a total of Σεᵢ = ${totalEps.toFixed(1)}. Spread over ${queries} queries each answer carries ±${perError(queries).toFixed(1)} of noise on a count. The budget is a real budget — once it is spent, the curator must stop answering, because there is no further ε to charge.`);
      }
    }

    render();
    return {};
  };

  /* -------------------------------------------------------------------
     Lab 9 · does DP training stop membership inference? (Question 8)
     ------------------------------------------------------------------- */

  D.dpMembership = function (root) {
    let eps = 0.5;

    /* Week 3's lab 5, at its default train–test gap of 0.35, reaches 73%
       accuracy at the best threshold. Yeom's membership advantage is
       TPR − FPR, which for the balanced two-world game is 2 × accuracy − 1. */
    const WEEK3_ACCURACY = 0.73;
    const UNDEFENDED = 2 * WEEK3_ACCURACY - 1;      // = 0.46

    const boundMetric = metric('Advantage bound', '—', 'privacy-tone', 'Yeom et al., e^ε − 1');
    const bitesMetric = metric('Does it bite?', '—', 'attack-tone', 'against the week 3 attack');
    const thresholdMetric = metric('Beats week 3 below', '—', 'model-tone', 'ε where bound = 0.46');

    const chart = svgEl('svg', { viewBox: '0 0 900 240', role: 'img', 'aria-label': 'Membership advantage bound against epsilon' });
    const verdict = verdictBox('');

    const epsSlider = slider({
      label: 'ε', min: Math.log(0.01), max: Math.log(10), step: 0.01, value: Math.log(eps),
      format: v => fmtEps(Math.exp(v)), onInput: v => { eps = Math.exp(v); render(); }
    });
    const presets = h('div', { class: 'btn-group' }, [
      ['ln 2 ≈ 0.69', Math.log(2)], ['ε = 1', 1], ['halve week 3', Math.log(1 + UNDEFENDED / 2)]
    ].map(([label, value]) => button(label, () => { eps = value; epsSlider.set(Math.log(value)); render(); })));

    root.append(
      h('div', { class: 'lab-toolbar' }, [h('div', { class: 'toolbar-left' }, [epsSlider.node]), presets]),
      h('div', { class: 'metric-row' }, [boundMetric, bitesMetric, thresholdMetric]),
      chart,
      verdict
    );

    const bound = e => Math.exp(e) - 1;

    function render() {
      const raw = bound(eps), capped = Math.min(1, raw);
      setMetric(boundMetric, raw >= 1 ? `${raw.toFixed(2)} (≥ 1)` : raw.toFixed(3),
        raw >= 1 ? 'vacuous — advantage is at most 1 anyway' : 'a real restriction');
      setMetric(bitesMetric, raw < UNDEFENDED ? 'yes' : 'no',
        raw < UNDEFENDED ? `forces the attack below ${UNDEFENDED.toFixed(2)}` : `week 3 reached ${UNDEFENDED.toFixed(2)} unaided`);
      bitesMetric.classList.toggle('is-leak', raw >= UNDEFENDED);
      setMetric(thresholdMetric, `ε = ${Math.log(1 + UNDEFENDED).toFixed(3)}`,
        `below this the bound beats week 3's ${UNDEFENDED.toFixed(2)}`);

      const W = 900, H = 240, pad = 52;
      const lx0 = Math.log(0.01), lx1 = Math.log(10);
      const sx = e => pad + (Math.log(e) - lx0) / (lx1 - lx0) * (W - 2 * pad);
      const sy = v => H - 32 - clamp(v, 0, 1.15) / 1.15 * (H - 58);

      let d = '';
      for (let i = 0; i <= 240; i++) {
        const e = Math.exp(lx0 + (lx1 - lx0) * i / 240);
        d += `${i ? 'L' : 'M'}${sx(e).toFixed(1)},${sy(Math.min(1.15, bound(e))).toFixed(1)}`;
      }

      chart.replaceChildren(
        svgEl('line', { class: 'grid-line', x1: pad, y1: sy(1), x2: W - pad, y2: sy(1) }),
        svgEl('line', { class: 'grid-line', x1: pad, y1: H - 32, x2: W - pad, y2: H - 32 }),
        svgEl('rect', { x: sx(Math.log(2)), y: 20, width: W - pad - sx(Math.log(2)), height: H - 52, fill: 'rgba(255,155,115,.09)' }),
        svgEl('path', { d, fill: 'none', stroke: 'var(--accent-3)', 'stroke-width': 2.6 }),
        svgEl('line', { x1: pad, y1: sy(UNDEFENDED), x2: W - pad, y2: sy(UNDEFENDED), stroke: 'var(--accent-2)', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }),
        svgEl('line', { x1: sx(eps), y1: 20, x2: sx(eps), y2: H - 32, stroke: 'var(--ink)', 'stroke-width': 1.1, opacity: .5 }),
        svgEl('circle', { cx: sx(eps), cy: sy(Math.min(1.15, raw)), r: 5, fill: 'var(--accent-3)' }),
        svgText({ class: 'axis-label', x: pad + 6, y: sy(UNDEFENDED) - 7, fill: 'var(--accent-2)' }, `week 3's undefended attack: advantage ${UNDEFENDED.toFixed(2)} (73% accuracy)`),
        svgText({ class: 'axis-label', x: pad + 6, y: sy(1) - 7 }, 'advantage 1 — the bound stops meaning anything'),
        svgText({ class: 'axis-label', x: W - pad - 6, y: H - 44, 'text-anchor': 'end', fill: 'var(--accent-2)' }, 'ε > ln 2: the bound is vacuous'),
        svgText({ class: 'axis-label', x: W / 2, y: H - 8, 'text-anchor': 'middle' }, 'ε  (log scale)'),
        svgText({ class: 'axis-label', x: pad, y: H - 8 }, '0.01'),
        svgText({ class: 'axis-label', x: W - pad, y: H - 8, 'text-anchor': 'end' }, '10')
      );

      if (raw < UNDEFENDED) {
        setVerdict(verdict, 'ok',
          `Yes — and provably. At ε = ${fmtEps(eps)} the adversary's membership advantage cannot exceed ${raw.toFixed(3)}, whatever attack they run and whatever they already know. Week 3's threshold attack reached ${UNDEFENDED.toFixed(2)} on an undefended model; that is now impossible rather than merely unobserved.`);
      } else if (raw < 1) {
        setVerdict(verdict, 'warn',
          `The bound holds at ${raw.toFixed(3)}, but it is weaker than the attack week 3 actually achieved (${UNDEFENDED.toFixed(2)}). So DP is doing something, and the guarantee alone does not yet rule out the attack we already built.`);
      } else {
        setVerdict(verdict, 'bad',
          `Careful here. The worksheet's answer — yes, DP bounds membership attacks — is correct in form: treat the model as the output of a DP mechanism, and Yeom et al. bound the advantage by e^ε − 1. But at ε = ${fmtEps(eps)} that bound is ${raw.toFixed(2)}, and an advantage of 1 is the maximum anyone could have. Above ε = ln 2 the theorem forbids nothing. In practice DP-SGD does defeat these attacks at far larger ε — but that is an empirical claim, not this theorem.`);
      }
    }

    render();
    return {};
  };

  /* ===================================================================
     Concept checks
     =================================================================== */

  function quiz(root, prompt, options) {
    const feedback = h('div', { class: 'quiz-feedback', role: 'status' }, ['Choose one, then justify it to the person next to you.']);
    const buttons = options.map(([label, explanation, correct]) => button(label, event => {
      root.querySelectorAll('.quiz-options .btn').forEach(btn => {
        btn.classList.remove('correct', 'incorrect');
        btn.setAttribute('aria-pressed', 'false');
      });
      event.currentTarget.classList.add(correct ? 'correct' : 'incorrect');
      event.currentTarget.setAttribute('aria-pressed', 'true');
      feedback.textContent = explanation;
      feedback.className = `quiz-feedback ${correct ? 'correct' : 'incorrect'}`;
    }));
    buttons.forEach(btn => btn.setAttribute('aria-pressed', 'false'));
    root.append(
      prompt ? h('p', { class: 'lead center' }, [prompt]) : null,
      h('div', { class: 'quiz-options' }, buttons),
      feedback
    );
    return {};
  }

  D.sensitivityCheck = function (root) {
    return quiz(root, 'One value in the sum may be twice as large as the rest. What happens to the noise?', [
      ['Nothing — only one record in n changed, so the effect washes out.',
        'No. Sensitivity is a maximum over neighbouring pairs, not an average over records. One record is exactly what the definition ranges over.', false],
      ['The scale doubles, for every record in the dataset.',
        'Correct. Δf = 2h, so b = 2h/ε and every answer carries twice the noise — the whole release pays for the single widest possible record, even though n−1 of them still lie in [l, h].', true],
      ['The scale grows by a factor of 2/n, since only one value moved.',
        'No. That would be an averaging argument, and sensitivity does not average. For the sum the worst neighbouring pair adds or removes v₁ itself, changing the answer by up to 2h.', false]
    ]);
  };

  D.dpScopeCheck = function (root) {
    return quiz(root, 'A study using an ε-DP mechanism concludes that smoking causes cancer. X is a smoker who did not participate. Which statement is right?', [
      ['X\'s privacy was breached: the world now infers something about X\'s health.',
        'No — and this is lecture 5\'s point. The conclusion holds whether or not X was in the study, so it is not a harm of participation. DP bounds the harm of taking part, not the harm of true facts becoming known.', false],
      ['No DP guarantee was needed, since X was not in the dataset.',
        'The guarantee is still what makes the release safe for the people who were in it — and DP is defined over neighbouring datasets precisely so that it covers X had X joined.', false],
      ['DP was not violated: the inference does not depend on X\'s participation.',
        'Correct. ε-DP promises that the output distribution is nearly the same whether or not any one person contributes. Population-level findings are unaffected by that promise — DP limits what your presence reveals, not what the world can learn.', true]
    ]);
  };

  /* ===================================================================
     Mounting
     =================================================================== */

  function mount(scope) {
    scope.querySelectorAll('.demo[data-demo]').forEach(element => {
      if (element.dataset.mounted) return;
      const demo = D[element.dataset.demo];
      if (!demo) {
        element.innerHTML = `<div class="caption">Missing demo: ${element.dataset.demo}</div>`;
        return;
      }
      element.dataset.mounted = '1';
      try {
        running.set(element, demo(element) || {});
      } catch (error) {
        element.innerHTML = `<div class="caption">Demo failed: ${error.message}</div>`;
        console.error(`[demo:${element.dataset.demo}]`, error);
      }
    });
  }

  /** Stop timers on slides we have left; mounted state is kept so a
      student can navigate back to a lab without losing their work. */
  function pauseHidden(current) {
    running.forEach((api, element) => {
      if (current && current.contains(element)) return;
      if (api && typeof api.stop === 'function') api.stop();
    });
  }

  global.Demos = {
    mount,
    mountVisible() {
      const current = document.querySelector('.reveal .slides section.present');
      pauseHidden(current);
      if (current) mount(current);
    },
    mountAll() { mount(document); }
  };
})(window);
