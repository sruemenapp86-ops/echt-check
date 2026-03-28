const EchtCheckAPI = (() => {
  // Direkt auf DuckDNS (HTTPS-Zertifikat gueltig fuer diese Domain)
  const BASE = 'https://echt-check.duckdns.org:3500';
  let available = null;

  async function ping() {
    if (available !== null) return available;
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
      available = r.ok;
    } catch (e) { available = false; }
    return available;
  }

  async function analyzeImage(file) {
    if (!await ping()) return null;
    try {
      const fd = new FormData();
      fd.append('image', file, file.name);
      const r = await fetch(`${BASE}/analyze/image`, {
        method: 'POST', body: fd, signal: AbortSignal.timeout(30000)
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  async function checkDomain(url) {
    if (!await ping()) return null;
    try {
      const r = await fetch(`${BASE}/domain/check?url=${encodeURIComponent(url)}`, {
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  return { ping, analyzeImage, checkDomain };
})();