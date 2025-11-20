const express = require('express');
const path = require('path');

const app = express();
const PORT = 9443;

// Statische Dateien servieren
app.use(express.static(__dirname));

// Alle Routen auf index.html umleiten (für SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`Öffne http://localhost:${PORT} im Browser`);
});

