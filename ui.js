const EchtCheckUI = (() => {
  let currentObjectUrl = null;
  let phaseScores = { p1: null, p2: null, p3: null, p4: null };

  // ─── Verdict-Texte ─────────────────────────────────────────────────────────
  const VERDICT_TEXT = {
    safe:    { label: 'Wahrscheinlich echtes Foto',        color: 'safe',    icon: '✅', num: 'verdict-number-safe' },
    warning: { label: 'Nicht eindeutig bestimmbar',        color: 'warning', icon: '🔎', num: 'verdict-number-warning' },
    danger:  { label: 'Wahrscheinlich KI-generiert',       color: 'danger',  icon: '🚨', num: 'verdict-number-danger' },
    info:    { label: 'Wird analysiert…',                  color: 'info',    icon: '🔍', num: 'verdict-number-info' },
  };

  const SUMMARY_TEXT = {
    safe:    'Das Bild zeigt keine typischen Merkmale von KI-Generierung oder digitaler Manipulation. Es verhält sich wie ein echtes Kamerafoto.',
    warning: 'Die Analyse ist nicht eindeutig. Einige Merkmale deuten auf Bearbeitung hin, andere sprechen für ein echtes Foto. Im Zweifelsfall die Quelle prüfen.',
    danger:  'Das Bild zeigt deutliche Hinweise auf KI-Generierung oder starke digitale Bearbeitung. Mit hoher Wahrscheinlichkeit handelt es sich nicht um ein echtes Foto.',
    info:    'Die Analyse läuft. Das Ergebnis erscheint hier in wenigen Sekunden.',
  };

  // ─── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _setupDropZone();
    _setupFileInput();
    _setupPaste();
    _setupParticles();
    document.getElementById('retry-btn').addEventListener('click', _reset);
  }

  // ─── Input-Handler ─────────────────────────────────────────────────────────
  function _setupDropZone() {
    const zone = document.getElementById('drop-zone');
    const fi = document.getElementById('file-input');
    ['dragenter','dragover'].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add('drag-active'); }));
    ['dragleave','drop'].forEach(e => zone.addEventListener(e, () => zone.classList.remove('drag-active')));
    zone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f) _handleFile(f); });
    zone.addEventListener('click', () => fi.click());
  }

  function _setupFileInput() {
    const fi = document.getElementById('file-input');
    fi.addEventListener('change', e => { const f = e.target.files[0]; if(f) _handleFile(f); fi.value=''; });
  }

  function _setupPaste() {
    document.addEventListener('paste', e => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) { const file = item.getAsFile(); if (file) { _handleFile(file); break; } }
      }
    });
  }

  // ─── Analyse-Flow ──────────────────────────────────────────────────────────
  async function _handleFile(file) {
    phaseScores = { p1: null, p2: null, p3: null, p4: null };
    _showLoading(file);

    try {
      // Phase 1 (synchron, schnell)
      const result = await EchtCheckEngine.analyzeFile(file);
      _showInitialResult(result, file);
      phaseScores.p1 = result.score;
      _setDot(['dot-p1','dot-p1b'], result.verdict.level);
      _setBadge('p1-badge', result.verdict.level, result.verdict.label);
      _updateHero();

      // Phase 2
      _setDot(['dot-p2','dot-p2b'], 'loading');
      try {
        const s = await EchtCheckScanner.scan(file);
        _showPhase2Results(s);
        phaseScores.p2 = s.combinedScore;
        _setDot(['dot-p2','dot-p2b'], s.verdict.level);
        _setBadge('p2-badge', s.verdict.level, s.verdict.label);
      } catch(e) {
        console.warn('Phase2:', e);
        _setDot(['dot-p2','dot-p2b'], 'warning');
        _setBadge('p2-badge', 'warning', 'Fehler');
      }
      _updateHero();

      // Phase 3
      _setDot(['dot-p3','dot-p3b'], 'loading');
      try {
        const a = await EchtCheckAIDetector.detect(file);
        _showPhase3Results(a);
        phaseScores.p3 = a.score;
        _setDot(['dot-p3','dot-p3b'], a.verdict.level);
        _setBadge('p3-badge', a.verdict.level, a.verdict.label);
      } catch(e) {
        console.warn('Phase3:', e);
        _setDot(['dot-p3','dot-p3b'], 'warning');
        _setBadge('p3-badge', 'warning', 'Fehler');
      }
      _updateHero();

      // Phase 4 (Backend KI)
      _setDot(['dot-p4','dot-p4b'], 'loading');
      try {
        const r = await EchtCheckAPI.analyzeImage(file);
        if (r) {
          _showPhase4Results(r);
          phaseScores.p4 = r.score ?? 50;
          const lvl = (r.score ?? 50) >= 65 ? 'safe' : (r.score ?? 50) >= 40 ? 'warning' : 'danger';
          _setDot(['dot-p4','dot-p4b'], lvl);
          _setBadge('p4-badge', lvl, lvl === 'safe' ? 'Wahrscheinlich echt' : lvl === 'danger' ? 'Wahrscheinlich KI' : 'Nicht eindeutig');
        } else {
          document.getElementById('phase4-offline').classList.remove('hidden');
          _setDot(['dot-p4','dot-p4b'], 'warning');
          _setBadge('p4-badge', 'warning', 'Nicht erreichbar');
        }
      } catch(e) {
        document.getElementById('phase4-offline').classList.remove('hidden');
        _setDot(['dot-p4','dot-p4b'], 'warning');
        _setBadge('p4-badge', 'warning', 'Offline');
      }
      _updateHero();

    } catch(err) { _showError(err.message); }
  }

  // ─── Hero-Update (wird nach jeder Phase aufgerufen) ─────────────────────────
  function _updateHero() {
    const scores = Object.values(phaseScores).filter(v => v !== null);
    if (!scores.length) return;

    // Gewichtung: Phase 4 (KI-Modell) zählt doppelt wenn vorhanden
    let weighted = [...scores];
    if (phaseScores.p4 !== null) weighted.push(phaseScores.p4); // Extra-Gewicht
    const avg = Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length);

    const level = avg >= 65 ? 'safe' : avg >= 40 ? 'warning' : 'danger';
    const vt = VERDICT_TEXT[level];

    // Hero-Card styling
    const hero = document.getElementById('result-hero');
    hero.className = `glass p-6 border-2 verdict-hero-${level}`;

    // Score number
    const numEl = document.getElementById('hero-score');
    numEl.textContent = avg;
    numEl.className = `verdict-number ${vt.num}`;

    // Verdict text
    document.getElementById('hero-verdict').textContent = vt.label;
    document.getElementById('hero-summary').textContent = SUMMARY_TEXT[level];

    // Score bar
    const fill = document.getElementById('hero-score-fill');
    fill.className = `score-fill score-${level}`;
    fill.style.width = avg + '%';
  }

  // ─── States ────────────────────────────────────────────────────────────────
  function _showLoading(file) {
    document.getElementById('welcome-state').classList.add('hidden');
    document.getElementById('result-state').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('loading-state').classList.remove('hidden');
    document.getElementById('loading-filename').textContent = file.name;
  }

  function _showError(msg) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('error-state').classList.remove('hidden');
    document.getElementById('error-message').textContent = msg;
  }

  function _showInitialResult(result, file) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('result-state').classList.remove('hidden');

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    const prev = document.getElementById('image-preview');
    prev.src = currentObjectUrl;
    prev.alt = result.fileName;

    document.getElementById('meta-info').textContent = `${result.fileName} · ${_fmtBytes(result.fileSize)} · ${result.fileType}`;

    // Initial hero (info state, wird durch _updateHero() überschrieben)
    document.getElementById('hero-score').textContent = result.score;
    document.getElementById('hero-score').className = `verdict-number verdict-number-${result.verdict.level}`;
    document.getElementById('hero-verdict').textContent = VERDICT_TEXT[result.verdict.level]?.label ?? result.verdict.label;
    document.getElementById('hero-summary').textContent = SUMMARY_TEXT[result.verdict.level] ?? '';
    const fill = document.getElementById('hero-score-fill');
    fill.className = `score-fill score-${result.verdict.level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = result.score + '%'; }, 50);
    document.getElementById('result-hero').className = `glass p-6 border-2 verdict-hero-${result.verdict.level}`;

    _renderExifMatrix(result);
    _renderFlags(result.flags);

    document.getElementById('check-another-btn').addEventListener('click', _reset, { once: true });
    document.getElementById('result-state').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── Phase-Ergebnis-Renderer ───────────────────────────────────────────────
  function _renderExifMatrix(result) {
    const exif = result.exif;
    const grid = document.getElementById('exif-matrix');
    grid.innerHTML = '';
    const fields = [
      { label:'Hersteller', value:exif?.make },
      { label:'Modell', value:exif?.model },
      { label:'Software', value:exif?.software },
      { label:'Datum', value:exif?.dateTimeOriginal },
      { label:'GPS', value:exif?.gpsLat ? _fmtGps(exif.gpsLat) : null },
      { label:'ISO', value:exif?.iso },
      { label:'Blende', value:exif?.fNumber ? `f/${exif.fNumber}` : null },
      { label:'Brennweite', value:exif?.focalLength ? `${exif.focalLength}mm` : null },
      { label:'Belichtung', value:exif?.exposureTime ? `1/${Math.round(1/exif.exposureTime)}s` : null },
      { label:'Urheber', value:exif?.copyright },
    ];
    let any = false;
    for (const f of fields) {
      if (f.value != null && f.value !== '') {
        any = true;
        const c = document.createElement('div');
        c.className = 'exif-cell';
        c.innerHTML = `<span class="exif-label">${f.label}</span><span class="exif-value">${f.value}</span>`;
        grid.appendChild(c);
      }
    }
    if (!any) grid.innerHTML = '<div class="exif-empty">Keine EXIF-Daten – typisch für Screenshots oder bearbeitete Bilder.</div>';
  }

  function _renderFlags(flags) {
    const c = document.getElementById('flags-container');
    c.innerHTML = '';
    if (!flags?.length) { c.innerHTML = '<p class="text-slate-700 text-xs">Keine weiteren Auffälligkeiten.</p>'; return; }
    for (const f of flags) {
      const el = document.createElement('div');
      el.className = `flag-card flag-${f.level}`;
      el.innerHTML = `<div class="flag-header"><span>${_flagIcon(f.level)}</span><span>${f.title}</span></div><p class="flag-detail">${f.detail}</p>`;
      c.appendChild(el);
    }
  }

  function _showPhase2Results(scan) {
    if (scan.ela?.available && scan.ela?.elaCanvas) {
      const dc = document.getElementById('ela-canvas-display');
      dc.width = scan.ela.elaCanvas.width; dc.height = scan.ela.elaCanvas.height;
      dc.getContext('2d').drawImage(scan.ela.elaCanvas, 0, 0);
      document.getElementById('ela-mean').textContent = scan.ela.mean;
      document.getElementById('ela-stddev').textContent = scan.ela.stdDev;
      document.getElementById('ela-interpretation').textContent = scan.ela.interpretation;
      document.getElementById('phase2-ela-block').classList.remove('hidden');
    }
    document.getElementById('noise-absmean').textContent = scan.noise.absMean;
    document.getElementById('noise-stddev').textContent = scan.noise.stdDev;
    document.getElementById('noise-interpretation').textContent = scan.noise.interpretation;
    document.getElementById('color-entropy').textContent = scan.color.entropy;
    document.getElementById('color-interpretation').textContent = scan.color.interpretation;
  }

  function _showPhase3Results(ai) {
    const grid = document.getElementById('phase3-signals');
    // Behalte den "Was bedeutet das?" Text
    const tip = grid.querySelector('p');
    grid.innerHTML = '';
    for (const sig of [ai.periodicity, ai.smoothness, ai.colorStats, ai.checkerboard]) {
      const lv = sig.suspicion > 60 ? 'danger' : sig.suspicion > 40 ? 'warning' : 'safe';
      const el = document.createElement('div');
      el.className = `flag-card flag-${lv}`;
      el.innerHTML = `<div class="flag-header"><span>${_flagIcon(lv)}</span><span>${sig.label}</span></div><p class="flag-detail">${sig.interpretation}</p>`;
      grid.appendChild(el);
    }
    if (tip) grid.appendChild(tip);
  }

  function _showPhase4Results(r) {
    const score = r.score ?? 50;
    const level = score >= 65 ? 'safe' : score >= 40 ? 'warning' : 'danger';
    const fill = document.getElementById('phase4-score-fill');
    fill.className = `score-fill score-${level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = score + '%'; }, 100);
    document.getElementById('phase4-score-text').textContent = `${score} / 100`;
    const methodLabel = r.method === 'onnx_model'
      ? '🤖 SwinV2-Modell auf GPU (lokal, keine Datenweitergabe)'
      : '📊 Statistisches Fallback-Modell';
    document.getElementById('phase4-method').textContent = methodLabel;
    document.getElementById('phase4-result').classList.remove('hidden');
  }

  // ─── Dot + Badge Helpers ───────────────────────────────────────────────────
  function _setDot(ids, level) {
    const cls = {
      safe: 'phase-dot-safe', warning: 'phase-dot-warning',
      danger: 'phase-dot-danger', loading: 'phase-dot-loading', info: 'phase-dot-loading'
    };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) { el.className = 'phase-dot ' + (cls[level] || 'phase-dot-loading'); }
    }
  }

  function _setBadge(id, level, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const cls = { safe:'badge-safe', warning:'badge-warning', danger:'badge-danger', info:'badge-info' };
    const icons = { safe:'✅', warning:'⚠️', danger:'🔴', info:'🔍' };
    el.className = `badge ${cls[level] || 'badge-muted'} ml-2`;
    el.textContent = `${icons[level] || ''} ${text}`;
  }

  // ─── Reset ─────────────────────────────────────────────────────────────────
  function _reset() {
    document.getElementById('result-state').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('phase2-ela-block').classList.add('hidden');
    document.getElementById('phase4-result').classList.add('hidden');
    document.getElementById('phase4-offline').classList.add('hidden');
    // Reset dots
    for (const id of ['dot-p1','dot-p1b','dot-p2','dot-p2b','dot-p3','dot-p3b','dot-p4','dot-p4b']) {
      const el = document.getElementById(id);
      if (el) el.className = 'phase-dot phase-dot-loading';
    }
    for (const id of ['p1-badge','p2-badge','p3-badge','p4-badge']) {
      const el = document.getElementById(id);
      if (el) { el.className = 'badge badge-muted ml-2'; el.textContent = 'läuft…'; }
    }
    document.getElementById('hero-score').textContent = '–';
    document.getElementById('hero-verdict').textContent = 'Wird analysiert…';
    document.getElementById('hero-score-fill').style.width = '0%';
    document.getElementById('welcome-state').classList.remove('hidden');
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    phaseScores = { p1: null, p2: null, p3: null, p4: null };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Utils ─────────────────────────────────────────────────────────────────
  function _flagIcon(l) { return {danger:'🔴',warning:'⚠️',info:'ℹ️',safe:'✅'}[l] || 'ℹ️'; }
  function _fmtBytes(b) { if(b<1024) return b+'B'; if(b<1048576) return (b/1024).toFixed(1)+'KB'; return (b/1048576).toFixed(2)+'MB'; }
  function _fmtGps(a) { if(!Array.isArray(a)) return JSON.stringify(a); return `${a[0]}° ${a[1]}' ${typeof a[2]==='number'?a[2].toFixed(2):a[2]}"`; }

  function _setupParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    const P = Array.from({length:40}, () => ({ x:Math.random()*canvas.width, y:Math.random()*canvas.height, r:Math.random()*1.2+0.3, dx:(Math.random()-.5)*.25, dy:(Math.random()-.5)*.25, a:Math.random()*.4+.08 }));
    (function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for(const p of P) { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`rgba(0,200,255,${p.a})`; ctx.fill(); p.x+=p.dx; p.y+=p.dy; if(p.x<0||p.x>canvas.width)p.dx*=-1; if(p.y<0||p.y>canvas.height)p.dy*=-1; }
      requestAnimationFrame(draw);
    })();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => EchtCheckUI.init());