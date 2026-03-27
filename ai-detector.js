/**
 * ECHT-CHECK AI DETECTOR v1.0
 * Phase 3: Frequenz- & Strukturanalyse
 * ---
 * Erkennt KI-typische Muster ohne Modell-Download:
 * 1. Periodizität  – Autocorrelation für GAN-Upsampling-Artefakte
 * 2. Textur-Glättung – Lokale Varianz (Diffusion-Modelle = zu glatt)
 * 3. Farbstatistik  – YCbCr-Verteilung (natürliche Fotos = Gauß-förmig)
 * 4. Checkerboard   – Klassisches GAN-Muster durch Transposed Convolution
 *
 * Wissenschaftlich fundiert – basiert auf:
 * "Unmasking DeepFakes with Simple Features" (Durall et al., 2020)
 * "CNN-generated images are surprisingly easy to spot" (Wang et al., 2020)
 *
 * 100% lokal – kein Upload, kein Server, kein Modell-Download.
 */

const EchtCheckAIDetector = (() => {

    const ANALYSIS_SIZE = 256; // Arbeitsgröße für alle Analysen

    async function detect(file) {
        const canvas = await _fileToCanvas(file, ANALYSIS_SIZE);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);

        const gray = _toGrayscale(imageData);
        const ycbcr = _toYCbCr(imageData);

        const periodicity   = _analyzePeriodicity(gray);
        const smoothness    = _analyzeSmoothness(gray);
        const colorStats    = _analyzeColorStats(ycbcr);
        const checkerboard  = _detectCheckerboard(gray);

        const score = _combineScores(periodicity, smoothness, colorStats, checkerboard, file.type);

        return {
            periodicity,
            smoothness,
            colorStats,
            checkerboard,
            score,
            verdict: _getVerdict(score)
        };
    }

    // ------------------------------------------------------------------ //
    //  LOADER HELPERS
    // ------------------------------------------------------------------ //

    async function _fileToCanvas(file, size) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const c = document.createElement('canvas');
                c.width = size; c.height = size;
                c.getContext('2d').drawImage(img, 0, 0, size, size);
                resolve(c);
            };
            img.onerror = reject;
            img.src = url;
        });
    }

    function _toGrayscale(imageData) {
        const d = imageData.data;
        const out = new Float32Array(imageData.width * imageData.height);
        for (let i = 0; i < out.length; i++) {
            out[i] = (d[i*4]*0.299 + d[i*4+1]*0.587 + d[i*4+2]*0.114) / 255;
        }
        return out;
    }

    function _toYCbCr(imageData) {
        const d = imageData.data;
        const n = imageData.width * imageData.height;
        const Cb = new Float32Array(n), Cr = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const R = d[i*4], G = d[i*4+1], B = d[i*4+2];
            Cb[i] = 128 - 0.168736*R - 0.331264*G + 0.5*B;
            Cr[i] = 128 + 0.5*R      - 0.418688*G - 0.081312*B;
        }
        return { Cb, Cr };
    }

    // ------------------------------------------------------------------ //
    //  1. PERIODIZITÄTS-ANALYSE (Autocorrelation)
    // ------------------------------------------------------------------ //

    function _analyzePeriodicity(gray) {
        const w = ANALYSIS_SIZE;
        // GAN-Upsampling (stride 2, 4, 8) → Peaks bei diesen Lags
        const ganLags  = [8, 16, 32];
        const baseLags = [3, 5, 7, 11, 13]; // Baseline: zufällige andere Lags

        const ganPowers = [], basePowers = [];

        // 80 Zeilen aus der Bildmitte analysieren
        for (let y = w*3/8 | 0; y < w*5/8 | 0; y += 2) {
            const row = Array.from(gray.slice(y*w, y*w+w));
            const acf  = _acf(row, 40);

            ganPowers.push( ganLags.reduce((s,l) => s + Math.abs(acf[l-1]||0), 0) / ganLags.length );
            basePowers.push( baseLags.reduce((s,l) => s + Math.abs(acf[l-1]||0), 0) / baseLags.length );
        }

        const avgGan  = ganPowers.reduce((a,b) => a+b, 0) / ganPowers.length;
        const avgBase = basePowers.reduce((a,b) => a+b, 0) / basePowers.length;
        const ratio   = avgBase > 0.005 ? avgGan / avgBase : 1.0;

        const suspicion =
            ratio > 1.8 ? 78 :
            ratio > 1.4 ? 62 :
            ratio > 1.1 ? 42 : 22;

        return {
            ratio: ratio.toFixed(2),
            suspicion,
            label: 'GAN-Periodizität',
            interpretation:
                ratio > 1.8 ? '⚠️ Starke periodische Muster – GAN-/Diffusions-Artefakte erkannt.' :
                ratio > 1.4 ? 'Leichte Periodizität – schwacher Hinweis auf KI-Generator.' :
                              'Keine auffällige Periodizität – unauffällig.'
        };
    }

    function _acf(signal, maxLag) {
        const n = signal.length;
        const mean = signal.reduce((a,b) => a+b, 0) / n;
        const variance = signal.reduce((s,v) => s+(v-mean)**2, 0) / n;
        if (variance < 1e-7) return new Array(maxLag).fill(0);
        const r = [];
        for (let lag = 1; lag <= maxLag; lag++) {
            let sum = 0;
            for (let i = 0; i < n-lag; i++) sum += (signal[i]-mean)*(signal[i+lag]-mean);
            r.push(sum / ((n-lag)*variance));
        }
        return r;
    }

    // ------------------------------------------------------------------ //
    //  2. TEXTUR-GLÄTTUNGS-ANALYSE
    // ------------------------------------------------------------------ //

    function _analyzeSmoothness(gray) {
        const w = ANALYSIS_SIZE;
        const blockSize = 8;
        const variances = [];

        for (let by = 0; by < w; by += blockSize) {
            for (let bx = 0; bx < w; bx += blockSize) {
                let s = 0, sq = 0, c = 0;
                for (let dy = 0; dy < blockSize; dy++) {
                    for (let dx = 0; dx < blockSize; dx++) {
                        const v = gray[(by+dy)*w+(bx+dx)];
                        s += v; sq += v*v; c++;
                    }
                }
                const m = s/c;
                variances.push(sq/c - m*m);
            }
        }

        variances.sort((a,b) => a-b);
        const p10    = variances[Math.floor(variances.length * 0.10)];
        const median = variances[Math.floor(variances.length * 0.50)];

        // Zu viele extrem glatte Bereiche = KI-typisch
        const suspicion =
            p10 < 0.0003 && median < 0.004  ? 75 :
            p10 < 0.0008 && median < 0.008  ? 60 :
            p10 < 0.002  && median < 0.015  ? 42 : 22;

        return {
            medianVar: median.toFixed(5),
            suspicion,
            label: 'Textur-Gleichmäßigkeit',
            interpretation:
                suspicion > 65 ? '⚠️ Unnatürlich viele glatte Bereiche – typisch für Diffusion-Modelle (SD, Midjourney).' :
                suspicion > 50 ? 'Teils glatte Texturen – leichter KI-Hinweis.' :
                                 'Natürliche Texturvarianz – konsistent mit echter Kameraaufnahme.'
        };
    }

    // ------------------------------------------------------------------ //
    //  3. FARBSTATISTIK (YCbCr)
    // ------------------------------------------------------------------ //

    function _analyzeColorStats(ycbcr) {
        // Echte Fotos: Cb & Cr annähernd Gauß-verteilt um 128
        // KI-Bilder: oft unnatürliche Farbverteilungen
        const cbStats = _basicStats(ycbcr.Cb);
        const crStats = _basicStats(ycbcr.Cr);

        // Kurtosis der Farbkanäle: reale Fotos haben moderate Kurtosis
        // Sehr niedrig (platykurtisch) = künstlich geglättet
        const avgKurtosis = (cbStats.kurtosis + crStats.kurtosis) / 2;

        const suspicion =
            Math.abs(avgKurtosis) < 0.3 ? 65 : // Zu flach = unnatürlich
            Math.abs(avgKurtosis) < 0.8 ? 45 :
            Math.abs(avgKurtosis) < 2.5 ? 25 : 35; // Sehr spitzig = auch unnatürlich

        return {
            cbMean: cbStats.mean.toFixed(1),
            crMean: crStats.mean.toFixed(1),
            kurtosis: avgKurtosis.toFixed(2),
            suspicion,
            label: 'Farbverteilung (YCbCr)',
            interpretation:
                suspicion > 55 ? 'Unnatürliche Farbverteilung – KI-Modelle erzeugen oft künstliche Chroma-Muster.' :
                                 'Farbverteilung unauffällig.'
        };
    }

    function _basicStats(arr) {
        const n = arr.length;
        const mean = arr.reduce((a,b) => a+b, 0) / n;
        const variance = arr.reduce((s,v) => s+(v-mean)**2, 0) / n;
        const stdDev = Math.sqrt(variance);
        const kurtosis = stdDev > 0.001
            ? (arr.reduce((s,v) => s+((v-mean)/stdDev)**4, 0)/n) - 3
            : 0;
        return { mean, stdDev, kurtosis };
    }

    // ------------------------------------------------------------------ //
    //  4. CHECKERBOARD-MUSTER (GAN-Transposed-Convolution-Artefakt)
    // ------------------------------------------------------------------ //

    function _detectCheckerboard(gray) {
        const w = ANALYSIS_SIZE;
        let hits = 0, total = 0;

        for (let y = 0; y < w; y++) {
            for (let x = 0; x < w-2; x++) {
                const a = gray[y*w+x], b = gray[y*w+x+1], c = gray[y*w+x+2];
                const near = Math.abs(a-b);
                const skip = Math.abs(a-c);
                if (near > 0.01) { if (skip < near) hits++; total++; }
            }
        }

        const ratio = total > 0 ? hits/total : 0.5;
        const suspicion =
            ratio > 0.68 ? 70 :
            ratio > 0.62 ? 52 :
            ratio > 0.55 ? 35 : 18;

        return {
            ratio: ratio.toFixed(3),
            suspicion,
            label: 'Checkerboard-Muster',
            interpretation:
                suspicion > 60 ? '⚠️ Auffällige Pixel-Alternierung – typisches Transposed-Convolution-Artefakt.' :
                suspicion > 45 ? 'Leichtes Checkerboard-Muster – schwacher KI-Hinweis.' :
                                 'Kein Checkerboard-Muster erkannt.'
        };
    }

    // ------------------------------------------------------------------ //
    //  SCORE KOMBINIEREN
    // ------------------------------------------------------------------ //

    function _combineScores(periodicity, smoothness, colorStats, checker, fileType) {
        // Gewichtete Kombination der Suspicion-Werte
        const suspicion =
            periodicity.suspicion * 0.30 +
            smoothness.suspicion  * 0.35 +
            colorStats.suspicion  * 0.15 +
            checker.suspicion     * 0.20;

        // Hohe Suspicion = niedrige Echtheit (invertieren)
        return Math.round(Math.max(0, Math.min(100, 100 - suspicion)));
    }

    function _getVerdict(score) {
        if (score >= 62) return { label: 'Keine KI-Muster erkannt',      level: 'safe',    icon: '✅' };
        if (score >= 40) return { label: 'Schwache KI-Indikatoren',       level: 'warning', icon: '🔎' };
        if (score >= 20) return { label: 'Deutliche KI-Muster erkannt',   level: 'danger',  icon: '🚨' };
        return              { label: 'Stark auffällig – KI-Verdacht hoch', level: 'danger',  icon: '🔴' };
    }

    return { detect };
})();
