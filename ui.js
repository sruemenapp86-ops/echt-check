const EchtCheckUI = (() => {
  let currentObjectUrl = null;
  let phaseScores = { p1: null, p2: null, p3: null, p4: null, p5: null, p6: null };
  let _analysisComplete = false;
  let _p4IsReal = false;
  let _ocrText = null;
  let _statusInterval = null;
  let _reportFile = null;
  let _currentAnalyzedFile = null;

  // ─── Gamification & Viralität ──────────────────────────────────────────────
  const DUMMY_TICKERS = [
    "Vor 2 Min: KI-Fake 'Politiker am Strand' durch Community #499 verbrannt.",
    "🚨 Live: 14 neue Phashes zur Datenbank Echt-Check hinzugefügt.",
    "Vor 12 Min: Screenshot 'Streikaufruf' als Text-Hetze entlarvt.",
    "Nutzer aus Berlin verifiziert dubioses Gewinnspiel: 99% Fake.",
    "Vor 18 Min: Audio-Deepfake Profil in WhatsApp-Gruppe blockiert.",
    "🎯 Echt-Check Meilenstein: 12.000 Falschmeldungen im Index."
  ];

  function initTicker() {
    const tickerEl = document.getElementById('live-ticker-text');
    if (!tickerEl) return;
    let idx = 0;
    setInterval(() => {
      tickerEl.style.opacity = 0;
      setTimeout(() => {
        idx = (idx + 1) % DUMMY_TICKERS.length;
        tickerEl.textContent = DUMMY_TICKERS[idx];
        tickerEl.style.opacity = 1;
      }, 500);
    }, 6000);
  }

  async function generateBustedProof() {
    if (!_currentAnalyzedFile) return;
    const btn = document.getElementById('share-busted-btn');
    if (!btn) return;
    
    const origHtml = btn.innerHTML;
    btn.innerHTML = '⚙️ Generiere Beweis...';
    btn.disabled = true;

    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = URL.createObjectURL(_currentAnalyzedFile);
      });

      // Max width to keep share size reasonable
      const MAX_W = 1080;
      let w = img.width;
      let h = img.height;
      if (w > MAX_W) {
        h = Math.floor(h * (MAX_W / w));
        w = MAX_W;
      }
      
      canvas.width = w;
      canvas.height = h;

      // Draw photo
      ctx.drawImage(img, 0, 0, w, h);
      
      // Dark overlay
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.fillRect(0, 0, w, h);
      
      // Stamp logic
      ctx.save();
      ctx.translate(w/2, h/2);
      ctx.rotate(-15 * Math.PI / 180);
      
      const fontSize = Math.floor(w * 0.08);
      ctx.font = '900 ' + fontSize + 'px sans-serif';
      ctx.fillStyle = '#ef4444'; // red-500
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      const padding = w * 0.04;
      const textMetrics = ctx.measureText('❌ KI-FAKE ENTLARVT');
      const boxW = textMetrics.width + padding * 2;
      const boxH = fontSize + padding * 2;
      
      ctx.lineWidth = Math.max(5, Math.floor(w * 0.015));
      ctx.strokeStyle = '#ef4444';
      ctx.strokeRect(-boxW/2, -boxH/2, boxW, boxH);
      ctx.fillText('❌ KI-FAKE ENTLARVT', 0, 0);
      ctx.restore();
      
      // Bottom Branding Bar
      const barHeight = Math.floor(h * 0.12);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, h - barHeight, w, barHeight);
      
      ctx.fillStyle = '#22d3ee';
      ctx.font = 'bold ' + Math.floor(barHeight * 0.35) + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('Echt-Check Forensik', w * 0.05, h - barHeight/2);
      
      ctx.fillStyle = '#94a3b8';
      ctx.font = Math.floor(barHeight * 0.25) + 'px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('geprüft auf echt-check.de', w * 0.95, h - barHeight/2);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      
      // Try OS Share (Mobile API)
      if (navigator.share) {
         try {
           const blob = await (await fetch(dataUrl)).blob();
           const file = new File([blob], 'echt-check-beweis.jpg', { type: 'image/jpeg' });
           await navigator.share({
             title: 'Echt-Check Entlarvung',
             text: 'Ich habe diese Meldung auf echt-check.de durchleuchtet. Es ist ein glasklarer Fake! 🚨',
             files: [file]
           });
           btn.innerHTML = origHtml;
           btn.disabled = false;
           return;
         } catch(e) {
           console.log("Share API abgebrochen", e);
         }
      }
      
      // Fallback: Download
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'Echt-Check-Entlarvt.jpg';
      a.click();
      
    } catch(err) {
      console.error(err);
      alert('Beweismittel konnte nicht generiert werden.');
    }
    
    btn.innerHTML = origHtml;
    btn.disabled = false;
  }

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
    _setupReportDropZone();
    _setupPaste();
    _setupParticles();
    initTicker();
    document.getElementById('retry-btn').addEventListener('click', _reset);
  }

  // ─── Status Text Helper ────────────────────────────────────────────────────
  function _setHeroStatus(text) {
    const el = document.getElementById('hero-analyzing-subtitle');
    if (el) el.textContent = '> ' + text;
  }

  // ─── Input-Handler ─────────────────────────────────────────────────────────
  function _setupReportDropZone() {
    const zone = document.getElementById('report-drop-zone');
    const input = document.getElementById('report-file-input');
    if (!zone || !input) return;

    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('border-rose-400'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('border-rose-400'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('border-rose-400');
      const f = e.dataTransfer.files[0];
      if (f) _handleReportFile(f);
    });
    input.addEventListener('change', e => { const f = e.target.files[0]; if(f) _handleReportFile(f); input.value=''; });
  }

  function _handleReportFile(file) {
    if (!file.type.startsWith('image/')) return alert('Bitte nur Bilder hochladen.');
    if (file.size > 20 * 1024 * 1024) return alert('Bild ist zu groß (max 20MB).');
    
    _reportFile = file;
    const url = URL.createObjectURL(file);
    document.getElementById('report-preview-img').src = url;
    document.getElementById('report-preview-name').textContent = file.name;
    
    document.getElementById('report-drop-zone').classList.add('hidden');
    document.getElementById('report-preview-container').classList.remove('hidden');
    document.getElementById('report-form-body').classList.remove('opacity-50', 'pointer-events-none');
  }

  function clearReportImage() {
    _reportFile = null;
    document.getElementById('report-drop-zone').classList.remove('hidden');
    document.getElementById('report-preview-container').classList.add('hidden');
    document.getElementById('report-form-body').classList.add('opacity-50', 'pointer-events-none');
    document.getElementById('report-proof-input').value = '';
    document.getElementById('report-comment-input').value = '';
  }

  async function submitReport() {
    if (!_reportFile) return;
    const btn = document.getElementById('report-submit-btn');
    const origText = btn.innerHTML;
    btn.innerHTML = '<div class="spinner w-5 h-5 flex-shrink-0 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Übertrage in Datenbank...';
    btn.disabled = true;

    const proofUrl = document.getElementById('report-proof-input').value.trim();
    const comment = document.getElementById('report-comment-input').value.trim();

    const res = await EchtCheckAPI.reportFake(_reportFile, proofUrl, comment);
    
    if (res && res.success) {
      alert("✅ Der FAKE wurde erfolgreich in der Echt-Check Datenbank hinterlegt!\nDas System wird bei diesem Bild in Zukunft sofort Alarm schlagen.");
      clearReportImage();
      switchTab('image');
    } else {
      alert("❌ Fehler bei der Übertragung an die Datenbank. Server erreichbar?");
    }
    
    btn.innerHTML = origText;
    btn.disabled = false;
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
          if (file) { 
            // Check active tab to route paste to analysis or report
            if (!document.getElementById('tab-panel-report').classList.contains('hidden')) {
              _handleReportFile(file);
            } else {
              _handleFile(file); 
            }
            break; 
          } 
        }
      }
    });
  }

  // ─── Analyse-Flow ──────────────────────────────────────────────────────────
  async function _handleFile(file) {
    _currentAnalyzedFile = file;
    phaseScores = { p1: null, p2: null, p3: null, p4: null, p5: null, p6: null };
    _analysisComplete = false;
    _p4IsReal = false;
    _showLoading(file);
    _setHeroStatus('Initialisiere Analyse...');

    try {
      // Phase 1 (synchron, schnell)
      const result = await EchtCheckEngine.analyzeFile(file);
      _showInitialResult(result, file);
      phaseScores.p1 = result.score;
      _setDot(['dot-p1'], result.verdict.level);
      _setBadge('p1-badge', result.verdict.level, result.verdict.label);

      // Phase 2
      _setHeroStatus('Prüfe Bildrauschen und ELA...');
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

      // Phase 3
      _setHeroStatus('Analysiere KI-Frequenzmuster...');
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

      // Phase 5: OCR Textanalyse
      _setHeroStatus('Führe optische Zeichenerkennung (OCR) aus...');
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
        _ocrText = ocr.valid ? ocr.text : null;
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

      // Phase 4 (Backend KI)
      _setHeroStatus('Server scannt auf generative KI-Schattenstrukturen...');
      _setDot(['dot-p4'], 'loading');
      try {
        const r = await EchtCheckAPI.analyzeImage(file);
        if (r) {
          _showPhase4Results(r);
          phaseScores.p4 = r.score ?? 50;
          _p4IsReal = (r.method && r.method !== 'statistical_fallback');
          const lvl = (r.score ?? 50) >= 65 ? 'safe' : (r.score ?? 50) >= 40 ? 'warning' : 'danger';
          _setDot(['dot-p4'], lvl);

          // ─── NEU: Kurzschluss bei Community-Schild! ───
          if (r.method === 'community_shield') {
             _setHeroStatus('🚨 ECHT-CHECK ABGEBROCHEN: BILD IST ALS FAKE GEMELDET!');
             _setDot(['dot-p1','dot-p2','dot-p3','dot-p5','dot-p6b'], 'danger');
             for (const id of ['p1-badge','p2-badge','p3-badge','p5-badge']) _setBadge(id, 'danger', 'Übersprungen');
             _setBadge('p6-badge', 'danger', 'Gesperrt');
             // Alle verbleibenden Scores massiv runtersetzen, um 100% Fake Hero zu garantieren
             phaseScores.p1 = 15; phaseScores.p2 = 15; phaseScores.p3 = 15; phaseScores.p5 = 15; phaseScores.p6 = 15;
             _finalizeHero(phaseScores, r);
             return;
          }
        } else {
          document.getElementById('phase4-offline').classList.remove('hidden');
          _setDot(['dot-p4'], 'warning');
        }
      } catch(e) {
        document.getElementById('phase4-offline').classList.remove('hidden');
        _setDot(['dot-p4'], 'warning');
      }

      // Phase 6: LLM-Tiefenanalyse
      _setDot(['dot-p6b'], 'loading');
      _setBadge('p6-badge', 'info', 'läuft…');
      let imgData = null, txtData = null;
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
          const aiSteps = [
             "Deep-Learning Forensik rechnet auf lokaler GPU...",
             "Suche nach harten Kanten und Fotomontagen...",
             "Überprüfe Schattenfall und Beleuchtung auf Unstimmigkeiten...",
             "Vergleiche Bildsemantik mit bekannten Fake-Mustern...",
             "Analysiere erkannte Texte auf Desinformation und Hetze...",
             "Lokale LLMs konsolidieren die Metadaten..."
          ];
          let aiStepIdx = 0;
          _setHeroStatus(aiSteps[0]);
          let isQueueing = false;
          _statusInterval = setInterval(() => {
             if (isQueueing) return; // Wenn Queue-Polling übernimmt, Hype-Slogans pausieren
             aiStepIdx = (aiStepIdx + 1) % aiSteps.length;
             _setHeroStatus(aiSteps[aiStepIdx]);
          }, 4500);

          const _queueUpdate = (type) => (pos, est) => {
             isQueueing = true;
             if (pos > 0) {
                _setHeroStatus(`Warteschlange (${type}): Position ${pos} (~${est}s rest)`);
                _setBadge('p6-badge', 'loading', `Pos ${pos}...`);
             } else {
                isQueueing = false;
                _setHeroStatus(`GPU übernimmt ${type}-Analyse...`);
                _setBadge('p6-badge', 'loading', 'Rechnet...');
             }
          };

          // LLM-Analysen (Mit Übergabe des Vor-Scores von Phase 4 und des OCR-Textes!)
          const [imgRes, txtRes] = await Promise.allSettled([
            llmStatus.visionReady ? EchtCheckAPI.analyzeLLMImage(file, _queueUpdate('Bild-KI'), phaseScores.p4, _ocrText) : Promise.resolve(null),
            (llmStatus.textReady && _ocrText && _ocrText.length >= 20)
              ? EchtCheckAPI.analyzeLLMText(_ocrText, _queueUpdate('Text-KI'))
              : Promise.resolve(null)
          ]);

          imgData = imgRes.status === 'fulfilled' ? imgRes.value : null;
          txtData = txtRes.status === 'fulfilled' ? txtRes.value : null;

          _showPhase6Results(imgData, txtData);

          let p6scores = [];
          if (imgData) {
            // Wenn Vision-KI EXPLIZIT nicht manipuliert sagt → 75 (sicher grün)
            // Wenn sie manipuliert sagt → nehme Confidence als Gefährlichkeit
            const imgScore = imgData.manipulated
              ? Math.min(imgData.confidence ?? 60, 35)   // manipuliert → Danger
              : Math.max(75, 100 - (imgData.confidence ?? 20)); // echt → safe Bereich
            p6scores.push(imgScore);
          }
          if (txtData) {
            // Wenn Text-KI EXPLIZIT not suspicious sagt → 75 (sicher grün)
            // Score-Feld ist ambigious im LLM, daher: primär auf suspicious-Flag verlassen
            const txtScore = txtData.suspicious
              ? Math.min(40, 100 - (txtData.score ?? 50))  // verdächtig → niedrig
              : Math.max(75, 100 - (txtData.score ?? 10)); // unauffällig → hoch
            p6scores.push(txtScore);
          }
          if (p6scores.length) {
            phaseScores.p6 = Math.min(...p6scores);
          }

          const p6lvl = (phaseScores.p6 ?? 50) >= 65 ? 'safe'
                      : (phaseScores.p6 ?? 50) >= 40 ? 'warning' : 'danger';
          
          const p4lvl = (phaseScores.p4 ?? 50) >= 65 ? 'safe' : (phaseScores.p4 ?? 50) >= 40 ? 'warning' : 'danger';
          const masterLvl = (p6lvl === 'danger' || p4lvl === 'danger') ? 'danger'
                          : (p6lvl === 'warning' || p4lvl === 'warning') ? 'warning' : 'safe';

          _setDot(['dot-p6b', 'dot-p4'], masterLvl);
          _setBadge('p6-badge', masterLvl,
            masterLvl === 'safe' ? 'Keine Auffälligkeiten'
            : masterLvl === 'danger' ? 'Probleme erkannt' : 'Leichte Auffälligkeiten');
        }
      } catch(e) {
        console.warn('Phase6 LLM:', e.message);
        _setDot(['dot-p6b'], 'info');
        _setBadge('p6-badge', 'info', 'Fehler');
      }

      if (_statusInterval) clearInterval(_statusInterval);
      _finalizeHero(imgData, txtData);

    } catch(err) { 
      if (_statusInterval) clearInterval(_statusInterval);
      _showError(err.message); 
    }
  }

  function _finalizeHero(imgData, txtData) {
    _analysisComplete = true;
    const scores = Object.values(phaseScores).filter(v => v !== null);
    if (!scores.length) return;

    let weighted = [...scores];
    let avg = Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length);
    if (isNaN(avg)) return;

    // Veto-Logik: Nur wenn die LLM-KI EXPLIZIT manipuliert/verdächtig meldet UND Score niedrig ist.
    // OCR-Heuristiken (Großbuchstaben zählen etc) dürfen das Verdict NICHT alleine überschreiben.
    const llmExplicitlyFlagged = (imgData && imgData.manipulated === true) || (txtData && txtData.suspicious === true);
    const p6Critical = (phaseScores.p6 ?? 100) <= 40;
    let vetoTriggered = false;
    if (llmExplicitlyFlagged && p6Critical) {
      avg = Math.min(avg, 39);
      vetoTriggered = true;
    }
    // Wenn LLM klar "kein Problem" sagt, minimum auf warning setzen (nie Danger nur durch Pixel-Scanner)
    if (!llmExplicitlyFlagged && (imgData || txtData)) {
      avg = Math.max(avg, 45); // mindestens "warning"-Zone, nicht danger
    }

    const level = avg >= 65 ? 'safe' : avg >= 40 ? 'warning' : 'danger';
    let vt = VERDICT_TEXT[level];
    
    // ─── NEU: Wir ignorieren die Zahlen und generischen Texte. 
    // Der Experte (GPT-4o) spricht Klartext!
    let expertExplanation = "";
    if (imgData && imgData.explanation) {
      expertExplanation += `📸 Bild-Analyse: ${imgData.explanation} `;
    }
    if (txtData && txtData.summary) {
      expertExplanation += `<br>💬 Text-Befund: ${txtData.summary}`;
    }

    // Fallback falls KI offline war
    if (!expertExplanation) {
      expertExplanation = SUMMARY_TEXT[level];
    }

    if (vetoTriggered) {
      vt = { ...vt, label: 'Manipulation / Desinformation erkannt' };
      if (!imgData && !txtData) expertExplanation = 'Die KI-Tiefenanalyse und Forensik hat sehr starke Hinweise auf Bildbearbeitung oder problematische Inhalte gefunden.';
    }

    const hero = document.getElementById('result-hero');
    hero.className = `glass p-5 border-2 verdict-hero-${level}`;

    document.getElementById('hero-analyzing-banner').classList.add('hidden');
    const block = document.getElementById('hero-result-block');
    block.classList.remove('hidden');

    const imgResult = document.getElementById('image-preview-result');
    const imgOrig   = document.getElementById('image-preview');
    imgResult.src = imgOrig.src;
    imgResult.alt = imgOrig.alt;

    // Nur noch Klartext anzeigen (Zahlen & Balken sind gelöscht)
    document.getElementById('hero-verdict').textContent = vt.label;
    
    // Wir setzen das innerHTML, damit der <br> Tag beim Kombinieren greift
    const summaryEl = document.getElementById('hero-summary');
    summaryEl.innerHTML = expertExplanation;
    
    // Je nach Level passen wir die Rahmenfarbe der Erklärung an
    summaryEl.className = `text-sm md:text-base leading-relaxed border-l-4 pl-4 py-1 ` + 
      (level === 'danger' ? 'border-red-500 text-red-100' : level === 'warning' ? 'border-amber-500 text-amber-100' : 'border-emerald-500 text-emerald-100');

    [['dot-p1','dot-p1b'],['dot-p2','dot-p2b'],['dot-p3','dot-p3b'],
     ['dot-p4','dot-p4b'],['dot-p5','dot-p5b']].forEach(([src, dst]) => {
      const s = document.getElementById(src);
      const d = document.getElementById(dst);
      if (s && d) d.className = s.className;
    });

    const shareBtn = document.getElementById('share-busted-btn');
    if (shareBtn) {
      if (avg <= 55) shareBtn.classList.remove('hidden');
      else shareBtn.classList.add('hidden');
    }

    setTimeout(() => hero.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

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
        if (typeof phaseScores.p4 === 'number' && phaseScores.p4 <= 55) {
           flagsEl.innerHTML = `<div class="glass p-2 rounded-lg border border-amber-700/30 text-xs text-amber-400">⚠️ LLM findet keine sichtbaren Fotomontagen, aber Pixel-KI meldet Anomalien!</div>`;
        } else {
           flagsEl.innerHTML = `<div class="glass p-2 rounded-lg border border-emerald-700/30 text-xs text-emerald-400">✅ Keine Manipulationsmerkmale erkannt</div>`;
        }
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

    // ─── NEU: Faktencheck-Links & News-Radar IMMER rendern (unabhängig von Text) ───
    const allFactchecks = [];
    if (txtData && txtData.factchecks) allFactchecks.push(...txtData.factchecks);
    if (imgData && imgData.factchecks) allFactchecks.push(...imgData.factchecks);
    
    if (allFactchecks.length > 0) {
      document.getElementById('llm-factcheck-result').classList.remove('hidden');
      // Box-Titel anpassen je nach Inhalt
      const hasVerify = allFactchecks.some(fc => fc.type === 'verify');
      const hasDebunk = allFactchecks.some(fc => fc.type === 'debunk');
      const titleEl = document.querySelector('#llm-factcheck-result > p');
      if (titleEl) {
        if (hasVerify && !hasDebunk) titleEl.textContent = '🔗 QUELLEN-VERIFIKATION (Bestätigende Presseartikel)';
        else if (hasDebunk && !hasVerify) titleEl.textContent = '🚨 FAKTENCHECK-QUELLEN (Entlarvende Artikel)';
        else titleEl.textContent = '🌐 WEB-RECHERCHE (Quellen & Faktencheck)';
      }
      const fcEl = document.getElementById('llm-factcheck-links');
      fcEl.innerHTML = '';
      allFactchecks.forEach(fc => {
        const isVerify = fc.type === 'verify';
        const borderCls = isVerify ? 'border-emerald-500/30 hover:border-emerald-400' : 'border-rose-500/30 hover:border-rose-400';
        const titleCls  = isVerify ? 'text-emerald-300 group-hover:text-emerald-200' : 'text-rose-300 group-hover:text-rose-200';
        const snippetCls = isVerify ? 'text-emerald-200/70' : 'text-rose-200/70';
        const urlCls    = isVerify ? 'text-emerald-600' : 'text-rose-500';
        const label     = isVerify ? '✅ Bestätigende Quelle' : '🚨 Faktencheck';
        fcEl.innerHTML += `<a href="${fc.url}" target="_blank" class="block group glass p-3 rounded-xl border ${borderCls} transition-all hover:-translate-y-0.5 shadow-lg">
          <div class="text-[0.6rem] font-bold uppercase tracking-widest mb-1 ${urlCls}">${label}</div>
          <h4 class="text-sm font-bold ${titleCls} mb-1 leading-snug">${fc.title}</h4>
          <p class="text-xs ${snippetCls} line-clamp-2">${fc.snippet}</p>
          <div class="text-[0.65rem] ${urlCls} mt-2 font-mono break-all opacity-70">${fc.url}</div>
        </a>`;
      });
    }

    // News-Radar nur intern (KI-Hintergrundwissen), wird dem User NICHT gezeigt.
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

  function _showInitialResult(result, file) {
    document.getElementById('loading-state').classList.add('hidden');
    document.getElementById('result-state').classList.remove('hidden');

    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(file);
    const prev = document.getElementById('image-preview');
    prev.src = currentObjectUrl;
    prev.alt = result.fileName;

    document.getElementById('meta-info').textContent = `${result.fileName} · ${_fmtBytes(result.fileSize)} · ${result.fileType}`;

    document.getElementById('hero-analyzing-banner').classList.remove('hidden');
    document.getElementById('hero-result-block').classList.add('hidden');
    document.getElementById('result-hero').className = 'glass p-5 verdict-hero-info border-2';

    _renderExifMatrix(result);
    _renderFlags(result.flags);

    document.getElementById('check-another-btn').addEventListener('click', _reset, { once: true });
  }

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
    const fakeScore = 100 - score;
    const level = score >= 65 ? 'safe' : score >= 40 ? 'warning' : 'danger';
    const fill = document.getElementById('phase4-score-fill');
    fill.className = `score-fill score-${level}`;
    fill.style.width = '0%';
    setTimeout(() => { fill.style.width = fakeScore + '%'; }, 100);
    document.getElementById('phase4-score-text').textContent = `KI-Wahrscheinlichkeit: ${fakeScore}%`;
    const methodLabel = r.method === 'onnx_model'
      ? '🤖 SwinV2-Modell auf GPU (lokal, keine Datenweitergabe)'
      : r.method === 'community_shield'
      ? '🚨 COMMUNITY SCHILD (Direkter Datenbank-Treffer)'
      : '📊 Statistisches Fallback-Modell';
    document.getElementById('phase4-method').textContent = methodLabel;
    document.getElementById('phase4-result').classList.remove('hidden');
  }

  function _setDot(ids, level) {
    const cls = {
      safe: 'phase-dot-safe', warning: 'phase-dot-warning',
      danger: 'phase-dot-danger', loading: 'phase-dot-loading', info: 'phase-dot-loading'
    };
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) {
        const base = 'phase-dot';
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

  function _reset() {
    if (_statusInterval) clearInterval(_statusInterval);
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
    document.getElementById('hero-analyzing-banner').classList.remove('hidden');
    document.getElementById('hero-result-block').classList.add('hidden');
    document.getElementById('result-hero').className = 'glass p-5 verdict-hero-info border-2';
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
    for (const id of ['llm-offline','llm-model-missing','llm-image-result','llm-text-result','llm-no-text','llm-factcheck-result','llm-news-radar']) {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    }
    const hs = document.getElementById('hero-score');
    if (hs) hs.textContent = '–';
    document.getElementById('hero-verdict').textContent = 'Wird analysiert…';
    const hsf = document.getElementById('hero-score-fill');
    if (hsf) hsf.style.width = '0%';
    document.getElementById('welcome-state').classList.remove('hidden');
    if (currentObjectUrl) { URL.revokeObjectURL(currentObjectUrl); currentObjectUrl = null; }
    phaseScores = { p1: null, p2: null, p3: null, p4: null, p5: null, p6: null };
    _analysisComplete = false;
    _p4IsReal = false;
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
    const P = Array.from({length:40}, () => ({ x:Math.random()*canvas.width, y:Math.random()*canvas.height, r:Math.random()*1.2+0.3, dx:(Math.random()-.5)*.25, dy:(Math.random()-.5)*.25, a:Math.random()*.4+.08 }));
    (function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      for(const p of P) { ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fillStyle=`rgba(0,200,255,${p.a})`; ctx.fill(); p.x+=p.dx; p.y+=p.dy; if(p.x<0||p.x>canvas.width)p.dx*=-1; if(p.y<0||p.y>canvas.height)p.dy*=-1; }
      requestAnimationFrame(draw);
    })();
  }

  function switchTab(tab) {
    document.getElementById('tab-panel-image').classList.toggle('hidden', tab !== 'image');
    document.getElementById('tab-panel-url').classList.toggle('hidden', tab !== 'url');
    document.getElementById('tab-panel-report').classList.toggle('hidden', tab !== 'report');
    
    document.getElementById('tab-image').className = `px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${tab === 'image' ? 'bg-cyan-500 text-slate-900' : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'}`;
    document.getElementById('tab-url').className = `px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${tab === 'url' ? 'bg-violet-500 text-white' : 'bg-white/5 border border-white/10 text-slate-400 hover:text-white hover:bg-white/10'}`;
    document.getElementById('tab-report').className = `px-5 py-2.5 rounded-xl font-semibold text-sm transition-all ${tab === 'report' ? 'bg-rose-500 text-white' : 'bg-white/5 border border-rose-500/30 text-rose-400 hover:text-white hover:bg-rose-500/20'}`;
  }

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

  return { init, switchTab, submitUrl, submitReport, clearReportImage, generateBustedProof };
})();

document.addEventListener('DOMContentLoaded', () => EchtCheckUI.init());