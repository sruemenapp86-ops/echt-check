# 🔍 Echt-Check – KI-gestützte Bild- & Faktenprüfung

> **Prüfe Bilder und Inhalte auf KI-Manipulation, Fälschungen und Desinformation – datenschutzkonform, ohne Cloud, lokal auf echter Hardware.**

[![Live Demo](https://img.shields.io/badge/Live%20Demo-tool.echt--check.de-blue?style=for-the-badge)](https://tool.echt-check.de)
[![Backend](https://img.shields.io/badge/Backend-echt--check.duckdns.org-green?style=for-the-badge)](https://echt-check.duckdns.org:3500/health)
[![License](https://img.shields.io/badge/Lizenz-privat-lightgrey?style=for-the-badge)]()

---

## ✨ Was ist Echt-Check?

Echt-Check ist ein forensisches Analyse-Tool, das Bilder in **4 unabhängigen Phasen** prüft und dabei vollständig **lokal und ohne Datenweitergabe** arbeitet. Entwickelt für den Einsatz im Bildungsbereich, bei Journalisten und in der Jugendarbeit, um Fake-Bilder und Desinformation aufzudecken.

> **100% lokal – Bilder verlassen nie deinen Browser oder den lokalen Server.**

---

## 🧪 Die 4 Analyse-Phasen

### Phase 1 – Metadaten-Analyse (EXIF)
Liest technische Metadaten aus dem Bild: Kameramodell, GPS, Erstellungsdatum, Bearbeitungssoftware. Fehlen diese Daten komplett, ist das ein erstes Warnsignal – denn Messenger-Apps löschen Metadaten beim Versenden.

### Phase 2 – ELA-Struktur-Scanner
**Error Level Analysis:** Erkennt, ob Bildteile unterschiedlich stark komprimiert wurden – ein typisches Zeichen für nachträgliche Bearbeitung oder Montage. Zeigt eine visuelle Heatmap der Auffälligkeiten.

### Phase 3 – Frequenz- & GAN-Analyse  
Analysiert spektrale Muster, Textur-Gleichmäßigkeit, Farbverteilung und Checkerboard-Artefakte – typische Fingerabdrücke von KI-Generatoren wie Stable Diffusion oder Midjourney.

### Phase 4 – KI-Modell (lokales Backend)
Ein vortrainiertes **SwinV2-Transformer-Modell** (Microsoft Research) läuft auf echter lokaler Hardware und gibt eine KI-Wahrscheinlichkeit zurück. Das Modell wurde auf hunderttausenden echten Fotos und KI-generierten Bildern trainiert.

---

## 🏗️ Architektur

```
Browser (GitHub Pages)          Backend (lokaler P52-Server)
──────────────────────          ─────────────────────────────
index.html                      nginx (SSL/HTTPS, Port 3500)
scanner.js (Phase 1-3)    ──►   Express API (Node.js)
ai-detector.js (Phase 4)        │
api-client.js                   ├── KI-Modell (Python/FastAPI)
                                │   SwinV2 auf Quadro P3200 GPU
                                │   6GB VRAM, CUDA 12.4
                                │
                                └── PostgreSQL (Ergebnis-Cache)
```

**Hosting:**
- **Frontend:** GitHub Pages → `tool.echt-check.de`
- **Backend:** Lenovo ThinkPad P52 (lokale Hardware), erreichbar via DuckDNS
- **SSL:** Let's Encrypt via Certbot
- **Domain:** `echt-check.duckdns.org` / `tool.echt-check.de`

---

## 🛠️ Tech-Stack

| Komponente | Technologie |
|---|---|
| **Frontend** | Vanilla HTML/CSS/JavaScript (PWA) |
| **Backend API** | Node.js + Express |
| **KI-Inferenz** | Python + FastAPI + HuggingFace Transformers |
| **KI-Modell** | `haywoodsloan/ai-image-detector-deploy` (SwinV2) |
| **GPU-Beschleunigung** | PyTorch + CUDA 12.4 / Quadro P3200 |
| **Datenbank** | PostgreSQL 16 |
| **Reverse Proxy** | Nginx (SSL-Terminierung) |
| **Containerisierung** | Docker + Docker Compose |
| **Deployment** | GitHub Pages (Frontend) + lokaler Docker-Stack (Backend) |

---

## ⚡ Backend-Setup (lokal)

### Voraussetzungen
- Docker + Docker Compose
- NVIDIA Container Toolkit (für GPU-Beschleunigung)
- SSL-Zertifikate unter `C:/EchtCheck/certs/`
- CUDA-kompatible GPU (empfohlen: ≥ 4GB VRAM)

### Starten
```bash
cd C:\EchtCheck\backend
docker compose up -d
```

### Dienste prüfen
```bash
# API Health
curl https://echt-check.duckdns.org:3500/health

# KI-Modell Status
docker logs echt-model --tail 10

# GPU-Auslastung
nvidia-smi
```

### Docker-Container
| Container | Funktion | Port |
|---|---|---|
| `echt-nginx` | SSL-Proxy | 3500 (HTTPS) |
| `echt-api` | REST API | intern:3500 |
| `echt-model` | KI-Inferenz (GPU) | intern:8000 |
| `echt-db` | PostgreSQL Cache | intern:5432 |

---

## 📁 Projektstruktur

```
tool/                       # Frontend (GitHub Pages)
├── index.html              # Haupt-App
├── scanner.js              # Phase 1–3 Analyse (lokal im Browser)
├── ai-detector.js          # Phase 4 KI-Analyse (Browser-Fallback)
├── engine.js               # Analyse-Engine & Orchestrierung
├── ui.js                   # UI-Logik & Ergebnisdarstellung
├── api-client.js           # Backend-Kommunikation
└── manifest.json           # PWA Manifest

C:\EchtCheck\backend\       # Backend (Docker-Stack)
├── docker-compose.yml
├── api/
│   └── index.js            # Express REST API
├── model/
│   ├── main.py             # FastAPI KI-Inferenz-Service
│   └── Dockerfile          # pytorch/pytorch CUDA-Image
├── nginx/
│   └── nginx.conf          # Reverse Proxy + SSL
└── db/
    └── init.sql            # DB-Schema
```

---

## 🔒 Datenschutz

- **Kein Cloud-Upload:** Bilder werden ausschließlich lokal verarbeitet
- **Kein Tracking:** Keine Analytics, keine Cookies, kein Fingerprinting  
- **Kein Login:** Vollständig anonym nutzbar
- **Lokal:** Backend läuft auf privater Hardware, nicht bei einem Cloud-Anbieter

---

## 🗺️ Roadmap

- [x] Phase 1: EXIF-Metadaten-Analyse (Browser)
- [x] Phase 2: ELA-Struktur-Scanner mit Heatmap (Browser)
- [x] Phase 3: Frequenz- & GAN-Analyse (Browser)  
- [x] Phase 4: KI-Modell auf lokaler GPU (Backend)
- [x] HTTPS + Domain-Anbindung
- [x] PostgreSQL Ergebnis-Cache
- [ ] Besseres KI-Modell (Multimodal, höhere Genauigkeit)
- [ ] Screenshot-Analyse (OCR → Textextraktion aus Facebook-Posts etc.)
- [ ] URL-Eingabe + Web-Faktencheck (LLM + Suchmaschinen-Integration)
- [ ] Batch-Analyse mehrerer Bilder
- [ ] Exportfunktion (PDF-Bericht)

---

## 👤 Autor

**Stefan Rümenapp
Entwickelt im Rahmen als eigenständiges Werkzeug zur Bekämpfung von Desinformation.

---

*Dieses Projekt befindet sich in aktiver Entwicklung.*
