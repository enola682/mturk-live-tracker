const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// স্ট্যাটিক ফোল্ডার সেটআপ
app.use(express.static(path.join(__dirname, '/')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {}; 
let liveHits = []; 

// গুগল শিট থেকে ডেটা সিঙ্ক করা
async function syncGoogleSheet() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`;
        const response = await axios.get(url);
        const jsonText = response.data.substring(response.data.indexOf('(') + 1, response.data.lastIndexOf(')'));
        const data = JSON.parse(jsonText);
        
        let updatedTeams = {};
        data.table.rows.forEach(row => {
            const id = row.c[0]?.v ? row.c[0].v.toString().trim() : null;
            if (id) {
                updatedTeams[id] = { 
                    username: row.c[1]?.v ? row.c[1].v.toString() : "Unknown", 
                    team: row.c[2]?.v ? row.c[2].v.toString().trim() : "Team" 
                };
            }
        });
        userTeams = updatedTeams;
        console.log("Sync Done. Workers:", Object.keys(userTeams).length);
    } catch (e) { console.log("Sync Error"); }
}

setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

// আরডিপি থেকে হিট রিসিভ করা
app.post('/api/update-hits', (req, res) => {
    const hits = req.body.hits || [];
    hits.forEach(hit => {
        const info = userTeams[hit.workerId] || { username: hit.workerId, team: 'Unknown' };
        hit.username = info.username;
        hit.team = info.team;
        
        const idx = liveHits.findIndex(h => h.title === hit.title && h.workerId === hit.workerId);
        if (idx > -1) liveHits[idx] = hit;
        else liveHits.unshift(hit);
    });
    
    io.emit('dashboard-update', { liveHits });
    res.sendStatus(200);
});

// ডাটাবেস রিসেট করা
app.post('/api/reset', (req, res) => {
    liveHits = [];
    io.emit('dashboard-update', { liveHits });
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
