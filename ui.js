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
            const result = await EchtCheckEngine.analyzeFile(file);
            _showResults(result, file);
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

    function _reset() {
        document.getElementById('result-state').classList.add('hidden');
        document.getElementById('error-state').classList.add('hidden');
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
