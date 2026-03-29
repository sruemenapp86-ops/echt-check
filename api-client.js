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

  async function analyzeLLMText(text) {
    try {
      const r = await fetch(`${BASE}/analyze/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text', text }),
        signal: AbortSignal.timeout(50000)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    } catch(e) {
      console.warn('[EchtCheck LLM-Text] Fehler:', e.message);
      return null;
    }
  }

  async function analyzeLLMImage(file) {
    try {
      // Datei → Base64
      const base64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = () => res(reader.result.split(',')[1]); // nur Base64-Teil
        reader.onerror = rej;
        reader.readAsDataURL(file);
      });

      const r = await fetch(`${BASE}/analyze/llm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', imageBase64: base64, mimeType: file.type }),
        signal: AbortSignal.timeout(100000)
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      return data;
    } catch(e) {
      console.warn('[EchtCheck LLM-Vision] Fehler:', e.message);
      return null;
    }
  }

  return { ping, analyzeImage, checkDomain, analyzeUrl, checkLLMStatus, analyzeLLMText, analyzeLLMImage };
})();