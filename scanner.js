/**
 * ECHT-CHECK SCANNER v1.0
 * Modul: KI-Struktur-Scanner (Phase 2)
 * ---
 * Analysiert Bildstrukturen auf KI-typische Muster:
 * 1. ELA  – Error Level Analysis (Kompressions-Differenzen)
 * 2. Noise – Rauschstruktur-Analyse (Hochpassfilter)
 * 3. Color – Farbverteilungs-Entropie
 *
 * 100% lokal – kein Upload, kein Server.
 */

const EchtCheckScanner = (() => {

    // Max. Auflösung für die Analyse (Performance)
    const MAX_DIM = 600;

    /**
     * Hauptfunktion – analysiert eine Bilddatei
     * @param {File} file
     * @returns {Promise<ScanResult>}
     */
    async function scan(file) {
        const img = await _loadFileAsImage(file);
        return _performFullScan(img, file);
    }

    // --- LOADER HELPERS ---

    function _loadFileAsImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const url = URL.createObjectURL(file);
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
            img.src = url;
        });
    }

    function _loadDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    // --- MAIN SCAN ---

    async function _performFullScan(img, file) {
        // Skaliert auf MAX_DIM für Performance
        const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);

        const originalData = ctx.getImageData(0, 0, w, h);

        // ELA (async, wegen Bild-Reload), Noise + Color synchron
        const elaResult = await _performELA(canvas, ctx, img, w, h, file.type);
        const noiseResult = _analyzeNoise(originalData, w, h);
        const colorResult = _analyzeColorStats(originalData, w, h);

        const combinedScore = _combineScores(elaResult, noiseResult, colorResult, file.type);

        return {
            ela: elaResult,
            noise: noiseResult,
            color: colorResult,
            combinedScore,
            verdict: _getVerdict(combinedScore),
            imageSize: { w: img.naturalWidth, h: img.naturalHeight }
        };
    }

    // --- 1. ERROR LEVEL ANALYSIS ---

    async function _performELA(canvas, ctx, img, w, h, fileType) {
        try {
            // Original-Pixel sichern
            ctx.drawImage(img, 0, 0, w, h);
            const original = ctx.getImageData(0, 0, w, h);

            // Mit JPEG-Qualität 75% re-encoden (deckt Kompressionsartefakte auf)
            const recompDataUrl = canvas.toDataURL('image/jpeg', 0.75);
            const recompImg = await _loadDataUrl(recompDataUrl);

            ctx.drawImage(recompImg, 0, 0, w, h);
            const recomp = ctx.getImageData(0, 0, w, h);

            // Original wiederherstellen
            ctx.putImageData(original, 0, 0);

            // ELA-Heatmap erzeugen
            const elaCanvas = document.createElement('canvas');
            elaCanvas.width = w;
            elaCanvas.height = h;
            const elaCtx = elaCanvas.getContext('2d');
            const elaImg = elaCtx.createImageData(w, h);

            const diffs = [];
            for (let i = 0; i < original.data.length; i += 4) {
                const dr = Math.abs(original.data[i]   - recomp.data[i]);
                const dg = Math.abs(original.data[i+1] - recomp.data[i+1]);
                const db = Math.abs(original.data[i+2] - recomp.data[i+2]);
                const diff = (dr + dg + db) / 3;
                diffs.push(diff);

                // Heatmap: Rot = hohe Differenz, Dunkel = niedrige Differenz
                const amp = Math.min(255, diff * 14);
                elaImg.data[i]   = amp;
                elaImg.data[i+1] = Math.max(0, amp * 0.2);
                elaImg.data[i+2] = 0;
                elaImg.data[i+3] = 255;
            }
            elaCtx.putImageData(elaImg, 0, 0);

            const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
            const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length;
            const stdDev = Math.sqrt(variance);

            // Sortiert für Perzentil-Analyse (erkennt lokalisierte Hotspots)
            const sorted = [...diffs].sort((a, b) => a - b);
            const p95 = sorted[Math.floor(sorted.length * 0.95)]; // obere 5%
            const p99 = sorted[Math.floor(sorted.length * 0.99)]; // obere 1%

            // Verhältnis hoher Abweichungen zu Durchschnitt
            // Hoch = lokalisierte Hotspots → Hinweis auf Copy-Paste / Compositing
            const hotspotRatio = mean > 0.1 ? p95 / mean : 0;
            const spikeRatio = mean > 0.1 ? p99 / mean : 0;

            const suspicion = _elaToSuspicion(mean, stdDev, hotspotRatio, spikeRatio, fileType);

            return {
                available: true,
                elaCanvas,
                mean: mean.toFixed(2),
                stdDev: stdDev.toFixed(2),
                p95: p95.toFixed(2),
                hotspotRatio: hotspotRatio.toFixed(1),
                suspicion,
                interpretation: _interpretELA(mean, stdDev, hotspotRatio, fileType)
            };

        } catch (e) {
            return { available: false, suspicion: 50, interpretation: 'ELA nicht verfügbar.' };
        }
    }

    function _elaToSuspicion(mean, stdDev, hotspotRatio, spikeRatio, fileType) {
        if (fileType === 'image/png') {
            // PNG: ELA immer auffällig wegen Lossless → JPEG Konvertierung
            if (mean < 2 && stdDev < 2) return 72;
            return 48;
        }

        // === MUSTER 1: Copy-Paste / Compositing ===
        // Lokalisierte Hotspots: Durchschnitt niedrig, aber Spitzen sehr hoch
        // hotspotRatio > 8 bedeutet: p95-Wert ist 8x höher als Durchschnitt
        if (hotspotRatio > 10 && mean < 5) return 82; // Starke lokale Auffälligkeiten
        if (hotspotRatio > 7  && mean < 6) return 72; // Deutliche lokale Auffälligkeiten
        if (hotspotRatio > 5  && mean < 8) return 62; // Mäßige lokale Auffälligkeiten

        // === MUSTER 2: KI-generiert ===
        // Sehr gleichmäßig niedrig → kein Kompressionsunterschied irgendwo
        if (mean < 1.5 && stdDev < 1.5) return 80;
        if (mean < 4   && stdDev < 3.5) return 65;

        // === MUSTER 3: Stark bearbeitet / vielfach gespeichert ===
        if (mean > 20 && stdDev > 15) return 60;

        return 38; // Normaler Bereich
    }

    function _interpretELA(mean, stdDev, hotspotRatio, fileType) {
        if (fileType === 'image/png') {
            if (mean < 2 && stdDev < 2) return 'PNG mit unnatürlich gleichmäßiger Struktur – KI-Verdacht.';
            return 'PNG-Datei: ELA-Aussagekraft eingeschränkt (verlustfreies Format).';
        }
        // Lokalisierte Hotspots = Compositing-Verdacht
        if (hotspotRatio > 10 && mean < 5) return '⚠️ Starke lokalisierte ELA-Hotspots – typisch für Copy-Paste-Compositing. Bestimmte Bildbereiche haben eine andere Kompressionsgeschichte als der Rest.';
        if (hotspotRatio > 7  && mean < 6) return '⚠️ Deutliche lokale ELA-Abweichungen – Hinweis auf eingefügte Elemente oder Compositing.';
        if (hotspotRatio > 5  && mean < 8) return 'Leicht ungleichmäßige ELA – möglicher Hinweis auf Bildbearbeitung.';
        if (mean < 2 && stdDev < 2) return 'Unnatürlich gleichmäßige Kompressionsstruktur – typisch für KI-generierte Bilder.';
        if (mean < 4 && stdDev < 3.5) return 'Leicht auffällige ELA – möglicher KI-Einfluss oder Social-Media-Kompression.';
        if (mean > 20 && stdDev > 15)  return 'Hohe ELA-Abweichungen – Hinweis auf starke Bearbeitung oder mehrfaches Speichern.';
        return 'ELA-Werte im normalen Bereich – keine offensichtlichen Anomalien.';
    }

    // --- 2. RAUSCHSTRUKTUR-ANALYSE ---

    function _analyzeNoise(imageData, w, h) {
        const data = imageData.data;

        // Graustufen
        const gray = new Float32Array(w * h);
        for (let i = 0; i < data.length; i += 4) {
            gray[i / 4] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        // Hochpassfilter (Laplacian-Kernel) → isoliert Rauschen
        const noise = [];
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const v = (
                    -gray[(y-1)*w+(x-1)] - gray[(y-1)*w+x] - gray[(y-1)*w+(x+1)]
                    - gray[y*w+(x-1)] + 8*gray[y*w+x] - gray[y*w+(x+1)]
                    - gray[(y+1)*w+(x-1)] - gray[(y+1)*w+x] - gray[(y+1)*w+(x+1)]
                ) / 8;
                noise.push(v);
            }
        }

        const absValues = noise.map(Math.abs);
        const absMean = absValues.reduce((a, b) => a + b, 0) / absValues.length;
        const mean = noise.reduce((a, b) => a + b, 0) / noise.length;
        const variance = noise.reduce((s, v) => s + (v - mean) ** 2, 0) / noise.length;
        const stdDev = Math.sqrt(variance);

        const suspicion = _noiseToSuspicion(absMean, stdDev);

        return {
            absMean: absMean.toFixed(2),
            stdDev: stdDev.toFixed(2),
            suspicion,
            interpretation: _interpretNoise(absMean, stdDev)
        };
    }

    function _noiseToSuspicion(absMean, stdDev) {
        if (absMean < 1.0 && stdDev < 1.5) return 82; // Extrem glatt → KI
        if (absMean < 2.5 && stdDev < 3.0) return 70; // Sehr glatt
        if (absMean < 4.5 && stdDev < 5.0) return 58; // Leicht glatt
        if (absMean >= 4.5 && absMean <= 35 && stdDev <= 28) return 32; // Normal
        if (absMean > 45 || stdDev > 40) return 60; // Zu viel Rauschen = ggf. bearbeitet
        return 44;
    }

    function _interpretNoise(absMean, stdDev) {
        if (absMean < 1.0 && stdDev < 1.5) return 'Extrem glatte Textur – für echte Kameras ungewöhnlich, typisch für KI.';
        if (absMean < 2.5 && stdDev < 3.0) return 'Sehr wenig natürliches Rauschen – möglicher KI-Einfluss.';
        if (absMean < 4.5 && stdDev < 5.0) return 'Leicht geringes Rauschen – möglicher KI-Einfluss oder Bildglättung.';
        if (absMean <= 35 && stdDev <= 28) return 'Natürliches Kamerarauschen – konsistent mit echter Aufnahme.';
        return 'Erhöhtes / unregelmäßiges Rauschen – mögliche Bildbearbeitung.';
    }

    // --- 3. FARBVERTEILUNGS-ANALYSE ---

    function _analyzeColorStats(imageData, w, h) {
        const data = imageData.data;
        const histR = new Int32Array(256);
        const histG = new Int32Array(256);
        const histB = new Int32Array(256);
        const pixelCount = w * h;

        for (let i = 0; i < data.length; i += 4) {
            histR[data[i]]++;
            histG[data[i+1]]++;
            histB[data[i+2]]++;
        }

        const eR = _entropy(histR, pixelCount);
        const eG = _entropy(histG, pixelCount);
        const eB = _entropy(histB, pixelCount);
        const avgEntropy = (eR + eG + eB) / 3;

        const suspicion = _colorToSuspicion(avgEntropy);

        return {
            entropy: avgEntropy.toFixed(2),
            suspicion,
            interpretation: _interpretColor(avgEntropy)
        };
    }

    function _entropy(hist, total) {
        return hist.reduce((h, count) => {
            if (count === 0) return h;
            const p = count / total;
            return h - p * Math.log2(p);
        }, 0);
    }

    function _colorToSuspicion(entropy) {
        if (entropy < 3.5) return 72; // Sehr wenig Farben → flaches/künstliches Bild
        if (entropy < 5.5) return 52;
        if (entropy >= 5.5) return 28; // Hohe Farb-Entropie = natürliches Foto
        return 45;
    }

    function _interpretColor(entropy) {
        if (entropy < 3.5) return 'Sehr geringe Farbvielfalt – untypisch für natürliche Fotos.';
        if (entropy < 5.5) return 'Mittlere Farbvielfalt – kein eindeutiges Signal.';
        return 'Hohe Farbvielfalt – konsistent mit natürlicher Fotografie.';
    }

    // --- SCORE KOMBINIEREN ---

    function _combineScores(ela, noise, color, fileType) {
        let suspicion;
        if (fileType === 'image/jpeg') {
            // JPEG: ELA zuverlässiger
            suspicion = ela.suspicion * 0.35 + noise.suspicion * 0.45 + color.suspicion * 0.20;
        } else {
            // PNG u.a.: Rauschen & Farbe gewichtiger
            suspicion = ela.suspicion * 0.20 + noise.suspicion * 0.50 + color.suspicion * 0.30;
        }
        // Hohe Suspicion = niedrige Echtheit
        return Math.round(Math.max(0, Math.min(100, 100 - suspicion)));
    }

    function _getVerdict(score) {
        if (score >= 65) return { label: 'Struktur unauffällig', level: 'safe', icon: '✅' };
        if (score >= 40) return { label: 'Struktur nicht eindeutig', level: 'warning', icon: '🔎' };
        if (score >= 20) return { label: 'Verdächtige Bildstruktur', level: 'danger', icon: '🚨' };
        return { label: 'Stark auffällige Struktur – KI-Verdacht hoch', level: 'danger', icon: '🔴' };
    }

    return { scan };
})();
