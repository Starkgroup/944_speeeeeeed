class SpeedometerApp {
    constructor() {
        this.isTracking = false;
        this.isPaused = false;
        this.currentTrip = null;
        this.watchId = null;
        this.db = null;
        this.lastPosition = null;
        this.gpsPermissionGranted = false;
        this.gpsCheckInterval = null;
        this.pauseStartTime = null;
        this.totalPauseTime = 0;
        this.tripStats = {
            startTime: null,
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
            minElevation: null,
            maxElevation: null,
            elevationGain: 0,
            startLocation: 'Unbekannt',
            endLocation: 'Unbekannt',
            positions: []
        };

        this.init();
    }

    async init() {
        await this.initDatabase();
        this.bindEvents();
        this.loadTripHistory();
        this.checkGPSPermission();
        this.updateStatus('Bereit zum Starten');
    }

    async initDatabase() {
        try {
            const SQL = await initSqlJs({
                locateFile: file => `https://unpkg.com/sql.js@1.8.0/dist/${file}`
            });
            
            // Lade gespeicherte Datenbank aus LocalStorage
            const savedDb = localStorage.getItem('speedometer_db');
            if (savedDb) {
                const data = new Uint8Array(JSON.parse(savedDb));
                this.db = new SQL.Database(data);
                console.log('Datenbank aus LocalStorage geladen');
            } else {
                this.db = new SQL.Database();
                console.log('Neue Datenbank erstellt');
            }
            
            // Erstelle Trips-Tabelle
            this.db.run(`
                CREATE TABLE IF NOT EXISTS trips (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    start_time TEXT NOT NULL,
                    end_time TEXT,
                    duration TEXT,
                    total_distance REAL,
                    max_speed REAL,
                    avg_speed REAL,
                    elevation REAL,
                    min_elevation REAL,
                    max_elevation REAL,
                    elevation_gain REAL,
                    start_location TEXT,
                    end_location TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Speichere die Datenbank im LocalStorage
            this.saveDatabase();
            
            console.log('Datenbank initialisiert');
        } catch (error) {
            console.error('Fehler beim Initialisieren der Datenbank:', error);
            this.updateStatus('Datenbank-Fehler', 'error');
        }
    }

    saveDatabase() {
        if (!this.db) return;
        
        try {
            const data = this.db.export();
            const dataArray = Array.from(data);
            localStorage.setItem('speedometer_db', JSON.stringify(dataArray));
            console.log('Datenbank in LocalStorage gespeichert');
        } catch (error) {
            console.error('Fehler beim Speichern der Datenbank:', error);
        }
    }

    clearDatabase() {
        if (!this.db) return;
        
        try {
            this.db.run('DELETE FROM trips');
            this.saveDatabase();
            this.loadTripHistory();
            console.log('Datenbank geleert');
            this.updateStatus('Alle Trips gelöscht', '');
        } catch (error) {
            console.error('Fehler beim Leeren der Datenbank:', error);
            this.updateStatus('Fehler beim Löschen', 'error');
        }
    }

    clearAllTrips() {
        if (!confirm('Möchten Sie wirklich ALLE Trips löschen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
            return;
        }
        
        this.clearDatabase();
    }

    bindEvents() {
        document.getElementById('startBtn').addEventListener('click', () => this.startTrip());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetTrip());
        document.getElementById('endBtn').addEventListener('click', () => this.endTrip());
        
    }

    async checkGPSPermission() {
        if (!navigator.geolocation) {
            this.updateStatus('GPS nicht unterstützt', 'error');
            return;
        }

        // Prüfe GPS-Berechtigung periodisch
        this.gpsCheckInterval = setInterval(async () => {
            // Stoppe Prüfung, wenn GPS bereits aktiviert wurde
            if (this.gpsPermissionGranted) {
                clearInterval(this.gpsCheckInterval);
                return;
            }

            try {
                const position = await this.getCurrentPosition();
                if (position && !this.gpsPermissionGranted) {
                    this.gpsPermissionGranted = true;
                    clearInterval(this.gpsCheckInterval);
                    this.updateStatus('GPS aktiviert - Bereit zum Starten', '');
                    document.getElementById('startBtn').disabled = false;
                }
            } catch (error) {
                // Prüfe den spezifischen Fehlertyp
                if (error.code === error.PERMISSION_DENIED) {
                    if (!this.gpsPermissionGranted) {
                        this.updateStatus('GPS-Berechtigung erforderlich - Bitte erlauben Sie den Standortzugriff', 'error');
                    }
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    // Position nicht verfügbar, aber Berechtigung könnte erteilt sein
                    if (!this.gpsPermissionGranted) {
                        this.updateStatus('GPS wird initialisiert...', 'tracking');
                    }
                } else if (error.code === error.TIMEOUT) {
                    // Timeout - Berechtigung könnte erteilt sein, aber Position nicht rechtzeitig erhalten
                    if (!this.gpsPermissionGranted) {
                        this.updateStatus('GPS wird initialisiert...', 'tracking');
                    }
                }
            }
        }, 3000); // Alle 3 Sekunden prüfen
    }

    // Alternative Methode zur GPS-Berechtigungsprüfung
    async requestGPSPermission() {
        if (!navigator.geolocation) {
            this.updateStatus('GPS nicht unterstützt', 'error');
            return false;
        }

        this.updateStatus('GPS-Berechtigung wird angefordert...', 'tracking');
        
        try {
            const position = await this.getCurrentPosition();
            this.gpsPermissionGranted = true;
            this.updateStatus('GPS aktiviert - Bereit zum Starten', '');
            document.getElementById('startBtn').disabled = false;
            return true;
        } catch (error) {
            this.handleLocationError(error);
            return false;
        }
    }

    async startTrip() {
        if (!navigator.geolocation) {
            this.updateStatus('GPS nicht unterstützt', 'error');
            return;
        }

        // Prüfe GPS-Berechtigung vor dem Start
        if (!this.gpsPermissionGranted) {
            const permissionGranted = await this.requestGPSPermission();
            if (!permissionGranted) {
                return;
            }
        }

        if (this.isTracking && !this.isPaused) {
            // Aktiver Trip: Pausieren
            this.pauseTrip();
        } else if (this.isPaused) {
            // Pausierter Trip: Fortsetzen
            this.resumeTrip();
        } else {
            // Kein Trip: Neuen Trip starten
            this.startNewTrip();
        }
    }

    startNewTrip() {
        this.isTracking = true;
        this.isPaused = false;
        this.totalPauseTime = 0;
        this.tripStats = {
            startTime: new Date(),
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
            minElevation: null,
            maxElevation: null,
            elevationGain: 0,
            startLocation: 'Unbekannt',
            endLocation: 'Unbekannt',
            positions: []
        };

        this.updateStatus('Trip gestartet - GPS wird aktiviert...', 'tracking');
        this.updateButtons(true, true, true);

        // Starte GPS-Tracking
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 1000
        };

        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.updatePosition(position),
            (error) => this.handleLocationError(error),
            options
        );

        // Hole sofort die aktuelle Position für Start-Ort
        this.getCurrentPosition().then((position) => {
            if (position && position.coords) {
                this.lookupLocationName(position.coords.latitude, position.coords.longitude, 'start');
            }
        }).catch((error) => {
            console.error('Fehler beim Abrufen der Startposition:', error);
        });
    }

    pauseTrip() {
        if (!this.isTracking || this.isPaused) return;

        this.isPaused = true;
        this.pauseStartTime = new Date();
        
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        this.updateStatus('Trip pausiert', '');
        this.updateButtons(true, true, true);
        
        // Button-Symbol ändern
        document.getElementById('startBtn').textContent = '▶';
        document.getElementById('startBtn').title = 'Fortsetzen';
    }

    resumeTrip() {
        if (!this.isPaused) return;

        // Berechne Pausenzeit
        if (this.pauseStartTime) {
            this.totalPauseTime += Date.now() - this.pauseStartTime.getTime();
            this.pauseStartTime = null;
        }

        this.isPaused = false;
        
        // Starte GPS-Tracking wieder
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 1000
        };

        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.updatePosition(position),
            (error) => this.handleLocationError(error),
            options
        );

        this.updateStatus('Trip fortgesetzt', 'tracking');
        this.updateButtons(true, true, true);
        
        // Button-Symbol zurücksetzen
        document.getElementById('startBtn').textContent = '⏸';
        document.getElementById('startBtn').title = 'Pausieren';
    }

    getCurrentPosition() {
        return new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    this.updatePosition(position);
                    resolve(position);
                },
                (error) => reject(error),
                {
                    enableHighAccuracy: true,
                    timeout: 5000,
                    maximumAge: 30000
                }
            );
        });
    }

    updatePosition(position) {
        const { latitude, longitude, altitude, speed, accuracy } = position.coords;
        
        // GPS-Berechtigung als erteilt markieren, wenn Position empfangen wird
        if (!this.gpsPermissionGranted) {
            this.gpsPermissionGranted = true;
            clearInterval(this.gpsCheckInterval);
            this.updateStatus('GPS aktiviert - Bereit zum Starten', '');
            document.getElementById('startBtn').disabled = false;
        }
        
        // Nur Positionen während aktiver Verfolgung speichern
        if (this.isTracking && !this.isPaused) {
            // Speichere Position
            this.tripStats.positions.push({
                lat: latitude,
                lng: longitude,
                alt: altitude || 0,
                timestamp: Date.now()
            });

            // Berechne Geschwindigkeit (falls nicht verfügbar)
            let currentSpeed = speed;
            if (speed === null && this.lastPosition) {
                currentSpeed = this.calculateSpeed(this.lastPosition, { lat: latitude, lng: longitude });
            }

            // Aktualisiere Statistiken
            this.tripStats.currentSpeed = currentSpeed || 0;
            this.tripStats.maxSpeed = Math.max(this.tripStats.maxSpeed, this.tripStats.currentSpeed);
            this.tripStats.elevation = altitude || 0;
            
            // Höhenverfolgung
            if (altitude !== null && altitude !== undefined) {
                if (this.tripStats.minElevation === null || altitude < this.tripStats.minElevation) {
                    this.tripStats.minElevation = altitude;
                }
                if (this.tripStats.maxElevation === null || altitude > this.tripStats.maxElevation) {
                    this.tripStats.maxElevation = altitude;
                }
                
                // Berechne Höhenunterschied
                if (this.tripStats.minElevation !== null && this.tripStats.maxElevation !== null) {
                    this.tripStats.elevationGain = this.tripStats.maxElevation - this.tripStats.minElevation;
                }
            }

            // Berechne Distanz
            if (this.lastPosition) {
                const distance = this.calculateDistance(
                    this.lastPosition.lat, this.lastPosition.lng,
                    latitude, longitude
                );
                this.tripStats.totalDistance += distance;
            }

            // Berechne Durchschnittsgeschwindigkeit
            this.calculateAverageSpeed();

            // Aktualisiere UI
            this.updateUI();
            this.lastPosition = { lat: latitude, lng: longitude };
        }
    }

    calculateSpeed(pos1, pos2) {
        const distance = this.calculateDistance(pos1.lat, pos1.lng, pos2.lat, pos2.lng);
        const timeDiff = (Date.now() - (this.tripStats.positions[this.tripStats.positions.length - 2]?.timestamp || Date.now())) / 1000;
        return timeDiff > 0 ? (distance / timeDiff) * 3.6 : 0; // km/h
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371; // Erdradius in km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    calculateAverageSpeed() {
        if (this.tripStats.positions.length < 2 || !this.tripStats.startTime) return;
        
        // Berechne aktuelle Pausenzeit
        let currentPauseTime = 0;
        if (this.isPaused && this.pauseStartTime) {
            currentPauseTime = Date.now() - this.pauseStartTime.getTime();
        }
        
        const totalPauseTime = this.totalPauseTime + currentPauseTime;
        const totalTime = (Date.now() - this.tripStats.startTime.getTime() - totalPauseTime) / 1000 / 3600; // Stunden
        this.tripStats.avgSpeed = totalTime > 0 ? this.tripStats.totalDistance / totalTime : 0;
    }

    updateUI() {
        // Aktuelle Geschwindigkeit
        const speedElement = document.getElementById('currentSpeed');
        const speed = Math.round(this.tripStats.currentSpeed);
        speedElement.textContent = speed;
        
        // Speedometer-Progress
        const progress = (speed / 300) * 100;
        const progressElement = document.getElementById('speedProgress');
        progressElement.style.background = `conic-gradient(
            from 0deg,
            #00d4ff 0deg,
            #00ff88 ${progress * 0.9}deg,
            #ffd700 ${progress * 0.95}deg,
            #ff6b6b ${progress}deg,
            #333 ${progress}deg,
            #333 360deg
        )`;

        // Statistiken
        document.getElementById('avgSpeed').textContent = `${Math.round(this.tripStats.avgSpeed)} km/h`;
        document.getElementById('maxSpeed').textContent = `${Math.round(this.tripStats.maxSpeed)} km/h`;
        document.getElementById('distance').textContent = `${this.tripStats.totalDistance.toFixed(2)} km`;
        document.getElementById('elevation').textContent = `${Math.round(this.tripStats.elevation)} m`;
        
        // Höhenunterschied anzeigen
        const elevationGain = this.tripStats.elevationGain || 0;
        document.getElementById('elevationGain').textContent = `+${Math.round(elevationGain)} m`;
        
        // Dauer (ohne Pausenzeit)
        let currentPauseTime = 0;
        if (this.isPaused && this.pauseStartTime) {
            currentPauseTime = Date.now() - this.pauseStartTime.getTime();
        }
        const totalPauseTime = this.totalPauseTime + currentPauseTime;
        
        // Prüfe ob startTime existiert
        if (this.tripStats.startTime) {
            const duration = this.formatDuration(Date.now() - this.tripStats.startTime.getTime() - totalPauseTime);
            document.getElementById('duration').textContent = duration;
        } else {
            document.getElementById('duration').textContent = '00:00:00';
        }

        // Speedometer-Animation
        const speedometer = document.querySelector('.speedometer');
        if (speed > 0) {
            speedometer.classList.add('tracking');
        } else {
            speedometer.classList.remove('tracking');
        }
    }

    formatDuration(milliseconds) {
        const seconds = Math.floor(milliseconds / 1000);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    async endTrip() {
        if (!this.isTracking) {
            console.log('Kein aktiver Trip zum Beenden');
            return;
        }

        console.log('Beende Trip...');
        this.isTracking = false;
        this.isPaused = false;
        
        // Berechne finale Pausenzeit
        if (this.pauseStartTime) {
            this.totalPauseTime += Date.now() - this.pauseStartTime.getTime();
            this.pauseStartTime = null;
        }
        
        this.tripStats.endTime = new Date();
        
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        // OSM-Lookup für Endpunkt
        const lastPos = this.tripStats.positions[this.tripStats.positions.length - 1];
        if (lastPos) {
            await this.lookupLocationName(lastPos.lat, lastPos.lng, 'end');
        }

        // Speichere Trip in Datenbank
        await this.saveTrip();

        this.updateStatus('Trip beendet und gespeichert', '');
        
        // Lade Historie neu
        this.loadTripHistory();
        
        // Reset nur UI und Statistiken, aber behalte System bereit für manuellen Start
        console.log('Rufe resetAfterTrip() auf...');
        this.resetAfterTrip();
    }

    resetTrip() {
        if (this.isTracking) {
            // Während eines Trips: Trip neu starten
            this.restartTrip();
        } else {
            // Kein aktiver Trip: Kompletter Reset
            this.fullReset();
        }
    }

    restartTrip() {
        // Stoppe aktuellen Trip
        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        // Reset Trip-Statistiken
        this.tripStats = {
            startTime: new Date(),
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
            minElevation: null,
            maxElevation: null,
            elevationGain: 0,
            startLocation: 'Unbekannt',
            endLocation: 'Unbekannt',
            positions: []
        };
        
        // Reset Pausenzeit
        this.totalPauseTime = 0;
        this.pauseStartTime = null;
        this.isPaused = false;

        this.updateStatus('Trip neu gestartet', 'tracking');
        this.updateButtons(true, true, true);
        
        // Starte GPS-Tracking neu
        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 1000
        };

        this.watchId = navigator.geolocation.watchPosition(
            (position) => this.updatePosition(position),
            (error) => this.handleLocationError(error),
            options
        );

        // Hole sofort die aktuelle Position für Start-Ort
        this.getCurrentPosition().then((position) => {
            if (position && position.coords) {
                this.lookupLocationName(position.coords.latitude, position.coords.longitude, 'start');
            }
        }).catch((error) => {
            console.error('Fehler beim Abrufen der Startposition:', error);
        });
    }

    resetAfterTrip() {
        console.log('resetAfterTrip() wird ausgeführt...');
        // Reset nur UI und Statistiken, aber behalte GPS-Berechtigung
        // Erstelle eine Kopie der aktuellen tripStats für die Anzeige
        const currentTripStats = { ...this.tripStats };
        
        // Setze Tracking-Status explizit auf false
        this.isTracking = false;
        this.isPaused = false;
        this.totalPauseTime = 0;
        this.pauseStartTime = null;
        
        // Reset tripStats für den nächsten Trip
        this.tripStats = {
            startTime: null,
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
            minElevation: null,
            maxElevation: null,
            elevationGain: 0,
            startLocation: 'Unbekannt',
            endLocation: 'Unbekannt',
            positions: []
        };

        this.updateUI();
        this.updateStatus('Trip beendet - Bereit für neuen Trip', '');
        
        // Button-Zustände explizit setzen
        this.updateButtons(true, false, false);
        
        // Button-Symbole explizit setzen (da updateButtons() auf isTracking basiert)
        document.getElementById('startBtn').textContent = '▶';
        document.getElementById('startBtn').title = 'Trip Starten';
        document.getElementById('resetBtn').textContent = '↻';
        document.getElementById('resetBtn').title = 'Reset';
        document.getElementById('endBtn').textContent = '⏹';
        document.getElementById('endBtn').title = 'Trip Beenden';
        
        // Reset UI
        document.getElementById('currentSpeed').textContent = '0';
        document.getElementById('avgSpeed').textContent = '0 km/h';
        document.getElementById('maxSpeed').textContent = '0 km/h';
        document.getElementById('distance').textContent = '0.0 km';
        document.getElementById('elevation').textContent = '0 m';
        document.getElementById('elevationGain').textContent = '+0 m';
        document.getElementById('duration').textContent = '00:00:00';
        
        const speedometer = document.querySelector('.speedometer');
        speedometer.classList.remove('tracking');
    }

    fullReset() {
        this.isTracking = false;
        this.isPaused = false;
        this.totalPauseTime = 0;
        this.pauseStartTime = null;
        this.tripStats = {
            startTime: null,
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
            minElevation: null,
            maxElevation: null,
            elevationGain: 0,
            startLocation: 'Unbekannt',
            endLocation: 'Unbekannt',
            positions: []
        };

        if (this.watchId) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }

        this.updateUI();
        this.updateStatus('Bereit zum Starten', '');
        this.updateButtons(false, true, false);
        
        // Reset UI
        document.getElementById('currentSpeed').textContent = '0';
        document.getElementById('avgSpeed').textContent = '0 km/h';
        document.getElementById('maxSpeed').textContent = '0 km/h';
        document.getElementById('distance').textContent = '0.0 km';
        document.getElementById('elevation').textContent = '0 m';
        document.getElementById('elevationGain').textContent = '+0 m';
        document.getElementById('duration').textContent = '00:00:00';
        
        const speedometer = document.querySelector('.speedometer');
        speedometer.classList.remove('tracking');
        
        // Starte GPS-Berechtigungsprüfung neu
        this.gpsPermissionGranted = false;
        this.checkGPSPermission();
    }

    async lookupLocationName(lat, lng, type) {
        if (!lat || !lng) return;

        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
            );
            const data = await response.json();
            
            if (data && data.display_name) {
                const locationName = this.formatLocationName(data);
                if (type === 'start') {
                    this.tripStats.startLocation = locationName;
                } else if (type === 'end') {
                    this.tripStats.endLocation = locationName;
                }
            }
        } catch (error) {
            console.error('Fehler beim OSM-Lookup:', error);
        }
    }

    formatLocationName(data) {
        const address = data.address || {};
        const parts = [];
        
        // Priorisiere POIs (Points of Interest)
        const poiTypes = [
            'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court',
            'hotel', 'guest_house', 'hostel', 'motel',
            'shop', 'supermarket', 'mall', 'marketplace',
            'fuel', 'bank', 'atm', 'pharmacy', 'hospital', 'clinic',
            'school', 'university', 'college', 'kindergarten',
            'place_of_worship', 'church', 'mosque', 'temple', 'synagogue',
            'museum', 'gallery', 'theatre', 'cinema', 'library',
            'park', 'playground', 'sports_centre', 'gym', 'swimming_pool',
            'station', 'bus_station', 'subway_entrance', 'tram_stop',
            'airport', 'ferry_terminal', 'parking', 'car_wash',
            'office', 'company', 'factory', 'warehouse',
            'attraction', 'monument', 'memorial', 'castle', 'palace'
        ];
        
        // Suche nach POI-Typen in der Adresse
        let poiName = null;
        for (const poiType of poiTypes) {
            if (address[poiType]) {
                poiName = address[poiType];
                break;
            }
        }
        
        // Wenn POI gefunden, verwende ihn als Hauptname
        if (poiName) {
            parts.push(poiName);
        } else {
            // Fallback auf Straße und Hausnummer
            if (address.road) parts.push(address.road);
            if (address.house_number) parts.push(address.house_number);
        }
        
        // Stadt/Ortsname hinzufügen
        if (address.city || address.town || address.village) {
            parts.push(address.city || address.town || address.village);
        }
        
        // Bundesland hinzufügen
        if (address.state) parts.push(address.state);
        
        return parts.length > 0 ? parts.join(', ') : data.display_name.split(',')[0];
    }

    async saveTrip() {
        if (!this.db) {
            console.error('Datenbank nicht verfügbar');
            return;
        }

        try {
            // Debug: Log tripStats vor dem Speichern
            console.log('Speichere Trip mit folgenden Daten:', {
                startTime: this.tripStats.startTime,
                endTime: this.tripStats.endTime,
                totalDistance: this.tripStats.totalDistance,
                startLocation: this.tripStats.startLocation,
                endLocation: this.tripStats.endLocation
            });

            // Berechne Dauer ohne Pausenzeit
            const totalTime = this.tripStats.endTime ? 
                this.tripStats.endTime.getTime() - this.tripStats.startTime.getTime() - this.totalPauseTime : 
                Date.now() - this.tripStats.startTime.getTime() - this.totalPauseTime;
            const duration = this.formatDuration(totalTime);

            this.db.run(`
                INSERT INTO trips (
                    start_time, end_time, duration, total_distance, max_speed, 
                    avg_speed, elevation, min_elevation, max_elevation, elevation_gain, 
                    start_location, end_location
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                this.tripStats.startTime.toISOString(),
                this.tripStats.endTime?.toISOString() || null,
                duration,
                this.tripStats.totalDistance,
                this.tripStats.maxSpeed,
                this.tripStats.avgSpeed,
                this.tripStats.elevation,
                this.tripStats.minElevation || 0,
                this.tripStats.maxElevation || 0,
                this.tripStats.elevationGain || 0,
                this.tripStats.startLocation,
                this.tripStats.endLocation
            ]);

            // Speichere Datenbank nach Änderung
            this.saveDatabase();
            console.log('Trip erfolgreich gespeichert');
        } catch (error) {
            console.error('Fehler beim Speichern des Trips:', error);
        }
    }

    loadTripHistory() {
        if (!this.db) return;

        try {
            const stmt = this.db.prepare(`
                SELECT * FROM trips 
                ORDER BY created_at DESC 
                LIMIT 10
            `);
            
            const trips = [];
            while (stmt.step()) {
                trips.push(stmt.getAsObject());
            }
            stmt.free();

            this.displayTripHistory(trips);
        } catch (error) {
            console.error('Fehler beim Laden der Trip-Historie:', error);
        }
    }

    displayTripHistory(trips) {
        const historyList = document.getElementById('historyList');
        
        if (trips.length === 0) {
            historyList.innerHTML = '<div class="no-trips">Keine Trips gespeichert</div>';
            return;
        }

        historyList.innerHTML = trips.map(trip => `
            <div class="trip-item" data-trip-id="${trip.id}">
                <div class="trip-header">
                    <div class="trip-date">${new Date(trip.created_at).toLocaleDateString('de-DE')}</div>
                    <button class="btn-delete" data-trip-id="${trip.id}" title="Trip löschen">✕</button>
                </div>
                <div class="trip-route">${trip.start_location} → ${trip.end_location}</div>
                <div class="trip-stats">
                    <div class="trip-stat">
                        <div class="trip-stat-label">Distanz</div>
                        <div class="trip-stat-value">${trip.total_distance.toFixed(1)} km</div>
                    </div>
                    <div class="trip-stat">
                        <div class="trip-stat-label">Dauer</div>
                        <div class="trip-stat-value">${trip.duration}</div>
                    </div>
                    <div class="trip-stat">
                        <div class="trip-stat-label">Max</div>
                        <div class="trip-stat-value">${Math.round(trip.max_speed)} km/h</div>
                    </div>
                    <div class="trip-stat">
                        <div class="trip-stat-label">Höhe</div>
                        <div class="trip-stat-value">+${Math.round(trip.elevation_gain || 0)} m</div>
                    </div>
                </div>
            </div>
        `).join('');

        // Event-Listener für Löschen-Buttons hinzufügen
        historyList.querySelectorAll('.btn-delete').forEach(button => {
            button.addEventListener('click', (e) => {
                const tripId = parseInt(e.target.getAttribute('data-trip-id'));
                this.deleteTrip(tripId);
            });
        });
    }

    async deleteTrip(tripId) {
        if (!this.db) return;
        
        if (!confirm('Möchten Sie diesen Trip wirklich löschen?')) {
            return;
        }

        try {
            this.db.run('DELETE FROM trips WHERE id = ?', [tripId]);
            
            // Speichere Datenbank nach Änderung
            this.saveDatabase();
            console.log('Trip gelöscht');
            
            // Lade Historie neu
            this.loadTripHistory();
            
            this.updateStatus('Trip gelöscht', '');
        } catch (error) {
            console.error('Fehler beim Löschen des Trips:', error);
            this.updateStatus('Fehler beim Löschen', 'error');
        }
    }

    updateButtons(startEnabled, resetEnabled, endEnabled) {
        const startBtn = document.getElementById('startBtn');
        startBtn.disabled = !startEnabled;
        
        // Button-Symbol basierend auf Trip-Status setzen
        if (this.isTracking && !this.isPaused) {
            startBtn.textContent = '⏸';
            startBtn.title = 'Pausieren';
        } else if (this.isPaused) {
            startBtn.textContent = '▶';
            startBtn.title = 'Fortsetzen';
        } else {
            startBtn.textContent = '▶';
            startBtn.title = 'Trip Starten';
        }
        
        document.getElementById('resetBtn').disabled = !resetEnabled;
        document.getElementById('endBtn').disabled = !endEnabled;
        
        // End-Button Symbol setzen
        const endBtn = document.getElementById('endBtn');
        endBtn.textContent = '⏹';
        endBtn.title = 'Trip Beenden';
        
        // Reset-Button Symbol anpassen
        const resetBtn = document.getElementById('resetBtn');
        if (this.isTracking) {
            resetBtn.textContent = '↻';
            resetBtn.title = 'Neu starten';
        } else {
            resetBtn.textContent = '↻';
            resetBtn.title = 'Reset';
        }
    }

    updateStatus(message, type = '') {
        const statusElement = document.getElementById('status');
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
    }

    handleLocationError(error) {
        let message = 'GPS-Fehler: ';
        switch(error.code) {
            case error.PERMISSION_DENIED:
                message += 'Zugriff verweigert - Bitte erlauben Sie den Standortzugriff in den Browser-Einstellungen';
                break;
            case error.POSITION_UNAVAILABLE:
                message += 'Position nicht verfügbar - GPS-Signal zu schwach';
                break;
            case error.TIMEOUT:
                message += 'Timeout - GPS-Signal wird gesucht...';
                break;
            default:
                message += 'Unbekannter Fehler';
                break;
        }
        
        this.updateStatus(message, 'error');
        this.isTracking = false;
        this.updateButtons(false, true, false);
    }
}

// App starten wenn DOM geladen ist
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new SpeedometerApp();
});
