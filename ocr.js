/**
 * Echt-Check OCR & Textanalyse
 * Erkennt Text in Bildern (Screenshots, Social-Media-Posts etc.)
 * und analysiert sprachliche Fake-News-Muster.
 */
const EchtCheckOCR = (() => {

  // ─── Sensations- & Manipulationsmuster ────────────────────────────────────
  const URGENCY_WORDS = [
    'eilmeldung','breaking','sofort','jetzt','dringend','warnung','achtung','alarm',
    'gefahr','notfall','krise','katastrophe','unbedingt','weitersagen','teilen',
    'wichtig','bitte teilen','share','repost','viral','aufdeckung','enthüllung',
    'schock','skandal','unglaublich','krass','unfassbar','niemand weiß',
    'sie wollen nicht','mainstream','unterdrückt','zensiert','verboten','geheimnis'
  ];

  const RUMOR_PATTERNS = [
    /gerüchten\s+zufolge/i, /es\s+heißt/i, /man\s+sagt/i, /angeblich/i,
    /soll\s+angeblich/i, /wie\s+ich\s+gehört\s+habe/i, /meine\s+quelle/i,
    /ein\s+freund\s+(von\s+mir\s+)?hat/i, /unbestätigten\s+berichten/i,
    /laut\s+insidern/i, /vertrauliche\s+information/i
  ];

  const SOURCE_ABSENCE_PATTERNS = [
    /\?\!\!+/, /!{3,}/, /\?{3,}/, /!!+\s*!+/
  ];

  // ─── Hass- & Hetze-Erkennung ──────────────────────────────────────────────
  // Scapegoating: Pauschalvorwürfe gegen Gruppen
  const SCAPEGOAT_PATTERNS = [
    { p: /\b(alle|die)\s+(muslime|muslims|ausländer|flüchtlinge|migranten|juden|schwarzen|homosexuellen|frauen|männer)\s+(sind|haben|wollen|machen|bringen|kommen)/i, label: 'Pauschalvorwurf gegen Personengruppe' },
    { p: /\b(die|der)\s+(islam|islam\s+ist|muslime\s+sind)\b/i, label: 'Pauschalverurteilung einer Religion' },
    { p: /schuld\s+(der|die|an\s+allem)\s+(ausländer|migranten|juden|flüchtlinge|linken|rechten)/i, label: 'Schuldvorwurf gegen Gruppe' },
    { p: /\b(diese\s+)?(kriminellen|parasiten|verbrecher)\s+(kommen|sind|werden)\s+(aus|von)/i, label: 'Kriminalisierung einer Gruppe' },
    { p: /das\s+(volk|land|deutschland|europa)\s+(wird\s+)?(überflutet|islamisiert|verseucht|zerstört|ausgetauscht)/i, label: 'Verschwörungsnarrative gegen Bevölkerungsgruppen' },
    { p: /\b(bevölkerungsaustausch|umvolkung|islamisierung|überfremdung|dschihad\s+in\s+deutschland)/i, label: 'Verschwörungsbegriff / Rechtsextremer Terminus' },
    { p: /\b(lügenpresse|gleichschaltung|volksverpetzer|antideutsch|umvolker)\b/i, label: 'Szenespezifischer Hetzvokabular' },
  ];

  // Entmenschlichung (Dehumanisierung)
  const DEHUMANIZE_PATTERNS = [
    { p: /\b(gelichter|gesindel|mob|abschaum|pack|ungeziefer|schädlinge|parasiten|ratten|kakerlaken)\b/i, label: 'Entmenschlichende Sprache' },
    { p: /\b(untermenschen|unnütze\s+esser|sozialschmarotzer|systemschmarotzer)\b/i, label: 'Dehumanisierender Begriff' },
    { p: /\b(ausrotten|vernichten|deportieren|abschieben(\s+alle)?|vergasen)\b/i, label: 'Aufruf zu Gewalt oder Deportation' },
  ];

  // Direkte Hetze & Gewaltaufrufe
  const INCITEMENT_PATTERNS = [
    { p: /\b(tötet?|erschießt?|hängt|lyncht|verbrennt)\s+(die|diese|alle)\s+\w+/i, label: 'Direkter Gewaltaufruf' },
    { p: /\b(deutschland\s+(den\s+)?deutschen|ausländer\s+raus|remigration\s+jetzt)/i, label: 'Hetzslokan / Ausgrenzungsparole' },
    { p: /\b(kein\s+platz\s+für\s+(muslime|juden|ausländer|linke|schwule))/i, label: 'Ausgrenzung von Personengruppen' },
    { p: /\bheil\s+hitler|sieg\s+heil|88\s+88|\bns\b.{0,5}regime/i, label: 'Nationalsozialistische Symbolik / Bezug' },
    { p: /\b(widerstand|gegenwehr|auf\s+die\s+straße|kämpft)\s+(gegen\s+)?(die\s+)?(islam|juden|ausländer|linken|system|regierung)/i, label: 'Aufruf zu Widerstand / Mobilisierung' },
  ];

  // Diskriminierende Hetze (ohne Wiedergabe der Begriffe selbst)
  const SLUR_HINTS = [
    { p: /\bn-wort|\bn\*+r\b/i, label: 'Hinweis auf rassistische Beleidigung' },
    { p: /\bz-wort\b|\bz\*+\b/i, label: 'Hinweis auf antiziganistischen Begriff' },
    { p: /\bk\*+l\b|\bk\.\.\.l\b/i, label: 'Hinweis auf antisemitische Beleidigung' },
  ];

  // ─── OCR via Tesseract.js ─────────────────────────────────────────────────
  async function extractText(file, onProgress) {
    if (typeof Tesseract === 'undefined') {
      throw new Error('Tesseract.js nicht geladen');
    }

    const result = await Tesseract.recognize(file, 'deu+eng', {
      logger: m => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      }
    });

    return {
      text: result.data.text.trim(),
      confidence: Math.round(result.data.confidence),
      words: result.data.words?.length ?? 0,
      lines: result.data.lines?.length ?? 0,
    };
  }

  // ─── Linguistische Analyse ────────────────────────────────────────────────
  function analyzeText(text) {
    if (!text || text.length < 20) {
      return { valid: false, reason: 'Zu wenig Text erkannt (< 20 Zeichen).' };
    }

    const signals = [];
    let suspicionScore = 0;

    // 1. Großbuchstaben-Anteil
    const letters = text.replace(/[^a-zA-ZäöüÄÖÜ]/g, '');
    const capsRatio = letters.length > 0
      ? (text.match(/[A-ZÄÖÜ]/g) || []).length / letters.length
      : 0;
    if (capsRatio > 0.4) {
      signals.push({
        level: 'danger',
        title: 'Extremer Großbuchstaben-Anteil',
        detail: `${Math.round(capsRatio * 100)}% des Textes in Großbuchstaben – typisch für emotionale Manipulation oder Kettenpost.`,
        suspicion: 75
      });
      suspicionScore += 25;
    } else if (capsRatio > 0.25) {
      signals.push({
        level: 'warning',
        title: 'Erhöhter Großbuchstaben-Anteil',
        detail: `${Math.round(capsRatio * 100)}% Großbuchstaben – deutlich über dem Normalwert.`,
        suspicion: 45
      });
      suspicionScore += 12;
    }

    // 2. Ausrufezeichen-Ketten
    const exclChains = (text.match(/!{2,}|\?!+|!\?+/g) || []).length;
    if (exclChains >= 3) {
      signals.push({
        level: 'danger',
        title: 'Übermäßige Ausrufezeichen',
        detail: `${exclChains}× Ausrufezeichen-Ketten gefunden (!!! oder ?!). Seriöse Medien verwenden diese nicht.`,
        suspicion: 70
      });
      suspicionScore += 20;
    } else if (exclChains >= 1) {
      signals.push({
        level: 'warning',
        title: 'Ausrufezeichen-Ketten',
        detail: `${exclChains}× gefunden – leichtes Warnsignal.`,
        suspicion: 35
      });
      suspicionScore += 8;
    }

    // 3. Dringlichkeits- / Manipulationswörter
    const lowerText = text.toLowerCase();
    const foundUrgency = URGENCY_WORDS.filter(w => lowerText.includes(w));
    if (foundUrgency.length >= 3) {
      signals.push({
        level: 'danger',
        title: 'Viele Manipulationswörter',
        detail: `Gefunden: „${foundUrgency.slice(0, 5).join('", „')}". Häufung von Dringlichkeits- und Angst-Triggerwörtern.`,
        suspicion: 80
      });
      suspicionScore += 30;
    } else if (foundUrgency.length >= 1) {
      signals.push({
        level: 'warning',
        title: 'Dringlichkeits-/Triggerwörter',
        detail: `Gefunden: „${foundUrgency.join('", „')}". Diese Wörter werden oft in Kettenposts verwendet.`,
        suspicion: 40
      });
      suspicionScore += 10;
    }

    // 4. Gerüchte-Muster
    const foundRumors = RUMOR_PATTERNS.filter(p => p.test(text));
    if (foundRumors.length >= 2) {
      signals.push({
        level: 'danger',
        title: 'Gerüchte-Sprache erkannt',
        detail: 'Formulierungen wie "angeblich", "man sagt" oder "Gerüchten zufolge" deuten auf unbestätigte Behauptungen hin.',
        suspicion: 65
      });
      suspicionScore += 20;
    } else if (foundRumors.length === 1) {
      signals.push({
        level: 'warning',
        title: 'Mögliche Gerüchte-Sprache',
        detail: 'Mindestens eine unbestätigte Quellenangabe gefunden.',
        suspicion: 35
      });
      suspicionScore += 10;
    }

    // 5. Quellenangaben prüfen
    const hasSource = /https?:\/\/|www\.|laut\s+\w+\.de|quelle:|source:|studie\s+von|laut\s+(der|dem|einem)\s+\w+|nach\s+angaben/i.test(text);
    if (!hasSource && text.length > 100) {
      signals.push({
        level: 'warning',
        title: 'Keine Quellenangabe',
        detail: 'Der Text enthält keine nachprüfbare Quelle oder Link. Seriöse Meldungen belegen ihre Behauptungen.',
        suspicion: 30
      });
      suspicionScore += 8;
    } else if (hasSource) {
      signals.push({
        level: 'safe',
        title: 'Quellenangabe vorhanden',
        detail: 'Der Text enthält mindestens eine Quellenreferenz – positives Signal.',
        suspicion: 0
      });
    }

    // 6. Typische Kettenpost-Phrasen
    const chainPatterns = [
      /bitte\s+(teilen|weitersagen|weiterleiten)/i,
      /alle müssen das wissen/i,
      /vergiss nicht zu teilen/i,
      /das\s+musst\s+du\s+(teilen|wissen)/i,
      /schreib mir wenn/i, /nicht zensiert/i, /bevor es gelöscht wird/i
    ];
    if (chainPatterns.filter(p => p.test(text)).length > 0) {
      signals.push({ level: 'danger', title: 'Kettenpost-Aufforderung',
        detail: 'Typische "Bitte teilen!"-Formulierung erkannt.', suspicion: 85 });
      suspicionScore += 35;
    }

    // ─── HETZE & HASS-ERKENNUNG ───────────────────────────────────────────────
    let hateScore = 0;
    const hateSignals = [];

    SCAPEGOAT_PATTERNS.filter(({ p }) => p.test(text)).forEach(({ label }) => {
      hateScore += 20; hateSignals.push(label);
    });
    DEHUMANIZE_PATTERNS.filter(({ p }) => p.test(text)).forEach(({ label }) => {
      hateScore += 35; hateSignals.push(label);
    });
    INCITEMENT_PATTERNS.filter(({ p }) => p.test(text)).forEach(({ label }) => {
      hateScore += 45; hateSignals.push(label);
    });
    SLUR_HINTS.filter(({ p }) => p.test(text)).forEach(({ label }) => {
      hateScore += 30; hateSignals.push(label);
    });

    if (hateScore >= 80) {
      signals.unshift({ level: 'danger',
        title: '🚨 Schwerwiegende Hetze erkannt',
        detail: `Dieser Text enthält mehrere Merkmale von Hasskommunikation oder Volksverhetzung (§130 StGB): ${hateSignals.slice(0,3).join(' · ')}. Meldung empfohlen: meldestelle-respect.de`,
        suspicion: 100 });
      suspicionScore += 60;
    } else if (hateScore >= 45) {
      signals.unshift({ level: 'danger',
        title: '⚠️ Hetze-Muster erkannt',
        detail: `Sprache, die auf Hasskommunikation hindeutet: ${hateSignals.slice(0,3).join(' · ')}. Kontext beachten und ggf. bei der Plattform melden.`,
        suspicion: 75 });
      suspicionScore += 40;
    } else if (hateScore >= 15) {
      signals.unshift({ level: 'warning',
        title: 'Mögliche Hetze-Sprache',
        detail: `Auffällige Formulierungen: ${hateSignals.join(' · ')}. Allein kein Beweis, aber im Kontext prüfen.`,
        suspicion: 40 });
      suspicionScore += 15;
    }

    if (signals.filter(s => s.level !== 'safe').length === 0) {
      signals.push({ level: 'safe', title: 'Keine auffälligen Textmuster',
        detail: 'Kein Hinweis auf Falschmeldungen, Kettenpost oder Hasskommunikation.', suspicion: 0 });
    }

    const finalScore = Math.max(0, Math.min(100, 100 - suspicionScore));
    const level = finalScore >= 65 ? 'safe' : finalScore >= 40 ? 'warning' : 'danger';
    const verdict = { safe: 'Text unauffällig', warning: 'Textmuster auffällig',
      danger: hateScore >= 45 ? 'Hetze erkannt' : 'Starke Manipulation erkannt' }[level];

    return { valid: true, text, score: finalScore, level, verdict, signals, hateScore,
      stats: { charCount: text.length, wordCount: text.split(/\s+/).filter(Boolean).length,
        capsRatio: Math.round(capsRatio * 100), hasSource } };
  }

  async function detect(file, onProgress) {
    const ocr = await extractText(file, onProgress);
    const analysis = analyzeText(ocr.text);
    return { ...ocr, ...analysis, ocrConfidence: ocr.confidence };
  }

  function looksLikeScreenshot(fileType, hasExif) {
    return !hasExif && (fileType === 'image/png' || fileType === 'image/webp');
  }

  return { detect, looksLikeScreenshot, analyzeText };
})();
