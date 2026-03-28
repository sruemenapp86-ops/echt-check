const EchtCheckUI = (() => {
  let currentObjectUrl = null;

  function init() {
    _setupDropZone();
    _setupFileInput();
    _setupPaste();
    _setupParticles();
    document.getElementById('retry-btn').addEventListener('click', _reset);
  }

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
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { _handleFile(file); break; }
        }
      }
    });
  }

  async function _handleFile(file) {
    _showLoading(file);
    try {
      const result = await EchtCheckEngine.analyzeFile(file);
      _showResults(result, file);

      // Phase 2
      document.getElementById('phase2-loading').classList.remove('hidden');
      try { const s = await EchtCheckScanner.scan(file); _showPhase2Results(s); }
      catch(e) { console.warn('Phase2:', e); }
      finally { document.getElementById('phase2-loading').classList.add('hidden'); }

      // Phase 3
      document.getElementById('phase3-loading').classList.remove('hidden');
      try { const a = await EchtCheckAIDetector.detect(file); _showPhase3Results(a); }
      catch(e) { console.warn('Phase3:', e); }
      finally { document.getElementById('phase3-loading').classList.add('hidden'); }

      // Phase 4: Backend KI
      document.getElementById('phase4-loading').classList.remove('hidden');
      try {
        const r = await EchtCheckAPI.analyzeImage(file);
        if (r) _showPhase4Results(r);
        else document.getElementById('phase4-offline').classList.remove('hidden');
      } catch(e) { document.getElementById('phase4-offline').classList.remove('hidden'); }
      finally { document.getElementById('phase4-loading').classList.add('hidden'); }

    } catch(err) { _showError(err.message); }
  }

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

  function _showResults(result, file) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('result-state').classList.remove('hidden');

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    const prev = document.getElementById('image-preview');
    prev.src = currentObjectUrl;
    prev.alt = result.fileName;

    const vb = document.getElementById('verdict-banner');
    vb.className = `verdict-banner verdict-${result.verdict.level}`;
    document.getElementById('verdict-icon').textContent = result.verdict.icon;
    document.getElementById('verdict-label').textContent = result.verdict.label;

    const sf = document.getElementById('score-fill');
    sf.className = `score-fill score-${result.verdict.level}`;
    sf.style.width = '0%';
    setTimeout(() => { sf.style.width = result.score + '%'; }, 50);
    document.getElementById('score-text').textContent = result.score + ' / 100';

    document.getElementById('meta-filename').textContent = result.fileName;
    document.getElementById('meta-filesize').textContent = _fmtBytes(result.fileSize);
    document.getElementById('meta-filetype').textContent = result.fileType;

    _renderExifMatrix(result);
    _renderFlags(result.flags);

    document.getElementById('check-another-btn').addEventListener('click', _reset, { once: true });
    document.getElementById('result-state').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function _renderExifMatrix(result) {
    const exif = result.exif;
    const grid = document.getElementById('exif-matrix');
    grid.innerHTML = '';
    const fields = [
      { label:'Hersteller', value:exif?.make },
      { label:'Modell', value:exif?.model },
      { label:'Software', value:exif?.software },
      { label:'Datum', value:exif?.dateTimeOriginal },
      { label:'GPS Lat', value:exif?.gpsLat ? _fmtGps(exif.gpsLat) : null },
      { label:'GPS Lon', value:exif?.gpsLon ? _fmtGps(exif.gpsLon) : null },
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
    if (!flags?.length) { c.innerHTML = '<p class="text-slate-600 text-sm">Keine besonderen Auffälligkeiten.</p>'; return; }
    for (const f of flags) {
      const el = document.createElement('div');
      el.className = `flag-card flag-${f.level}`;
      el.innerHTML = `<div class="flag-header"><span>${_flagIcon(f.level)}</span><span>${f.title}</span></div><p class="flag-detail">${f.detail}</p>`;
      c.appendChild(el);
    }
  }

  function _showPhase2Results(scan) {
    const banner = document.getElementById('phase2-verdict-banner');
    banner.className = `verdict-banner verdict-${scan.verdict.level}`;
    document.getElementById('phase2-verdict-icon').textContent = scan.verdict.icon;
    document.getElementById('phase2-verdict-label').textContent = scan.verdict.label;
    const fill = document.getElementById('phase2-score-fill');
    fill.className = `score-fill score-${scan.verdict.level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = scan.combinedScore + '%'; }, 100);
    document.getElementById('phase2-score-text').textContent = scan.combinedScore + ' / 100';
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
    document.getElementById('phase2-result').classList.remove('hidden');
  }

  function _showPhase3Results(ai) {
    const banner = document.getElementById('phase3-verdict-banner');
    banner.className = `verdict-banner verdict-${ai.verdict.level}`;
    document.getElementById('phase3-verdict-icon').textContent = ai.verdict.icon;
    document.getElementById('phase3-verdict-label').textContent = ai.verdict.label;
    const fill = document.getElementById('phase3-score-fill');
    fill.className = `score-fill score-${ai.verdict.level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = ai.score + '%'; }, 100);
    document.getElementById('phase3-score-text').textContent = ai.score + ' / 100';
    const grid = document.getElementById('phase3-signals');
    grid.innerHTML = '';
    for (const sig of [ai.periodicity, ai.smoothness, ai.colorStats, ai.checkerboard]) {
      const lv = sig.suspicion > 60 ? 'danger' : sig.suspicion > 40 ? 'warning' : 'safe';
      const el = document.createElement('div');
      el.className = `flag-card flag-${lv}`;
      el.innerHTML = `<div class="flag-header"><span>${_flagIcon(lv)}</span><span>${sig.label}</span></div><p class="flag-detail">${sig.interpretation}</p>`;
      grid.appendChild(el);
    }
    document.getElementById('phase3-result').classList.remove('hidden');
  }

  function _showPhase4Results(r) {
    const score = r.score ?? 50;
    const level = score >= 65 ? 'safe' : score >= 40 ? 'warning' : 'danger';
    const icon = score >= 65 ? '✅' : score >= 40 ? '🔎' : '🔴';
    const label = score >= 65 ? 'Wahrscheinlich echt (KI-Modell)' : score >= 40 ? 'Nicht eindeutig (KI-Modell)' : 'Wahrscheinlich KI-generiert (KI-Modell)';
    const banner = document.getElementById('phase4-verdict-banner');
    banner.className = `verdict-banner verdict-${level}`;
    document.getElementById('phase4-verdict-icon').textContent = icon;
    document.getElementById('phase4-verdict-label').textContent = label;
    const fill = document.getElementById('phase4-score-fill');
    fill.className = `score-fill score-${level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = score + '%'; }, 100);
    document.getElementById('phase4-score-text').textContent = score + ' / 100';
    document.getElementById('phase4-method').textContent = r.method === 'onnx_model' ? '🤖 Lokales ONNX-Modell (GPU)' : '📊 Statistisches Fallback-Modell';
    document.getElementById('phase4-result').classList.remove('hidden');
  }

  function _reset() {
    document.getElementById('result-state').classList.add('hidden');
    document.getElementById('error-state').classList.add('hidden');
    document.getElementById('phase2-loading').classList.add('hidden');
    document.getElementById('phase2-result').classList.add('hidden');
    document.getElementById('phase2-ela-block').classList.add('hidden');
    document.getElementById('phase3-loading').classList.add('hidden');
    document.getElementById('phase3-result').classList.add('hidden');
    document.getElementById('phase4-loading').classList.add('hidden');
    document.getElementById('phase4-result').classList.add('hidden');
    document.getElementById('phase4-offline').classList.add('hidden');
    document.getElementById('welcome-state').classList.remove('hidden');
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function _flagIcon(l) { return {danger:'🔴',warning:'⚠️',info:'ℹ️',safe:'✅'}[l] || 'ℹ️'; }
  function _fmtBytes(b) { if(b<1024) return b+'B'; if(b<1048576) return (b/1024).toFixed(1)+'KB'; return (b/1048576).toFixed(2)+'MB'; }
  function _fmtGps(a) { if(!Array.isArray(a)) return JSON.stringify(a); return `${a[0]}° ${a[1]}' ${typeof a[2]==='number'?a[2].toFixed(2):a[2]}"`; }

  function _setupParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    resize(); window.addEventListener('resize', resize);
    const P = Array.from({length:50}, () => ({ x:Math.random()*canvas.width, y:Math.random()*canvas.height, r:Math.random()*1.5+0.3, dx:(Math.random()-.5)*.3, dy:(Math.random()-.5)*.3, a:Math.random()*.5+.1 }));
    (function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for(const p of P) { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`rgba(0,200,255,${p.a})`; ctx.fill(); p.x+=p.dx; p.y+=p.dy; if(p.x<0||p.x>canvas.width)p.dx*=-1; if(p.y<0||p.y>canvas.height)p.dy*=-1; }
      requestAnimationFrame(draw);
    })();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => EchtCheckUI.init());