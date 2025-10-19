# 🚗 Speedometer GPS Tracker

Eine moderne, mobile Web-Anwendung für GPS-basiertes Geschwindigkeitstracking mit schönem Speedometer-Design und Trip-Statistiken.

## ✨ Features

- **Live Speedometer**: Rundes, animiertes Speedometer (0-300 km/h)
- **GPS-Tracking**: Präzise Geschwindigkeitsmessung mit iPhone GPS
- **Trip-Statistiken**: 
  - Aktuelle Geschwindigkeit
  - Durchschnittsgeschwindigkeit
  - Höchstgeschwindigkeit
  - Zurückgelegte Distanz
  - Höhenangabe
  - Trip-Dauer
- **OSM-Integration**: Automatische Erkennung von Start- und Zielpunkten
- **SQLite-Datenbank**: Lokale Speicherung der Trip-Statistiken
- **Mobile Optimiert**: Responsive Design für iPhone und andere mobile Geräte
- **Dunkles Design**: Modernes Dark Mode UI
- **PWA-Ready**: Installierbar als Web-App

## 🚀 Installation & Nutzung

1. **Dateien herunterladen**: Alle Dateien in einen Ordner kopieren
2. **Webserver starten**: 
   ```bash
   # Mit Python
   python -m http.server 9443
   
   # Mit Node.js
   npx serve . -p 9443
   ```
3. **Im Browser öffnen**: `http://localhost:9443`
4. **GPS-Berechtigung erteilen**: Beim ersten Start wird nach GPS-Zugriff gefragt
5. **Trip starten**: "Trip Starten" Button drücken

## 📱 Mobile Nutzung

- **iPhone**: Safari öffnen und Seite zu Home-Bildschirm hinzufügen
- **Android**: Chrome öffnen und "Zum Startbildschirm hinzufügen"
- **PWA**: Die App kann als native App installiert werden

## 🛠 Technische Details

### Verwendete Technologien
- **HTML5**: Geolocation API für GPS-Zugriff
- **CSS3**: Moderne Animationen und Responsive Design
- **JavaScript ES6+**: Klassen-basierte Architektur
- **SQLite**: Lokale Datenbank mit sql.js
- **OpenStreetMap**: Nominatim API für Standort-Namen
- **PWA**: Service Worker und Manifest

### GPS-Genauigkeit
- **Hochpräzise**: `enableHighAccuracy: true`
- **Update-Rate**: 1 Sekunde
- **Fallback**: Berechnung über Distanz/Zeit wenn GPS-Geschwindigkeit nicht verfügbar

### Datenbank-Schema
```sql
CREATE TABLE trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time TEXT NOT NULL,
    end_time TEXT,
    duration TEXT,
    total_distance REAL,
    max_speed REAL,
    avg_speed REAL,
    elevation REAL,
    start_location TEXT,
    end_location TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## 🎨 UI-Features

- **Speedometer**: Animiertes, rundes Design mit Farbverlauf
- **Statistik-Karten**: Übersichtliche Darstellung aller Werte
- **Editable Locations**: Start- und Zielpunkte können bearbeitet werden
- **Trip-Historie**: Übersicht aller gespeicherten Trips
- **Responsive**: Optimiert für alle Bildschirmgrößen

## 🔧 Anpassungen

### Geschwindigkeitsbereich ändern
In `app.js` Zeile 45:
```javascript
const progress = (speed / 300) * 100; // 300 km/h Maximum
```

### Update-Intervall anpassen
In `app.js` Zeile 78:
```javascript
maximumAge: 1000 // 1 Sekunde
```

### OSM-Lookup anpassen
In `app.js` Zeile 200:
```javascript
const response = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
);
```

## 📊 Datenschutz

- **Lokale Speicherung**: Alle Daten bleiben auf dem Gerät
- **Keine Server**: Keine Übertragung an externe Server (außer OSM für Standort-Namen)
- **GPS-Daten**: Werden nur temporär für Berechnungen verwendet

## 🐛 Bekannte Probleme

- **HTTPS erforderlich**: GPS funktioniert nur über HTTPS oder localhost
- **Batterieverbrauch**: Kontinuierliches GPS-Tracking verbraucht Akku
- **Genauigkeit**: In Gebäuden oder Tunneln kann GPS ungenau sein

## 📝 Lizenz

MIT License - Frei verwendbar für private und kommerzielle Projekte.

## 🤝 Beitragen

Verbesserungen und Bug-Fixes sind willkommen! Einfach einen Pull Request erstellen.

---

**Hinweis**: Diese App funktioniert am besten auf mobilen Geräten mit aktiviertem GPS. Für beste Ergebnisse sollte die App im Vollbildmodus verwendet werden.

