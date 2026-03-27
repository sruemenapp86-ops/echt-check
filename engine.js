/**
 * ECHT-CHECK ENGINE v1.0
 * Modul: Metadaten-Detektiv (Phase 1)
 * ---
 * Rein lokale EXIF/Metadaten-Analyse.
 * Kein Server, kein Upload, 100% im Browser-RAM.
 */

const EchtCheckEngine = (() => {

    // Bekannte KI-Generatoren & Bearbeitungs-Software-Tags
    const AI_SOFTWARE_PATTERNS = [
        'midjourney', 'dall-e', 'dall·e', 'stable diffusion', 'firefly',
        'adobe firefly', 'generative', 'ai generated', 'kling', 'runway',
        'leonardo', 'ideogram', 'flux', 'sora', 'imagine', 'nightcafe',
        'dreamstudio', 'invoke', 'automatic1111', 'comfyui', 'foocus',
        'magnific', 'topaz', 'gigapixel'
    ];

    const EDITING_SOFTWARE_PATTERNS = [
        'photoshop', 'lightroom', 'gimp', 'affinity', 'capture one',
        'snapseed', 'facetune', 'meitu', 'picsart', 'canva', 'remove.bg'
    ];

    /**
     * Hauptanalysefunktion.
     * @param {File} file - Die zu prüfende Bild-Datei
     * @returns {Promise<AnalysisResult>}
     */
    async function analyzeFile(file) {
        return new Promise((resolve, reject) => {
            if (!file || !file.type.startsWith('image/')) {
                return reject(new Error('Keine gültige Bilddatei.'));
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const result = _processImage(file, e.target.result);
                    resolve(result);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
            reader.readAsArrayBuffer(file);
        });
    }

    function _processImage(file, arrayBuffer) {
        const exifData = _extractExif(arrayBuffer);
        const flags = _analyzeFlags(file, exifData);
        const score = _calculateScore(flags);

        return {
            fileName: file.name,
            fileSize: file.size,
            fileType: file.type,
            lastModified: new Date(file.lastModified),
            exif: exifData,
            flags: flags,
            verdict: _getVerdict(score),
            score: score
        };
    }

    function _extractExif(arrayBuffer) {
        try {
            const tags = EXIF.readFromBinaryFile(arrayBuffer);
            if (!tags) return null;
            return {
                make: tags.Make || null,
                model: tags.Model || null,
                software: tags.Software || null,
                dateTimeOriginal: tags.DateTimeOriginal || null,
                dateTimeDigitized: tags.DateTimeDigitized || null,
                dateTime: tags.DateTime || null,
                gpsLat: tags.GPSLatitude || null,
                gpsLon: tags.GPSLongitude || null,
                gpsAlt: tags.GPSAltitude || null,
                colorSpace: tags.ColorSpace || null,
                pixelX: tags.PixelXDimension || null,
                pixelY: tags.PixelYDimension || null,
                orientation: tags.Orientation || null,
                exposureTime: tags.ExposureTime || null,
                fNumber: tags.FNumber || null,
                iso: tags.ISOSpeedRatings || null,
                focalLength: tags.FocalLength || null,
                flash: tags.Flash || null,
                copyright: tags.Copyright || null,
                artist: tags.Artist || null,
                imageDescription: tags.ImageDescription || null,
                userComment: tags.UserComment || null,
                xpComment: tags['Windows XP Comment'] || null,
                raw: tags
            };
        } catch (e) {
            return null;
        }
    }

    function _analyzeFlags(file, exif) {
        const flags = [];
        const softwareLower = exif?.software?.toLowerCase() || '';

        // --- FLAG 1: Keine EXIF-Daten ---
        if (!exif || Object.keys(exif).filter(k => k !== 'raw' && exif[k] !== null).length < 3) {
            flags.push({
                level: 'warning',
                code: 'NO_EXIF',
                title: 'Keine EXIF-Daten',
                detail: 'Das Bild enthält keine technischen Metadaten. Echte Kamera-Aufnahmen haben immer EXIF-Daten. Typisch für Screenshots, Downloads oder bearbeitete Bilder.'
            });
        }

        // --- FLAG 2: KI-Generator erkannt ---
        const aiMatch = AI_SOFTWARE_PATTERNS.find(p => softwareLower.includes(p));
        if (aiMatch) {
            flags.push({
                level: 'danger',
                code: 'AI_SOFTWARE_TAG',
                title: 'KI-Generator erkannt',
                detail: `Im Software-Tag wurde "${exif.software}" gefunden. Dies ist ein direkter Hinweis auf ein KI-generiertes Bild.`
            });
        }

        // --- FLAG 3: Bildbearbeitung erkannt ---
        const editMatch = EDITING_SOFTWARE_PATTERNS.find(p => softwareLower.includes(p));
        if (editMatch && !aiMatch) {
            flags.push({
                level: 'warning',
                code: 'EDITING_SOFTWARE',
                title: 'Bildbearbeitung erkannt',
                detail: `Software-Tag: "${exif.software}". Das Bild wurde mit Bearbeitungssoftware verändert.`
            });
        }

        // --- FLAG 4: Kein Kamera-Modell, aber andere EXIF vorhanden ---
        if (exif && !exif.make && !exif.model && exif.dateTimeOriginal) {
            flags.push({
                level: 'info',
                code: 'NO_CAMERA_MODEL',
                title: 'Kein Kamera-Modell',
                detail: 'Obwohl ein Aufnahmedatum vorhanden ist, fehlen Kamera-Hersteller und -Modell. Dies kann auf Bearbeitung hinweisen.'
            });
        }

        // --- FLAG 5: GPS-Daten vorhanden ---
        if (exif?.gpsLat && exif?.gpsLon) {
            flags.push({
                level: 'safe',
                code: 'GPS_PRESENT',
                title: 'GPS-Koordinaten vorhanden',
                detail: 'Das Bild enthält GPS-Daten – ein starkes Zeichen für eine echte Kameraaufnahme.'
            });
        }

        // --- FLAG 6: Kein Aufnahmedatum ---
        if (exif && !exif.dateTimeOriginal && !exif.dateTimeDigitized) {
            flags.push({
                level: 'warning',
                code: 'NO_DATE',
                title: 'Kein Aufnahmedatum',
                detail: 'Es konnte kein originales Aufnahmedatum gefunden werden. Echte Fotos haben fast immer einen Zeitstempel.'
            });
        }

        // --- FLAG 7: JPEG ohne EXIF (für KI-generierte häufig) ---
        if (file.type === 'image/jpeg' && !exif) {
            flags.push({
                level: 'danger',
                code: 'JPEG_NO_EXIF',
                title: 'JPEG ohne EXIF-Daten',
                detail: 'Ein JPEG-Bild ohne jegliche EXIF-Metadaten ist ein starker Verdachts-Indikator. KI-Generatoren erzeugen oft EXIF-freie JPEGs.'
            });
        }

        // --- FLAG 8: Echte Kamera erkannt ---
        if (exif?.make && exif?.model && exif?.dateTimeOriginal) {
            flags.push({
                level: 'safe',
                code: 'CAMERA_FINGERPRINT',
                title: 'Kamera-Fingerabdruck vorhanden',
                detail: `Aufgenommen mit: ${exif.make} ${exif.model}. Originaldatum vorhanden.`
            });
        }

        return flags;
    }

    function _calculateScore(flags) {
        // Score: 0 = definitiv Fake, 100 = definitiv Echt
        let score = 50; // Neutral-Start

        for (const flag of flags) {
            switch (flag.code) {
                case 'AI_SOFTWARE_TAG': score -= 40; break;
                case 'JPEG_NO_EXIF': score -= 25; break;
                case 'NO_EXIF': score -= 20; break;
                case 'EDITING_SOFTWARE': score -= 10; break;
                case 'NO_DATE': score -= 8; break;
                case 'NO_CAMERA_MODEL': score -= 5; break;
                case 'GPS_PRESENT': score += 20; break;
                case 'CAMERA_FINGERPRINT': score += 30; break;
            }
        }

        // Auf 0-100 clampen
        return Math.max(0, Math.min(100, score));
    }

    function _getVerdict(score) {
        if (score >= 75) return { label: 'Wahrscheinlich Echt', level: 'safe', icon: '✅' };
        if (score >= 45) return { label: 'Unklar – Prüfung empfohlen', level: 'warning', icon: '⚠️' };
        if (score >= 20) return { label: 'Verdächtig – Wahrscheinlich manipuliert', level: 'danger', icon: '🚨' };
        return { label: 'Sehr wahrscheinlich Fake / KI-generiert', level: 'danger', icon: '🔴' };
    }

    return { analyzeFile };
})();
