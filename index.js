const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

const db = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'echtcheck',
  user: process.env.DB_USER || 'echtcheck',
  password: process.env.DB_PASS || 'ec_secret_2024',
});

const MODEL_URL = process.env.MODEL_URL || 'http://model:8000';

app.get('/health', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', gpu: true, db: 'connected' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.post('/analyze/image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Kein Bild uebermittelt' });

    const imageBuffer = req.file.buffer;
    const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');

    // Cache pruefen
    const existing = await db.query('SELECT * FROM image_hashes WHERE phash = $1', [hash]);
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      return res.json({ source: 'cache', hash, ...row });
    }

    // KI-Modell anfragen
    let aiResult = { score: 50, verdict: 'uncertain', confidence: 0, method: 'statistical_fallback' };
    try {
      const modelRes = await axios.post(`${MODEL_URL}/predict`, imageBuffer, {
        headers: { 'Content-Type': req.file.mimetype },
        timeout: 90000
      });
      if (modelRes.data && modelRes.data.verdict) {
        aiResult = modelRes.data;
      }
    } catch (modelErr) {
      console.warn('Modell Fallback:', modelErr.message);
    }

    // In DB speichern (inkl. score + method)
    await db.query(
      'INSERT INTO image_hashes (phash, verdict, confidence, score, method, source) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (phash) DO NOTHING',
      [hash, aiResult.verdict, aiResult.confidence || 0, aiResult.score || 50, aiResult.method || 'statistical_fallback', 'api']
    );

    res.json({ source: 'fresh', hash, ...aiResult });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/domain/check', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url Parameter fehlt' });
  try {
    let domain;
    try { domain = new URL(url.startsWith('http') ? url : 'https://' + url).hostname.replace('www.', ''); }
    catch { domain = url.replace('www.', ''); }
    const result = await db.query('SELECT * FROM known_domains WHERE domain = $1', [domain]);
    if (result.rows.length > 0) return res.json({ domain, found: true, ...result.rows[0] });
    res.json({ domain, found: false, reputation: 'unknown' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/domain/add', async (req, res) => {
  const { domain, reputation, category, source } = req.body;
  if (!domain || !reputation) return res.status(400).json({ error: 'domain und reputation erforderlich' });
  try {
    await db.query(
      'INSERT INTO known_domains (domain, reputation, category, source) VALUES ($1, $2, $3, $4) ON CONFLICT (domain) DO UPDATE SET reputation=$2, updated_at=NOW()',
      [domain, reputation, category || null, source || 'manual']
    );
    res.json({ success: true, domain });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/stats', async (req, res) => {
  try {
    const domains = await db.query('SELECT COUNT(*) FROM known_domains');
    const hashes = await db.query('SELECT COUNT(*) FROM image_hashes');
    res.json({ known_domains: parseInt(domains.rows[0].count), analyzed_images: parseInt(hashes.rows[0].count) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── URL-Abruf & Textextraktion ────────────────────────────────────────────
function fetchAndExtract(targetUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 4) return reject(new Error('Zu viele Weiterleitungen'));
    const lib = targetUrl.startsWith('https') ? require('https') : require('http');
    const req = lib.get(targetUrl, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity'
      }
    }, (response) => {
      if ([301,302,303,307,308].includes(response.statusCode) && response.headers.location) {
        const next = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, targetUrl).href;
        req.destroy();
        return fetchAndExtract(next, redirectCount + 1).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) return reject(new Error(`HTTP ${response.statusCode}`));
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size < 2097152) chunks.push(chunk); });
      response.on('end', () => { try { resolve(extractContent(Buffer.concat(chunks).toString('utf8'))); } catch(e) { reject(e); } });
      response.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function extractContent(html) {
  const titleM = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  const title = titleM ? titleM[1].replace(/\s+/g, ' ').trim() : '';
  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,500})["']/i)
             || html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,500})["']/i);
  const description = descM ? descM[1].trim() : '';
  const imgM = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  const imageUrl = imgM ? imgM[1].trim() : null;

  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '').replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const articleM = cleaned.match(/<article[^>]*>([\s\S]+?)<\/article>/i)
                || cleaned.match(/<main[^>]*>([\s\S]+?)<\/main>/i);
  const source = articleM ? articleM[1] : cleaned;

  const text = source
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
    .replace(/\s{3,}/g, '\n').replace(/ {2,}/g, ' ').trim().slice(0, 8000);

  return { title, description, imageUrl, text };
}

// ─── POST /analyze/url ─────────────────────────────────────────────────────
app.post('/analyze/url', async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL fehlt' });
  let parsed;
  try { parsed = new URL(url.trim()); } catch { return res.status(400).json({ error: 'Ungültige URL' }); }
  if (!['http:', 'https:'].includes(parsed.protocol)) return res.status(400).json({ error: 'Nur HTTP/HTTPS erlaubt' });
  const hostname = parsed.hostname;
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(hostname))
    return res.status(400).json({ error: 'Private Adressen nicht erlaubt' });

  const domain = hostname.replace(/^www\./, '');
  let domainInfo = { found: false, reputation: 'unknown', domain };
  try {
    const dr = await db.query('SELECT * FROM known_domains WHERE domain = $1', [domain]);
    if (dr.rows.length > 0) domainInfo = { found: true, ...dr.rows[0] };
  } catch(e) {}

  let content;
  try { content = await fetchAndExtract(parsed.href); }
  catch(e) { return res.status(502).json({ error: `Seite nicht erreichbar: ${e.message}`, domain, domainInfo, url: parsed.href }); }

  res.json({ url: parsed.href, domain, domainInfo, ...content, textLength: content.text.length });
});

// ─── Ollama LLM Analyse ────────────────────────────────────────────────────
const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
const LLM_TEXT_MODEL  = 'gemma3:4b';
const LLM_VISION_MODEL = 'llava:7b-v1.6-mistral-q4_K_M';

async function checkOllamaOnline() {
  try {
    const r = await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 3000 });
    return r.status === 200;
  } catch { return false; }
}

app.get('/llm/status', async (req, res) => {
  const online = await checkOllamaOnline();
  if (!online) return res.json({ online: false, models: [] });
  try {
    const r = await axios.get(`${OLLAMA_BASE}/api/tags`, { timeout: 3000 });
    const models = (r.data.models || []).map(m => m.name);
    res.json({ online: true, models, textReady: models.some(m => m.includes('gemma')), visionReady: models.some(m => m.includes('llava')) });
  } catch(e) { res.json({ online: false, error: e.message }); }
});

// ─── Heimsucher-Modul (DuckDuckGo Scraper für Faktencheck-Seiten) ───
async function searchFactChecks(query) {
  if (!query || query.length < 5) return [];
  const searchStr = `site:mimikama.org OR site:correctiv.org OR site:dpa-factchecking.com ${query}`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchStr)}`;
  
  try {
    const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36 EchtCheck' }, timeout: 8000 });
    const html = r.data;
    const results = [];
    const regex = /<a class="result__url" href="([^"]+)">(.*?)<\/a>.*?<a class="result__snippet[^>]+>(.*?)<\/a>/gs;
    let m;
    while ((m = regex.exec(html)) && results.length < 2) { // max 2 Treffer reichen völlig
      let href = m[1];
      if (href.startsWith('//duckduckgo.com/l/?uddg=')) {
        href = decodeURIComponent(href.split('uddg=')[1].split('&')[0]);
      }
      const title = m[2].replace(/<[^>]+>/g,'').trim();
      const snippet = m[3].replace(/<[^>]+>/g,'').trim();
      if (title && href && !href.includes('duckduckgo.com')) {
         results.push({ url: href, title, snippet });
      }
    }
    return results;
  } catch(e) {
    console.error('FactCheck API error:', e.message);
    return [];
  }
}

app.post('/analyze/llm', async (req, res) => {
  const { type, text, imageBase64, mimeType } = req.body || {};
  if (!type || !['text','image'].includes(type)) return res.status(400).json({ error: 'type muss "text" oder "image" sein' });

  const online = await checkOllamaOnline();
  if (!online) return res.status(503).json({ error: 'Ollama nicht erreichbar – bitte starten', offline: true });

  try {
    if (type === 'text') {
      if (!text || text.length < 10) return res.status(400).json({ error: 'Text zu kurz' });

      const prompt = `Du bist ein Experte für Medienkompetenz und Faktenprüfung in Deutschland.
Analysiere den folgenden Text auf problematische Inhalte. Sei präzise und fair.

Prüfe auf:
1. Hetze und Hasskommunikation (Volksverhetzung §130 StGB): Pauschalvorwürfe, Entmenschlichung, Gewaltaufrufe
2. Fake-News-Muster: unbelegte Sensationsbehauptungen, Verschwörungstheorien, Gerüchte als Fakten
3. Manipulative Formulierungen: Angst-Trigger, Dringlichkeit, emotionale Überwältigung
4. Desinformation: nachweislich falsche oder irreführende Aussagen

Text: """${text.slice(0, 3000)}"""

Antworte NUR mit gültigem JSON ohne Markdown-Formatierung:
{"suspicious":true/false,"score":0-100,"verdict":"Unauffällig oder Textmuster auffällig oder Manipulation erkannt oder Hetze erkannt","flags":[{"type":"hate/fake/manipulation/disinfo","text":"kurze Erklärung auf Deutsch","severity":"low/medium/high"}],"summary":"1-2 Sätze Zusammenfassung auf Deutsch","searchQuery":"3-5 markante Suchbegriffe aus dem Text (ohne Füllwörter) für einen Google Fact-Check"}`;

      const r = await axios.post(`${OLLAMA_BASE}/api/generate`, {
        model: LLM_TEXT_MODEL, prompt, stream: false, format: 'json',
        options: { temperature: 0.1, num_predict: 500 }
      }, { timeout: 45000 });

      let parsed;
      try { parsed = typeof r.data.response === 'string' ? JSON.parse(r.data.response) : r.data.response; }
      catch { return res.status(500).json({ error: 'LLM hat kein valides JSON geliefert', raw: r.data.response?.slice(0,200) }); }

      // ─── NEU: Vollautomatischer Web Fact-Check Abgleich ───
      if (parsed.searchQuery) {
        parsed.factchecks = await searchFactChecks(parsed.searchQuery);
      }

      res.json({ type: 'text', model: LLM_TEXT_MODEL, ...parsed });

    } else if (type === 'image') {
      if (!imageBase64) return res.status(400).json({ error: 'imageBase64 fehlt' });

      const prompt = `Du bist ein forensischer Bildanalyst. Untersuche dieses Bild auf Anzeichen von Manipulation oder Fälschung.

Prüfe auf:
1. Fotomontage: Wurden Personen oder Objekte aus verschiedenen Fotos zusammengefügt?
2. Inkonsistente Beleuchtung, Schatten oder Perspektive zwischen Bildteilen
3. Unnatürliche Übergänge, weichgezeichnete Ränder um Objekte/Personen
4. Nachträglich eingefügte Logos, Text oder Wasserzeichen
5. Farbton-Unterschiede zwischen kombinierten Bildteilen
6. Maßstabs- oder Proportionsfehler

Antworte NUR mit gültigem JSON ohne Markdown oder Codeblöcke:
{"manipulated":true/false,"confidence":0-100,"verdict":"Authentisch oder Manipuliert","flags":[],"explanation":""}
WICHTIG: Das Array 'flags' darf nur die tatsächlichen, im Bild gefundenen Fehler enthalten (sonst []). Die 'explanation' muss in 1-2 kurzen Sätzen deine gefundenen Mängel oder deine Unauffälligkeits-Entscheidung auf Deutsch begründen!`;

      const r = await axios.post(`${OLLAMA_BASE}/api/generate`, {
        model: LLM_VISION_MODEL,
        prompt,
        images: [imageBase64],
        stream: false,
        format: 'json',
        options: { temperature: 0.1, num_predict: 400 }
      }, { timeout: 90000 });

      let parsed;
      try { parsed = typeof r.data.response === 'string' ? JSON.parse(r.data.response) : r.data.response; }
      catch { return res.status(500).json({ error: 'Vision-LLM hat kein valides JSON', raw: r.data.response?.slice(0,200) }); }

      res.json({ type: 'image', model: LLM_VISION_MODEL, ...parsed });
    }
  } catch(e) {
    if (e.code === 'ECONNABORTED') return res.status(504).json({ error: 'LLM-Timeout – Modell zu langsam', offline: false });
    if (e.response?.status === 404) return res.status(404).json({ error: `Modell nicht gefunden. Bitte: ollama pull ${type === 'text' ? LLM_TEXT_MODEL : LLM_VISION_MODEL}`, modelMissing: true });
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => console.log(`Echt-Check API laeuft auf Port ${PORT}`));