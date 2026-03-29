const EchtCheckUI = (() => {
  let currentObjectUrl = null;
  let phaseScores = { p1: null, p2: null, p3: null, p4: null, p5: null, p6: null };
  let _analysisComplete = false;
  let _p4IsReal = false;
  let _ocrText = null; // OCR-Text für LLM-Weitergabe

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
    phaseScores = { p1: null, p2: null, p3: null, p4: null, p5: null };
    _analysisComplete = false;
    _p4IsReal = false;
    _showLoading(file);

    try {
      // Phase 1 (synchron, schnell)
      const result = await EchtCheckEngine.analyzeFile(file);
      _showInitialResult(result, file);
      phaseScores.p1 = result.score;
      _setDot(['dot-p1'], result.verdict.level);
      _setBadge('p1-badge', result.verdict.level, result.verdict.label);
      _updateHero();

      // Phase 2
      _setDot(['dot-p2'], 'loading');
      try {
        const s = await EchtCheckScanner.scan(file);
        _showPhase2Results(s);
        phaseScores.p2 = s.combinedScore;
        _setDot(['dot-p2'], s.verdict.level);
        _setBadge('p2-badge', s.verdict.level, s.verdict.label);
      } catch(e) {
        console.warn('Phase2:', e);
        _setDot(['dot-p2'], 'warning');
        _setBadge('p2-badge', 'warning', 'Fehler');
      }
      _updateHero();

      // Phase 3
      _setDot(['dot-p3'], 'loading');
      try {
        const a = await EchtCheckAIDetector.detect(file);
        _showPhase3Results(a);
        phaseScores.p3 = a.score;
        _setDot(['dot-p3'], a.verdict.level);
        _setBadge('p3-badge', a.verdict.level, a.verdict.label);
      } catch(e) {
        console.warn('Phase3:', e);
        _setDot(['dot-p3'], 'warning');
        _setBadge('p3-badge', 'warning', 'Fehler');
      }
      _updateHero();

      // Phase 5: OCR Textanalyse
      _setDot(['dot-p5'], 'loading');
      document.getElementById('ocr-loading').classList.remove('hidden');
      if (EchtCheckOCR.looksLikeScreenshot(file.type, !!result.exif?.make)) {
        document.getElementById('acc-phase5').open = true;
      }
      try {
        const ocr = await EchtCheckOCR.detect(file, pct => {
          document.getElementById('ocr-progress-fill').style.width = pct + '%';
        });
        document.getElementById('ocr-loading').classList.add('hidden');
        _showPhase5Results(ocr);
        _ocrText = ocr.valid ? ocr.text : null; // für LLM merken
        phaseScores.p5 = ocr.valid ? ocr.score : null;
        const lvl5 = !ocr.valid ? 'info' : ocr.level;
        _setDot(['dot-p5'], lvl5);
        _setBadge('p5-badge', lvl5, !ocr.valid ? 'Kein Text' : ocr.verdict);
      } catch(e) {
        console.warn('OCR:', e.message);
        document.getElementById('ocr-loading').classList.add('hidden');
        document.getElementById('ocr-skipped').classList.remove('hidden');
        _setDot(['dot-p5'], 'info');
        _setBadge('p5-badge', 'info', e.message.includes('Timeout') ? 'Timeout' : 'Fehler');
      }
      _updateHero();

      // Phase 4 (Backend KI) – LETZTE PHASE
      _setDot(['dot-p4'], 'loading');
      try {
        const r = await EchtCheckAPI.analyzeImage(file);
        if (r) {
          _showPhase4Results(r);
          phaseScores.p4 = r.score ?? 50;
          _p4IsReal = (r.method && r.method !== 'statistical_fallback');
          const lvl = (r.score ?? 50) >= 65 ? 'safe' : (r.score ?? 50) >= 40 ? 'warning' : 'danger';
          _setDot(['dot-p4'], lvl);
          _setBadge('p4-badge', lvl, lvl === 'safe' ? 'Keine KI-Generierung' : lvl === 'danger' ? 'KI-generiert' : 'KI-Generierung möglich');
        } else {
          document.getElementById('phase4-offline').classList.remove('hidden');
          _setDot(['dot-p4'], 'warning');
          _setBadge('p4-badge', 'warning', 'Nicht erreichbar');
        }
      } catch(e) {
        document.getElementById('phase4-offline').classList.remove('hidden');
        _setDot(['dot-p4'], 'warning');
        _setBadge('p4-badge', 'warning', 'Offline');
      }
      // Alle Vorphasen fertig
      _finalizeHero();

      // Phase 6: LLM-Tiefenanalyse (läuft nach Finale, aktualisiert danach nochmal)
      _setDot(['dot-p6b'], 'loading');
      _setBadge('p6-badge', 'info', 'läuft…');
      try {
        const llmStatus = await EchtCheckAPI.checkLLMStatus();
        if (!llmStatus.online) {
          document.getElementById('llm-offline').classList.remove('hidden');
          _setDot(['dot-p6b'], 'info');
          _setBadge('p6-badge', 'info', 'Ollama offline');
        } else if (!llmStatus.textReady && !llmStatus.visionReady) {
          document.getElementById('llm-model-missing').classList.remove('hidden');
          _setDot(['dot-p6b'], 'warning');
          _setBadge('p6-badge', 'warning', 'Modell fehlt');
        } else {
          // Beide LLM-Anfragen parallel starten
          const [imgRes, txtRes] = await Promise.allSettled([
            llmStatus.visionReady ? EchtCheckAPI.analyzeLLMImage(file) : Promise.resolve(null),
            (llmStatus.textReady && _ocrText && _ocrText.length >= 20)
              ? EchtCheckAPI.analyzeLLMText(_ocrText)
              : Promise.resolve(null)
          ]);

          const imgData = imgRes.status === 'fulfilled' ? imgRes.value : null;
          const txtData = txtRes.status === 'fulfilled' ? txtRes.value : null;

          _showPhase6Results(imgData, txtData);

          // Score berechnen (niedrigster Score gewinnt - Vorsichtsprinzip)
          let p6scores = [];
          if (imgData) {
            const imgScore = imgData.manipulated ? Math.min(imgData.confidence ?? 50, 40)
                           : Math.max(60, 100 - (imgData.confidence ?? 50));
            p6scores.push(imgScore);
          }
          if (txtData) {
            // Text-LLM gibt oft einen 'Suspicion Score' (100 = Hetze/Fake). Wir brauchen einen Authentizitäts-Score (100 = Gut).
            let txtScore = 100 - (txtData.score ?? 50);
            if (txtData.suspicious) txtScore = Math.min(txtScore, 40);
            p6scores.push(txtScore);
          }
          if (p6scores.length) {
            // Konservativste Metrik verwenden (niedrigster Wert entscheidet über Phase 6)
            phaseScores.p6 = Math.min(...p6scores);
          }

          const p6lvl = (phaseScores.p6 ?? 50) >= 65 ? 'safe'
                      : (phaseScores.p6 ?? 50) >= 40 ? 'warning' : 'danger';
          _setDot(['dot-p6b'], p6lvl);
          _setBadge('p6-badge', p6lvl,
            p6lvl === 'safe' ? 'Keine Auffälligkeiten'
            : p6lvl === 'danger' ? 'Probleme erkannt' : 'Leichte Auffälligkeiten');

          // Hero-Score nachträglich mit p6 aktualisieren
          _finalizeHero();
        }
      } catch(e) {
        console.warn('Phase6 LLM:', e.message);
        _setDot(['dot-p6b'], 'info');
        _setBadge('p6-badge', 'info', 'Fehler');
      }

    } catch(err) { _showError(err.message); }
  }

  // ─── _updateHero: Dots im Analyse-Banner, KEIN Score-Update (nur intern) ──────────────
  function _updateHero() {
    // Nichts weiter – Score wird erst in _finalizeHero() gesetzt.
    // Diese Funktion bleibt für zukünftige Zwecke.
  }

  // ─── Alle Phasen fertig: Banner -> Ergebnis ───────────────────────────────
  function _finalizeHero() {
    _analysisComplete = true;
    const scores = Object.values(phaseScores).filter(v => v !== null);
    if (!scores.length) return;

    // Gewichtung:
    // - p4 (KI-Modell) doppelt: NUR wenn kein OCR-Ergebnis vorhanden UND kein Fallback
    // - p6 (LLM) doppelt: tiefste Analyse, hat Vorrang
    let weighted = [...scores];
    const p4ShouldDouble = phaseScores.p4 !== null
      && phaseScores.p5 === null
      && _p4IsReal;
    if (!weighted.length) return; // NaN-Guard
    let avg = Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length);
    if (isNaN(avg)) return; // NaN-Guard

    // Veto-Regel (Vorsichtsprinzip): Wenn Tiefenanalyse (P6) oder OCR (P5) 
    // rote Flaggen werfen (score <= 40), darf das Gesamt-Bild maximal als "manipuliert" gelten!
    const minCritical = Math.min(phaseScores.p6 ?? 100, phaseScores.p5 ?? 100);
    if (minCritical <= 40) {
      avg = Math.min(avg, 40); // Kappung auf max. 40 (danger)
    }

    const level = avg >= 65 ? 'safe' : avg >= 40 ? 'warning' : 'danger';
    let vt = VERDICT_TEXT[level];
    
    // Wenn das Veto gegriffen hat, scharfen Text wählen
    if (minCritical <= 40 && avg <= 40) {
      vt = {
        title: 'Manipulation erkannt',
        desc: 'Die KI-Tiefenanalyse (oder Texterkennung) hat starke Hinweise auf Bildmanipulation, Kontext-Fälschung oder problematische Inhalte gefunden.'
      };
    }

    // Hero-Card styling updaten
    const hero = document.getElementById('result-hero');
    hero.className = `glass p-5 border-2 verdict-hero-${level}`;

    // Banner ausblenden, Ergebnis-Block einblenden
    document.getElementById('hero-analyzing-banner').classList.add('hidden');
    const block = document.getElementById('hero-result-block');
    block.classList.remove('hidden');

    // Zweites Bild-Preview befüllen
    const imgResult = document.getElementById('image-preview-result');
    const imgOrig   = document.getElementById('image-preview');
    imgResult.src = imgOrig.src;
    imgResult.alt = imgOrig.alt;

    // Score-Zahl
    const numEl = document.getElementById('hero-score');
    numEl.textContent = avg;
    numEl.className = `verdict-number ${vt.num}`;

    // Verdict text
    document.getElementById('hero-verdict').textContent = vt.label;
    document.getElementById('hero-summary').textContent = SUMMARY_TEXT[level];

    // Score bar (animiert)
    const fill = document.getElementById('hero-score-fill');
    fill.className = `score-fill score-${level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = avg + '%'; }, 60);

    // Banner-Dots → Ergebnis-Dots spiegeln
    [['dot-p1','dot-p1b'],['dot-p2','dot-p2b'],['dot-p3','dot-p3b'],
     ['dot-p4','dot-p4b'],['dot-p5','dot-p5b']].forEach(([src, dst]) => {
      const s = document.getElementById(src);
      const d = document.getElementById(dst);
      if (s && d) d.className = s.className;
    });

    // Scroll zum Ergebnis
    setTimeout(() => hero.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  // ─── Phase 6: LLM-Ergebnisse rendern ──────────────────────────────
  function _showPhase6Results(imgData, txtData) {
    const sevCls = { high:'badge-danger', medium:'badge-warning', low:'badge-info' };
    const typLbl = { hate:'Hetze', fake:'Fake-News', manipulation:'Manipulation', disinfo:'Desinformation' };

    if (imgData && !imgData.error) {
      document.getElementById('llm-image-result').classList.remove('hidden');
      const flagsEl = document.getElementById('llm-image-flags');
      flagsEl.innerHTML = '';
      if (imgData.manipulated) {
        (imgData.flags || []).forEach(f => {
          const txt = typeof f === 'string' ? f : (f.text || JSON.stringify(f));
          flagsEl.innerHTML += `<div class="glass p-2 rounded-lg border border-red-700/30 text-xs text-red-300">🔍 ${txt}</div>`;
        });
        if (!(imgData.flags || []).length) {
          flagsEl.innerHTML = `<div class="glass p-2 rounded-lg border border-amber-700/30 text-xs text-amber-400">⚠️ ${imgData.verdict || 'Auffälligkeiten erkannt'}</div>`;
        }
      } else {
        flagsEl.innerHTML = `<div class="glass p-2 rounded-lg border border-emerald-700/30 text-xs text-emerald-400">✅ Keine Manipulationsmerkmale erkannt</div>`;
      }
      document.getElementById('llm-image-explanation').textContent = imgData.explanation || imgData.verdict || '';
    }

    if (txtData && !txtData.error) {
      document.getElementById('llm-text-result').classList.remove('hidden');
      const flagsEl = document.getElementById('llm-text-flags');
      flagsEl.innerHTML = '';
      if (txtData.suspicious && (txtData.flags || []).length) {
        txtData.flags.forEach(f => {
          const sev = f.severity || 'low';
          const lbl = typLbl[f.type] || f.type || 'Hinweis';
          flagsEl.innerHTML += `<div class="glass p-2 rounded-lg border border-red-700/30">
            <span class="badge ${sevCls[sev] || 'badge-info'} text-xs">${lbl}</span>
            <span class="text-xs text-slate-400 ml-2">${f.text || ''}</span>
          </div>`;
        });
      } else {
        flagsEl.innerHTML = `<div class="glass p-2 rounded-lg border border-emerald-700/30 text-xs text-emerald-400">✅ Keine problematischen Inhalte erkannt</div>`;
      }
      document.getElementById('llm-text-summary').textContent = txtData.summary || '';
    } else if (imgData && !txtData) {
      document.getElementById('llm-no-text').classList.remove('hidden');
    }
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

    // Banner sichtbar, Ergebnis-Block versteckt
    document.getElementById('hero-analyzing-banner').classList.remove('hidden');
    document.getElementById('hero-result-block').classList.add('hidden');
    document.getElementById('result-hero').className = 'glass p-5 verdict-hero-info border-2';

    _renderExifMatrix(result);
    _renderFlags(result.flags);

    document.getElementById('check-another-btn').addEventListener('click', _reset, { once: true });
  }

  // ─── Phase 5 OCR ──────────────────────────────────────────────────────────
  function _showPhase5Results(ocr) {
    if (!ocr.valid) {
      document.getElementById('ocr-no-text').classList.remove('hidden');
      return;
    }
    document.getElementById('ocr-text').textContent = ocr.text;
    document.getElementById('ocr-stats-words').textContent = `${ocr.stats?.wordCount ?? '?'} Wörter erkannt`;
    document.getElementById('ocr-stats-confidence').textContent = `OCR-Konfidenz: ${ocr.ocrConfidence}%`;
    const grid = document.getElementById('ocr-signals');
    grid.innerHTML = '';
    for (const sig of (ocr.signals || [])) {
      const el = document.createElement('div');
      el.className = `flag-card flag-${sig.level}`;
      el.innerHTML = `<div class="flag-header"><span>${_flagIcon(sig.level)}</span><span>${sig.title}</span></div><p class="flag-detail">${sig.detail}</p>`;
      grid.appendChild(el);
    }
    document.getElementById('ocr-result').classList.remove('hidden');
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
      if (el) {
        // Basis-Klasse beibehalten (phase-dot), Status-Klasse wechseln
        const base = el.style.cssText ? 'phase-dot' : (el.className.includes('phase-dot') ? 'phase-dot' : 'phase-dot');
        el.className = base + ' ' + (cls[level] || 'phase-dot-loading');
      }
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
    document.getElementById('ocr-loading').classList.add('hidden');
    document.getElementById('ocr-result').classList.add('hidden');
    document.getElementById('ocr-no-text').classList.add('hidden');
    document.getElementById('ocr-skipped').classList.add('hidden');
    document.getElementById('ocr-progress-fill').style.width = '0%';
    // Reset Banner / Ergebnis-Block
    document.getElementById('hero-analyzing-banner').classList.remove('hidden');
    document.getElementById('hero-result-block').classList.add('hidden');
    document.getElementById('result-hero').className = 'glass p-5 verdict-hero-info border-2';
    // Reset dots
    for (const id of ['dot-p1','dot-p2','dot-p3','dot-p4','dot-p5']) {
      const el = document.getElementById(id);
      if (el) el.className = 'phase-dot phase-dot-loading';
    }
    for (const id of ['dot-p1b','dot-p2b','dot-p3b','dot-p4b','dot-p5b','dot-p6b']) {
      const el = document.getElementById(id);
      if (el) el.className = 'phase-dot phase-dot-loading';
    }
    for (const id of ['p1-badge','p2-badge','p3-badge','p4-badge','p5-badge','p6-badge']) {
      const el = document.getElementById(id);
      if (el) { el.className = 'badge badge-muted ml-2'; el.textContent = 'läuft…'; }
    }
    // Phase 6 LLM-Elemente zurücksetzen
    for (const id of ['llm-offline','llm-model-missing','llm-image-result','llm-text-result','llm-no-text']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
    document.getElementById('hero-score').textContent = '–';
    document.getElementById('hero-verdict').textContent = 'Wird analysiert…';
    document.getElementById('hero-score-fill').style.width = '0%';
    document.getElementById('welcome-state').classList.remove('hidden');
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    phaseScores = { p1: null, p2: null, p3: null, p4: null, p5: null };
    _analysisComplete = false;
    _p4IsReal = false;
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

  // ─── Tab-Switcher ──────────────────────────────────────────────────────────
  function switchTab(tab) {
    const isImg = tab === 'image';
    document.getElementById('tab-panel-image').classList.toggle('hidden', !isImg);
    document.getElementById('tab-panel-url').classList.toggle('hidden', isImg);
    document.getElementById('tab-image').className = `px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${isImg ? 'bg-cyan-500 text-slate-900' : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'}`;
    document.getElementById('tab-url').className = `px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${!isImg ? 'bg-violet-500 text-white' : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'}`;
  }

  // ─── URL-Analyse ───────────────────────────────────────────────────────────
  async function submitUrl() {
    const input = document.getElementById('url-input');
    const url = input?.value?.trim();
    if (!url) { input?.focus(); return; }

    document.getElementById('welcome-state').classList.add('hidden');
    document.getElementById('url-result-state').classList.add('hidden');
    document.getElementById('loading-state').classList.remove('hidden');
    document.getElementById('loading-filename').textContent = url.replace(/^https?:\/\//, '');

    try {
      const result = await EchtCheckURLChecker.analyze(url);
      _showUrlResult(result);
    } catch(e) {
      document.getElementById('loading-state').classList.add('hidden');
      document.getElementById('welcome-state').classList.remove('hidden');
      alert(`Fehler: ${e.message}`);
    }
  }

  function _showUrlResult(result) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('url-result-state').classList.remove('hidden');

    document.getElementById('url-domain-label').textContent = `🔗 ${result.url}`;
    document.getElementById('url-title').textContent = result.title || result.domain;
    document.getElementById('url-description').textContent = result.description || '';
    if (result.imageUrl) {
      const img = document.getElementById('url-og-img');
      img.src = result.imageUrl; img.classList.remove('hidden');
    }

    // Domain-Signale
    const domainGrid = document.getElementById('url-domain-signals');
    const tipEl = domainGrid.querySelector('p');
    domainGrid.innerHTML = '';
    const da = result.domainAssessment;
    for (const sig of (da?.signals || [])) {
      const el = document.createElement('div');
      el.className = `flag-card flag-${sig.level}`;
      el.innerHTML = `<div class="flag-header"><span>${_flagIcon(sig.level)}</span><span>${sig.title}</span></div><p class="flag-detail">${sig.detail}</p>`;
      domainGrid.appendChild(el);
    }
    if (!da?.signals?.length) {
      const el = document.createElement('div');
      el.className = 'flag-card flag-safe';
      el.innerHTML = `<div class="flag-header"><span>✅</span><span>Domain unauffällig</span></div><p class="flag-detail">„${result.domain}" ist nicht als problematische Quelle bekannt.</p>`;
      domainGrid.appendChild(el);
    }
    if (tipEl) domainGrid.appendChild(tipEl);
    const domLvl = (da?.suspicion || 0) >= 40 ? 'danger' : (da?.suspicion || 0) >= 15 ? 'warning' : 'safe';
    _setDot(['url-dot-domain'], domLvl);
    _setBadge('url-badge-domain', domLvl, domLvl === 'safe' ? 'Unauffällig' : domLvl === 'danger' ? 'Auffällig' : 'Prüfen');

    // Textanalyse
    const ta = result.textAnalysis;
    const textGrid = document.getElementById('url-text-signals');
    textGrid.innerHTML = '';
    document.getElementById('url-extracted-text').textContent = result.text?.slice(0, 2000) || '(kein Text)';
    if (ta?.valid && ta.signals?.length) {
      for (const sig of ta.signals) {
        const el = document.createElement('div');
        el.className = `flag-card flag-${sig.level}`;
        el.innerHTML = `<div class="flag-header"><span>${_flagIcon(sig.level)}</span><span>${sig.title}</span></div><p class="flag-detail">${sig.detail}</p>`;
        textGrid.appendChild(el);
      }
    } else {
      textGrid.innerHTML = '<p class="text-slate-600 text-sm">Zu wenig Text für eine Analyse extrahiert.</p>';
    }
    const textLvl = ta?.level || 'info';
    _setDot(['url-dot-text'], textLvl);
    _setBadge('url-badge-text', textLvl, ta?.verdict || 'Kein Text');
    if (ta?.valid) document.getElementById('url-acc-text').open = true;

    // Hero
    const totalSuspicion = (da?.suspicion || 0) + (ta?.valid ? (100 - (ta.score || 50)) : 0);
    const heroLevel = totalSuspicion >= 60 ? 'danger' : totalSuspicion >= 25 ? 'warning' : 'safe';
    const heroLabels = { safe: '✅ Keine schwerwiegenden Auffälligkeiten', warning: '⚠️ Einige Auffälligkeiten', danger: '🚨 Deutliche Warnsignale' };
    const heroSummary = { safe: 'Domain und Text zeigen keine klaren Merkmale von Falschinformationen.', warning: 'Es gibt Hinweise auf problematische Muster – Quelle und Inhalt sorgfältig prüfen.', danger: 'Mehrere Warnsignale erkannt. Dieser Inhalt weist deutliche Merkmale von Desinformation auf.' };
    document.getElementById('url-result-hero').className = `glass p-6 border-2 verdict-hero-${heroLevel}`;
    const vEl = document.getElementById('url-hero-verdict');
    vEl.className = `badge badge-${heroLevel}`;
    vEl.textContent = heroLabels[heroLevel];
    document.getElementById('url-hero-summary').textContent = heroSummary[heroLevel];

    document.getElementById('url-check-another-btn').addEventListener('click', () => {
      document.getElementById('url-result-state').classList.add('hidden');
      document.getElementById('welcome-state').classList.remove('hidden');
      switchTab('url');
      document.getElementById('url-input').value = '';
    }, { once: true });
    document.getElementById('url-result-state').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { init, switchTab, submitUrl };
})();

document.addEventListener('DOMContentLoaded', () => EchtCheckUI.init());