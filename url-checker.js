/**
 * Echt-Check URL-Analyse
 * Holt URL-Inhalt via Backend, führt Textanalyse + Domain-Check durch.
 */
const EchtCheckURLChecker = (() => {

  // ─── Domain-Reputation-Bewertung ──────────────────────────────────────────
  const SUSPICIOUS_TLD = ['.ru', '.xyz', '.top', '.click', '.tk', '.ml', '.ga', '.cf'];
  const SHORTENERS = ['bit.ly','tinyurl.com','t.co','rebrand.ly','ow.ly','short.io','tiny.cc','is.gd','buff.ly'];

  function assessDomain(domain, domainInfo) {
    const signals = [];
    let suspicion = 0;

    // Bekannte Domain in DB
    if (domainInfo?.found) {
      if (domainInfo.reputation === 'fake' || domainInfo.reputation === 'bad') {
        signals.push({ level: 'danger', title: '🚨 Bekannte Fake-News-Quelle', detail: `Die Domain „${domain}" ist als unseriöse oder Falschnachrichten-Quelle bekannt (Kategorie: ${domainInfo.category || 'unbekannt'}).` });
        suspicion += 60;
      } else if (domainInfo.reputation === 'mixed') {
        signals.push({ level: 'warning', title: '⚠️ Quelle mit gemischter Reputation', detail: `„${domain}" ist nicht eindeutig eingestuft – Inhalte mit Vorsicht genießen.` });
        suspicion += 25;
      } else if (domainInfo.reputation === 'good') {
        signals.push({ level: 'safe', title: '✅ Bekannte seriöse Quelle', detail: `„${domain}" ist als seriöse Nachrichtenquelle eingestuft.` });
        suspicion -= 10;
      }
    }

    // URL-Verkürzer
    if (SHORTENERS.includes(domain)) {
      signals.push({ level: 'warning', title: 'URL-Verkürzer', detail: `„${domain}" ist ein URL-Verkürzer – das Ziel ist nicht direkt erkennbar. Vorsicht bei solchen Links.` });
      suspicion += 15;
    }

    // Verdächtige TLD
    const suspicious = SUSPICIOUS_TLD.find(tld => domain.endsWith(tld));
    if (suspicious) {
      signals.push({ level: 'warning', title: `Auffällige Domain-Endung (${suspicious})`, detail: `Domains mit der Endung „${suspicious}" werden häufig für fragwürdige Inhalte genutzt.` });
      suspicion += 10;
    }

    // Viele Zahlen im Domain-Namen (oft Spam)
    if (/\d{4,}/.test(domain)) {
      signals.push({ level: 'warning', title: 'Zahlenlastige Domain', detail: 'Domains mit vielen Zahlen sind oft kurzlebige Spam- oder Fake-Seiten.' });
      suspicion += 10;
    }

    return { signals, suspicion };
  }

  // ─── Hauptanalyse ─────────────────────────────────────────────────────────
  async function analyze(url) {
    // URL normalisieren
    const normalizedUrl = url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim();

    // Vom Backend holen
    const result = await EchtCheckAPI.analyzeUrl(normalizedUrl);

    // Domain bewerten
    const domainAssessment = assessDomain(result.domain, result.domainInfo);

    // Text analysieren (EchtCheckOCR.analyzeText wiederverwenden)
    let textAnalysis = null;
    if (result.text && result.text.length > 20) {
      const words = result.text.split(/\s+/).filter(Boolean);
      textAnalysis = EchtCheckOCR.analyzeText(result.text, 100, words.length);
    }

    return {
      ...result,
      domainAssessment,
      textAnalysis,
    };
  }

  return { analyze };
})();
