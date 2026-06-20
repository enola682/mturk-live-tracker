const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// সব স্ট্যাটিক ফাইল সার্ভ করবে
app.use(express.static(path.join(__dirname, '/')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {}; 
let liveHits = []; 

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
                    username: row.c[1]?.v ? row.c[1].v.toString() : id, 
                    team: row.c[2]?.v ? row.c[2].v.toString().trim() : 'Unknown Team' 
                };
            }
        });
        userTeams = updatedTeams;
    } catch (e) { console.log("Sync Error"); }
}

setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

app.post('/api/update-hits', (req, res) => {
    req.body.hits.forEach(hit => {
        if (!hit.title || hit.title.includes("Queue")) return;
        const info = userTeams[hit.workerId] || { username: hit.workerId, team: 'Unknown Team' };
        hit.username = info.username;
        hit.team = info.team;
        liveHits.unshift(hit);
        if(liveHits.length > 50) liveHits.pop();
    });
    io.emit('dashboard-update', { liveHits });
    res.sendStatus(200);
});

app.post('/api/reset', (req, res) => { liveHits = []; io.emit('dashboard-update', { liveHits }); res.sendStatus(200); });

// Render-এর জন্য সঠিক পোর্ট কনফিগারেশন
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
