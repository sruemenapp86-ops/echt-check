const EchtCheckAPI = (() => {
  const BASE = 'https://echt-check.duckdns.org:3500';
  // Kein Caching - jedes Mal neu pruefen
  async function ping() {
    try {
      const r = await fetch(`${BASE}/health`, {
        signal: AbortSignal.timeout(6000),
        cache: 'no-store'
      });
      console.log('[EchtCheck API] Health:', r.status, r.ok);
      return r.ok;
    } catch (e) {
      console.warn('[EchtCheck API] Health FEHLER:', e.message);
      return false;
    }
  }

  async function analyzeImage(file) {
    const isUp = await ping();
    if (!isUp) { console.warn('[EchtCheck API] Server nicht erreichbar'); return null; }
    
    try {
      console.log('[EchtCheck API] Sende Bild:', file.name, file.size, 'bytes');
      const fd = new FormData();
      fd.append('image', file, file.name);
      const r = await fetch(`${BASE}/analyze/image`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(45000)
      });
      console.log('[EchtCheck API] Antwort:', r.status, r.ok);
      if (!r.ok) { console.warn('[EchtCheck API] HTTP Fehler:', r.status); return null; }
      const data = await r.json();
      console.log('[EchtCheck API] Ergebnis:', data);
      return data;
    } catch (e) {
      console.error('[EchtCheck API] POST FEHLER:', e.message);
      return null;
    }
  }

  async function checkDomain(url) {
    if (!await ping()) return null;
    try {
      const r = await fetch(`${BASE}/domain/check?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function analyzeUrl(url) {
    try {
      const r = await fetch(`${BASE}/analyze/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(20000)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    } catch (e) {
      console.error('[EchtCheck API] URL-Analyse FEHLER:', e.message);
      throw e;
    }
  }

  async function checkLLMStatus() {
    try {
      const r = await fetch(`${BASE}/llm/status`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return { online: false };
      return await r.json();
    } catch { return { online: false }; }
  }

  // ─── Neuer Polling-Helper für Warteschlange ───
  async function _pollLlmJob(jobId, onProgress) {
    while (true) {
      await new Promise(r => setTimeout(r, 2500)); // Alle 2.5 Sekunden klopfen
      try {
        const r = await fetch(`${BASE}/analyze/llm/${jobId}`);
        const data = await r.json();
        
        if (!r.ok) {
           if (r.status === 404) throw new Error('Ticket abgelaufen / nicht mehr im System');
           throw new Error(data.error || 'Job Check Error');
        }

        if (data.status === 'done') return data.result;
        if (data.status === 'error') throw new Error(data.error);
        if (data.status === 'pending' && onProgress) {
           onProgress(data.position, data.estimatedSeconds);
        }
      } catch (e) {
        throw e;
      }
    }
  }

  async function analyzeLLMText(text, onProgress) {
    try {
      const initR = await fetch(`${BASE}/analyze/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', text }),
        signal: AbortSignal.timeout(10000)
      });
      const data = await initR.json();
      if (!initR.ok) throw new Error(data.error || `HTTP ${initR.status}`);
      if (data.status === 'queued' && data.jobId) {
        return await _pollLlmJob(data.jobId, onProgress);
      }
      return data; // Fallback
    } catch(e) {
      console.warn('[EchtCheck LLM-Text] Fehler:', e.message);
      return null;
    }
  }
  async function analyzeLLMImage(file, onProgress, preScore = 50, ocrText = null) {
    try {
      // Bild Client-seitig verkleinern um 413 Payload Too Large zu verhindern
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const MAX_SIZE = 1024;
            let width = img.width;
            let height = img.height;

            if (width > height && width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            } else if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Als JPEG exportieren (reduziert Größe massiv)
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            resolve(dataUrl.split(',')[1]); // Nur Base64 Teil
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const initR = await fetch(`${BASE}/analyze/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType: 'image/jpeg', preScore, text: ocrText }),
        signal: AbortSignal.timeout(15000) // Ticket holen geht schnell
      });
      const data = await initR.json();
      if (!initR.ok) {
         const e = new Error(data.error || `HTTP ${initR.status}`);
         e.offline = !!data.offline;
         e.modelMissing = !!data.modelMissing;
         throw e;
      }
      if (data.status === 'queued' && data.jobId) {
        return await _pollLlmJob(data.jobId, onProgress);
      }
      return data;
    } catch(e) {
      console.warn('[EchtCheck LLM-Vision] Fehler:', e.message);
      return null;
    }
  }

  async function reportFake(file, proofUrl, comment) {
    try {
      const fd = new FormData();
      fd.append('image', file, file.name);
      if (proofUrl) fd.append('proofUrl', proofUrl);
      if (comment) fd.append('comment', comment);

      const r = await fetch(`${BASE}/report/fake`, {
        method: 'POST',
        body: fd,
        signal: AbortSignal.timeout(10000)
      });
      if (!r.ok) return null;
      return await r.json();
    } catch(e) {
      console.warn('[EchtCheck API] Fake-Meldung fehlgeschlagen:', e.message);
      return null;
    }
  }

  return { ping, analyzeImage, checkDomain, analyzeUrl, checkLLMStatus, analyzeLLMText, analyzeLLMImage, reportFake };
})();