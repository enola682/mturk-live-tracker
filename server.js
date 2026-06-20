const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// ড্যাশবোর্ড ফাইল দেখানোর ব্যবস্থা (এটিই Missing ছিল)
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
        console.log("Sync Successful! Active Workers found:", Object.keys(userTeams).length);
    } catch (e) { console.log("Sync Error:", e); }
}

setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

app.post('/api/update-hits', (req, res) => {
    req.body.hits.forEach(hit => {
        if (!hit.title || hit.title === "Show Details" || hit.title.includes("Queue")) return;
        const info = userTeams[hit.workerId] || { username: hit.workerId, team: 'Unknown Team' };
        hit.username = info.username;
        hit.team = info.team;
        const idx = liveHits.findIndex(h => h.title === hit.title && h.workerId === hit.workerId);
        if (idx > -1) liveHits[idx] = { ...liveHits[idx], ...hit };
        else liveHits.unshift(hit);
    });
    io.emit('dashboard-update', { liveHits });
    res.sendStatus(200);
});

app.post('/api/reset', (req, res) => { liveHits = []; io.emit('dashboard-update', { liveHits }); res.sendStatus(200); });
server.listen(process.env.PORT || 5000, () => console.log('Server running...'));
