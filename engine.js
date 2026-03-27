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
        // HINWEIS: WhatsApp, Instagram, Telegram, Facebook & Co. löschen
        // automatisch alle EXIF-Daten beim Versenden – auch bei echten Fotos!
        // Fehlendes EXIF ist daher KEIN Beweis für ein Fake.
        if (!exif || Object.keys(exif).filter(k => k !== 'raw' && exif[k] !== null).length < 3) {
            flags.push({
                level: 'info',
                code: 'NO_EXIF',
                title: 'Keine Metadaten vorhanden',
                detail: 'Das Bild enthält keine technischen Metadaten (EXIF). Das bedeutet nicht automatisch, dass es ein Fake ist – Messenger wie WhatsApp, Telegram oder Instagram löschen diese Daten beim Versenden grundsätzlich. Ohne Metadaten ist keine sichere Aussage möglich.'
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
                detail: 'Obwohl ein Aufnahmedatum vorhanden ist, fehlen Kamera-Hersteller und -Modell. Könnte auf nachträgliche Bearbeitung hinweisen, muss es aber nicht.'
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

        // --- FLAG 6: Kein Aufnahmedatum (nur wenn EXIF prinzipiell vorhanden) ---
        // Wenn gar keine EXIF da sind (z.B. WhatsApp), diesen Flag nicht zusätzlich zeigen
        if (exif && Object.keys(exif).filter(k => k !== 'raw' && exif[k] !== null).length >= 3
            && !exif.dateTimeOriginal && !exif.dateTimeDigitized) {
            flags.push({
                level: 'info',
                code: 'NO_DATE',
                title: 'Kein Aufnahmedatum',
                detail: 'Es konnte kein originales Aufnahmedatum in den vorhandenen Metadaten gefunden werden.'
            });
        }

        // --- FLAG 7: JPEG ohne EXIF – NUR schwacher Hinweis, kein Fake-Beweis ---
        // (WhatsApp sendet fast immer EXIF-freie JPEGs, auch bei echten Fotos)
        if (file.type === 'image/jpeg' && !exif) {
            flags.push({
                level: 'info',
                code: 'JPEG_NO_EXIF',
                title: 'JPEG ohne Metadaten',
                detail: 'Dieses JPEG enthält keine EXIF-Metadaten. Dies ist sehr häufig bei Bildern, die über WhatsApp, Instagram oder andere Messenger weitergeleitet wurden – auch bei echten Fotos. Alleine ist dies kein Fake-Indikator.'
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
        // Philosophie: Nur POSITIVE Signale (Kamera-Fingerabdruck, GPS) erhöhen
        // den Score. Fehlendes EXIF alleine ist KEIN Beweis – Social Media löscht
        // Metadaten generell. Nur echte Fake-Indikatoren (KI-Tag) senken stark.
        let score = 50; // Neutral-Start = "nicht bestimmbar"

        for (const flag of flags) {
            switch (flag.code) {
                // Starke Fake-Signale (es gibt echte Beweise)
                case 'AI_SOFTWARE_TAG':     score -= 45; break;
                case 'EDITING_SOFTWARE':    score -= 8;  break;

                // Schwache / mehrdeutige Signale (kein Beweis)
                case 'JPEG_NO_EXIF':        score -= 5;  break; // WhatsApp-Effekt!
                case 'NO_EXIF':             score -= 5;  break; // WhatsApp-Effekt!
                case 'NO_DATE':             score -= 3;  break;
                case 'NO_CAMERA_MODEL':     score -= 3;  break;

                // Starke Echtheit-Signale (es gibt echte Beweise)
                case 'GPS_PRESENT':         score += 22; break;
                case 'CAMERA_FINGERPRINT':  score += 32; break;
            }
        }

        // Auf 0-100 clampen
        return Math.max(0, Math.min(100, score));
    }

    function _getVerdict(score) {
        if (score >= 72) return { label: 'Wahrscheinlich echt', level: 'safe', icon: '✅' };
        if (score >= 40) return { label: 'Nicht eindeutig bestimmbar', level: 'warning', icon: '🔎' };
        if (score >= 15) return { label: 'Verdächtig – mögliche Manipulation', level: 'danger', icon: '🚨' };
        return { label: 'Sehr wahrscheinlich Fake / KI-generiert', level: 'danger', icon: '🔴' };
    }

    return { analyzeFile };
})();
