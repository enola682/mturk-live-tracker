const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });
const cors = require('cors');
const axios = require('axios');
const path = require('path');

app.use(cors());
app.use(express.json());

// ড্যাশবোর্ড ফাইলগুলো লোড করার জন্য রুট পাথ সেটআপ
app.use(express.static(path.join(__dirname, '/')));

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {};

// গুগল শিট থেকে নাম ও টিম রিয়েল-টাইমে টেনে আনা
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
                    username: row.c[1]?.v ? row.c[1].v.toString().trim() : "Unknown", 
                    team: row.c[2]?.v ? row.c[2].v.toString().trim() : "Team" 
                };
            }
        });
        userTeams = updatedTeams;
        console.log("Sync Done. Workers Loaded:", Object.keys(userTeams).length);
    } catch (e) { 
        console.log("Google Sheet Sync Error:", e.message); 
    }
}

// প্রতি ৩০ সেকেন্ড পরপর শিট আপডেট করবে
setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

// আরডিপি (RDP) থেকে হিট রিসিভ করার এন্ডপয়েন্ট
app.post('/api/update-hits', (req, res) => {
    const hits = req.body.hits || [];
    
    // প্রতিটা হিটের সাথে শিট থেকে নাম এবং টিম ম্যাচ করানো (প্রধান ফিক্স)
    const processedHits = hits.map(hit => {
        const info = userTeams[hit.workerId.trim()] || { username: hit.workerId, team: 'Unknown' };
        return { 
            ...hit, 
            username: info.username, 
            team: info.team 
        };
    });
    
    io.emit('dashboard-update', { liveHits: processedHits });
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
