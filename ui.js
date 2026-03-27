/**
 * ECHT-CHECK UI v1.0
 * Modul: Interface-Controller (Phase 1)
 * ---
 * Strict separation from engine.js.
 * Handles all DOM interactions, drag & drop, animations, results rendering.
 */

const EchtCheckUI = (() => {

    let currentObjectUrl = null;

    function init() {
        _setupDropZone();
        _setupFileInput();
        _setupDarkParticles();
    }

    // --- DRAG & DROP ZONE ---

    function _setupDropZone() {
        const zone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');

        ['dragenter', 'dragover'].forEach(ev => {
            zone.addEventListener(ev, (e) => {
                e.preventDefault();
                zone.classList.add('drag-active');
            });
        });

        ['dragleave', 'drop'].forEach(ev => {
            zone.addEventListener(ev, () => zone.classList.remove('drag-active'));
        });

        zone.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) _handleFile(file);
        });

        zone.addEventListener('click', () => fileInput.click());
    }

    function _setupFileInput() {
        const fileInput = document.getElementById('file-input');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) _handleFile(file);
            fileInput.value = '';
        });
    }

    // --- FILE PROCESSING ---

    async function _handleFile(file) {
        _showLoading(file);

        try {
            // Phase 1: Metadaten-Analyse
            const result = await EchtCheckEngine.analyzeFile(file);
            _showResults(result, file);

            // Phase 2: ELA Struktur-Scanner
            document.getElementById('phase2-loading').classList.remove('hidden');
            try {
                const scanResult = await EchtCheckScanner.scan(file);
                _showPhase2Results(scanResult);
            } catch (e) {
                console.warn('Phase 2 Fehler:', e);
            } finally {
                document.getElementById('phase2-loading').classList.add('hidden');
            }

            // Phase 3: Frequenz- & Strukturanalyse
            document.getElementById('phase3-loading').classList.remove('hidden');
            try {
                const aiResult = await EchtCheckAIDetector.detect(file);
                _showPhase3Results(aiResult);
            } catch (e) {
                console.warn('Phase 3 Fehler:', e);
            } finally {
                document.getElementById('phase3-loading').classList.add('hidden');
            }

        } catch (error) {
            _showError(error.message);
        }
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

        // Preview
        if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = URL.createObjectURL(file);
        const preview = document.getElementById('image-preview');
        preview.src = currentObjectUrl;
        preview.alt = result.fileName;

        // Verdict Banner
        const verdictEl = document.getElementById('verdict-banner');
        verdictEl.className = `verdict-banner verdict-${result.verdict.level}`;
        document.getElementById('verdict-icon').textContent = result.verdict.icon;
        document.getElementById('verdict-label').textContent = result.verdict.label;

        // Score Bar
        const scoreEl = document.getElementById('score-fill');
        const scoreTextEl = document.getElementById('score-text');
        scoreEl.style.width = '0%';
        scoreEl.className = `score-fill score-${result.verdict.level}`;
        setTimeout(() => { scoreEl.style.width = result.score + '%'; }, 50);
        scoreTextEl.textContent = result.score + ' / 100';

        // EXIF Matrix
        _renderExifMatrix(result);

        // Flags
        _renderFlags(result.flags);

        // Meta info
        document.getElementById('meta-filename').textContent = result.fileName;
        document.getElementById('meta-filesize').textContent = _formatBytes(result.fileSize);
        document.getElementById('meta-filetype').textContent = result.fileType;

        // Reset button
        document.getElementById('check-another-btn').addEventListener('click', _reset, { once: true });

        // Scroll to results
        document.getElementById('result-state').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function _renderExifMatrix(result) {
        const exif = result.exif;
        const grid = document.getElementById('exif-matrix');
        grid.innerHTML = '';

        const fields = [
            { label: 'Kamera Hersteller', value: exif?.make },
            { label: 'Kamera Modell', value: exif?.model },
            { label: 'Software', value: exif?.software },
            { label: 'Aufnahmedatum', value: exif?.dateTimeOriginal },
            { label: 'Digitalisiert', value: exif?.dateTimeDigitized },
            { label: 'GPS Breitengrad', value: exif?.gpsLat ? _formatGps(exif.gpsLat) : null },
            { label: 'GPS Längengrad', value: exif?.gpsLon ? _formatGps(exif.gpsLon) : null },
            { label: 'GPS Höhe', value: exif?.gpsAlt ? exif.gpsAlt + ' m' : null },
            { label: 'Auflösung', value: exif?.pixelX && exif?.pixelY ? `${exif.pixelX} × ${exif.pixelY} px` : null },
            { label: 'Belichtungszeit', value: exif?.exposureTime ? `1/${Math.round(1/exif.exposureTime)}s` : null },
            { label: 'Blende (f)', value: exif?.fNumber ? `f/${exif.fNumber}` : null },
            { label: 'ISO', value: exif?.iso },
            { label: 'Brennweite', value: exif?.focalLength ? `${exif.focalLength} mm` : null },
            { label: 'Farbraum', value: exif?.colorSpace === 1 ? 'sRGB' : exif?.colorSpace },
            { label: 'Urheber', value: exif?.copyright },
            { label: 'Künstler', value: exif?.artist },
        ];

        let hasAny = false;
        for (const f of fields) {
            if (f.value !== null && f.value !== undefined && f.value !== '') {
                hasAny = true;
                const cell = document.createElement('div');
                cell.className = 'exif-cell';
                cell.innerHTML = `<span class="exif-label">${f.label}</span><span class="exif-value">${f.value}</span>`;
                grid.appendChild(cell);
            }
        }

        if (!hasAny) {
            grid.innerHTML = `<div class="exif-empty">Keine EXIF-Daten gefunden. Das Bild enthält keine technischen Metadaten.</div>`;
        }
    }

    function _renderFlags(flags) {
        const container = document.getElementById('flags-container');
        container.innerHTML = '';

        if (!flags || flags.length === 0) {
            container.innerHTML = '<p class="text-muted">Keine besonderen Auffälligkeiten gefunden.</p>';
            return;
        }

        for (const flag of flags) {
            const el = document.createElement('div');
            el.className = `flag-card flag-${flag.level}`;
            el.innerHTML = `
                <div class="flag-header">
                    <span class="flag-icon">${_flagIcon(flag.level)}</span>
                    <span class="flag-title">${flag.title}</span>
                </div>
                <p class="flag-detail">${flag.detail}</p>
            `;
            container.appendChild(el);
        }
    }

    function _flagIcon(level) {
        const icons = { danger: '🔴', warning: '⚠️', info: 'ℹ️', safe: '✅' };
        return icons[level] || 'ℹ️';
    }

    function _showPhase2Results(scan) {
        // Phase 2 Verdict
        const banner = document.getElementById('phase2-verdict-banner');
        banner.className = `verdict-banner verdict-${scan.verdict.level}`;
        document.getElementById('phase2-verdict-icon').textContent = scan.verdict.icon;
        document.getElementById('phase2-verdict-label').textContent = scan.verdict.label;

        // Phase 2 Score
        const fill = document.getElementById('phase2-score-fill');
        fill.style.width = '0%';
        fill.className = `score-fill score-${scan.verdict.level}`;
        setTimeout(() => { fill.style.width = scan.combinedScore + '%'; }, 100);
        document.getElementById('phase2-score-text').textContent = scan.combinedScore + ' / 100';

        // ELA Heatmap
        if (scan.ela.available && scan.ela.elaCanvas) {
            const displayCanvas = document.getElementById('ela-canvas-display');
            displayCanvas.width = scan.ela.elaCanvas.width;
            displayCanvas.height = scan.ela.elaCanvas.height;
            displayCanvas.getContext('2d').drawImage(scan.ela.elaCanvas, 0, 0);
            document.getElementById('ela-mean').textContent = scan.ela.mean;
            document.getElementById('ela-stddev').textContent = scan.ela.stdDev;
            document.getElementById('ela-interpretation').textContent = scan.ela.interpretation;
            document.getElementById('phase2-ela-block').classList.remove('hidden');
        } else {
            document.getElementById('phase2-ela-block').classList.add('hidden');
        }

        // Noise
        document.getElementById('noise-absmean').textContent = scan.noise.absMean;
        document.getElementById('noise-stddev').textContent = scan.noise.stdDev;
        document.getElementById('noise-interpretation').textContent = scan.noise.interpretation;

        // Color
        document.getElementById('color-entropy').textContent = scan.color.entropy;
        document.getElementById('color-interpretation').textContent = scan.color.interpretation;

        // Show block
        document.getElementById('phase2-result').classList.remove('hidden');
    }

    function _showPhase3Results(ai) {
        // Verdict
        const banner = document.getElementById('phase3-verdict-banner');
        banner.className = `verdict-banner verdict-${ai.verdict.level}`;
        document.getElementById('phase3-verdict-icon').textContent = ai.verdict.icon;
        document.getElementById('phase3-verdict-label').textContent = ai.verdict.label;

        // Score
        const fill = document.getElementById('phase3-score-fill');
        fill.style.width = '0%';
        fill.className = `score-fill score-${ai.verdict.level}`;
        setTimeout(() => { fill.style.width = ai.score + '%'; }, 100);
        document.getElementById('phase3-score-text').textContent = ai.score + ' / 100';

        // Signal-Cards (4 Analyse-Module)
        const grid = document.getElementById('phase3-signals');
        grid.innerHTML = '';
        const signals = [ai.periodicity, ai.smoothness, ai.colorStats, ai.checkerboard];
        for (const sig of signals) {
            const level = sig.suspicion > 60 ? 'danger' : sig.suspicion > 40 ? 'warning' : 'safe';
            const card = document.createElement('div');
            card.className = `flag-card flag-${level}`;
            card.innerHTML = `
                <div class="flag-header">
                    <span class="flag-icon">${level === 'danger' ? '🔴' : level === 'warning' ? '⚠️' : '✅'}</span>
                    <span class="flag-title">${sig.label}</span>
                </div>
                <p class="flag-detail">${sig.interpretation}</p>
            `;
            grid.appendChild(card);
        }

        document.getElementById('phase3-result').classList.remove('hidden');
    }

    function _reset() {
        document.getElementById('result-state').classList.add('hidden');
        document.getElementById('error-state').classList.add('hidden');
        document.getElementById('phase2-loading').classList.add('hidden');
        document.getElementById('phase2-result').classList.add('hidden');
        document.getElementById('phase3-loading').classList.add('hidden');
        document.getElementById('phase3-result').classList.add('hidden');
        document.getElementById('welcome-state').classList.remove('hidden');
        if (currentObjectUrl) {
            URL.revokeObjectURL(currentObjectUrl);
            currentObjectUrl = null;
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // --- UTILS ---

    function _formatBytes(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(2) + ' MB';
    }

    function _formatGps(arr) {
        if (!Array.isArray(arr) || arr.length < 3) return JSON.stringify(arr);
        const deg = arr[0], min = arr[1], sec = arr[2];
        return `${deg}° ${min}' ${typeof sec === 'number' ? sec.toFixed(2) : sec}"`;
    }

    // --- DECORATIVE PARTICLES ---

    function _setupDarkParticles() {
        const canvas = document.getElementById('particle-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
        resize();
        window.addEventListener('resize', resize);

        const particles = Array.from({ length: 55 }, () => ({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 1.5 + 0.3,
            dx: (Math.random() - 0.5) * 0.3,
            dy: (Math.random() - 0.5) * 0.3,
            alpha: Math.random() * 0.5 + 0.1
        }));

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (const p of particles) {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 255, 255, ${p.alpha})`;
                ctx.fill();
                p.x += p.dx;
                p.y += p.dy;
                if (p.x < 0 || p.x > canvas.width) p.dx *= -1;
                if (p.y < 0 || p.y > canvas.height) p.dy *= -1;
            }
            requestAnimationFrame(draw);
        }
        draw();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => EchtCheckUI.init());
