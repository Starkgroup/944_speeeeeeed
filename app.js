class SpeedometerApp {
    constructor() {
        this.isTracking = false;
        this.currentTrip = null;
        this.watchId = null;
        this.db = null;
        this.lastPosition = null;
        this.tripStats = {
            startTime: null,
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
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
        this.updateStatus('Bereit zum Starten');
    }

    async initDatabase() {
        try {
            const SQL = await initSqlJs({
                locateFile: file => `https://unpkg.com/sql.js@1.8.0/dist/${file}`
            });
            
            this.db = new SQL.Database();
            
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
                    start_location TEXT,
                    end_location TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('Datenbank initialisiert');
        } catch (error) {
            console.error('Fehler beim Initialisieren der Datenbank:', error);
            this.updateStatus('Datenbank-Fehler', 'error');
        }
    }

    bindEvents() {
        document.getElementById('gpsBtn').addEventListener('click', () => this.requestGPSPermission());
        document.getElementById('startBtn').addEventListener('click', () => this.startTrip());
        document.getElementById('resetBtn').addEventListener('click', () => this.resetTrip());
        document.getElementById('endBtn').addEventListener('click', () => this.endTrip());
        
        // Editable Location Fields
        document.getElementById('startLocation').addEventListener('blur', (e) => {
            this.tripStats.startLocation = e.target.textContent;
        });
        
        document.getElementById('endLocation').addEventListener('blur', (e) => {
            this.tripStats.endLocation = e.target.textContent;
        });
    }

    async requestGPSPermission() {
        if (!navigator.geolocation) {
            this.updateStatus('GPS nicht unterstützt', 'error');
            return;
        }

        this.updateStatus('GPS-Berechtigung wird angefordert...', 'tracking');
        
        try {
            const position = await this.getCurrentPosition();
            this.updateStatus('GPS aktiviert - Bereit zum Starten', '');
            document.getElementById('gpsBtn').disabled = true;
            document.getElementById('gpsBtn').textContent = 'GPS ✓';
            document.getElementById('startBtn').disabled = false;
        } catch (error) {
            this.handleLocationError(error);
        }
    }

    async startTrip() {
        if (!navigator.geolocation) {
            this.updateStatus('GPS nicht unterstützt', 'error');
            return;
        }

        this.isTracking = true;
        this.tripStats = {
            startTime: new Date(),
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
            startLocation: 'Unbekannt',
            endLocation: 'Unbekannt',
            positions: []
        };

        this.updateStatus('Trip gestartet - GPS wird aktiviert...', 'tracking');
        this.updateButtons(false, false, true);

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

        // Starte OSM-Lookup für Startpunkt
        this.lookupLocationName(this.tripStats.positions[0]?.lat, this.tripStats.positions[0]?.lng, 'start');
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
                    timeout: 15000,
                    maximumAge: 0
                }
            );
        });
    }

    updatePosition(position) {
        const { latitude, longitude, altitude, speed, accuracy } = position.coords;
        
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
        if (this.tripStats.positions.length < 2) return;
        
        const totalTime = (Date.now() - this.tripStats.startTime.getTime()) / 1000 / 3600; // Stunden
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
        
        // Dauer
        const duration = this.formatDuration(Date.now() - this.tripStats.startTime.getTime());
        document.getElementById('duration').textContent = duration;

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
        if (!this.isTracking) return;

        this.isTracking = false;
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

        this.updateStatus('Trip beendet', '');
        this.updateButtons(false, true, false);
        
        // Lade Historie neu
        this.loadTripHistory();
    }

    resetTrip() {
        this.isTracking = false;
        this.tripStats = {
            startTime: null,
            endTime: null,
            totalDistance: 0,
            maxSpeed: 0,
            avgSpeed: 0,
            currentSpeed: 0,
            elevation: 0,
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
        document.getElementById('duration').textContent = '00:00:00';
        document.getElementById('startLocation').textContent = 'Unbekannt';
        document.getElementById('endLocation').textContent = 'Unbekannt';
        
        const speedometer = document.querySelector('.speedometer');
        speedometer.classList.remove('tracking');
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
                    document.getElementById('startLocation').textContent = locationName;
                } else if (type === 'end') {
                    this.tripStats.endLocation = locationName;
                    document.getElementById('endLocation').textContent = locationName;
                }
            }
        } catch (error) {
            console.error('Fehler beim OSM-Lookup:', error);
        }
    }

    formatLocationName(data) {
        const address = data.address || {};
        const parts = [];
        
        if (address.road) parts.push(address.road);
        if (address.house_number) parts.push(address.house_number);
        if (address.city || address.town || address.village) {
            parts.push(address.city || address.town || address.village);
        }
        if (address.state) parts.push(address.state);
        
        return parts.length > 0 ? parts.join(', ') : data.display_name.split(',')[0];
    }

    async saveTrip() {
        if (!this.db) return;

        try {
            const duration = this.tripStats.endTime ? 
                this.formatDuration(this.tripStats.endTime.getTime() - this.tripStats.startTime.getTime()) : 
                this.formatDuration(Date.now() - this.tripStats.startTime.getTime());

            this.db.run(`
                INSERT INTO trips (
                    start_time, end_time, duration, total_distance, max_speed, 
                    avg_speed, elevation, start_location, end_location
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                this.tripStats.startTime.toISOString(),
                this.tripStats.endTime?.toISOString() || null,
                duration,
                this.tripStats.totalDistance,
                this.tripStats.maxSpeed,
                this.tripStats.avgSpeed,
                this.tripStats.elevation,
                this.tripStats.startLocation,
                this.tripStats.endLocation
            ]);

            console.log('Trip gespeichert');
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
            <div class="trip-item">
                <div class="trip-header">
                    <div class="trip-date">${new Date(trip.created_at).toLocaleDateString('de-DE')}</div>
                </div>
                <div class="trip-route">${trip.start_location} → ${trip.end_location}</div>
                <div class="trip-stats">
                    <div class="trip-stat">
                        <div class="trip-stat-label">Distanz</div>
                        <div class="trip-stat-value">${trip.total_distance.toFixed(1)} km</div>
                    </div>
                    <div class="trip-stat">
                        <div class="trip-stat-label">Max</div>
                        <div class="trip-stat-value">${Math.round(trip.max_speed)} km/h</div>
                    </div>
                    <div class="trip-stat">
                        <div class="trip-stat-label">Dauer</div>
                        <div class="trip-stat-value">${trip.duration}</div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    updateButtons(startEnabled, resetEnabled, endEnabled) {
        document.getElementById('startBtn').disabled = !startEnabled;
        document.getElementById('resetBtn').disabled = !resetEnabled;
        document.getElementById('endBtn').disabled = !endEnabled;
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
                message += 'Zugriff verweigert';
                break;
            case error.POSITION_UNAVAILABLE:
                message += 'Position nicht verfügbar';
                break;
            case error.TIMEOUT:
                message += 'Timeout';
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
document.addEventListener('DOMContentLoaded', () => {
    new SpeedometerApp();
});
