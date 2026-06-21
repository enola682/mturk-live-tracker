const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    cors: { origin: "*" },
    transports: ["websocket", "polling"]
});
const cors = require('cors');
const axios = require('axios');
const path = require('path');

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {};
let databaseHits = []; 

// গুগল শিট ডেটা অটো সিঙ্ক
async function syncGoogleSheet() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`;
        const response = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
        const jsonText = response.data.substring(response.data.indexOf('(') + 1, response.data.lastIndexOf(')'));
        const data = JSON.parse(jsonText);
        
        let updatedTeams = {};
        data.table.rows.forEach(row => {
            if (row.c && row.c[0]) {
                const id = row.c[0].v ? row.c[0].v.toString().trim().toUpperCase() : null;
                const username = row.c[1] && row.c[1].v ? row.c[1].v.toString().trim() : "Unknown";
                const team = row.c[2] && row.c[2].v ? row.c[2].v.toString().trim() : "Unknown Team";
                
                if (id) {
                    updatedTeams[id] = { username: username, team: team };
                }
            }
        });
        userTeams = updatedTeams;
        console.log("Google Sheet Connected. Total Loaded: ", Object.keys(userTeams).length);
    } catch (e) { 
        console.log("Google Sheet Sync Error: ", e.message); 
    }
}

setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

// রুট রাউট ফিক্স (Cannot GET / এরর বন্ধ)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// লাইভ ডেটা রিসিভার এপিআই
app.post('/api/update-hits', (req, res) => {
    const incoming = req.body.hits || [];
    
    incoming.forEach(hit => {
        // যদি workerId একদম ফাঁকা থাকে তবেই শুধু বাদ যাবে, নতুবা ডাটা প্রসেস হবে
        if (!hit.workerId || hit.workerId.toString().trim() === "") return;
        
        const rawId = hit.workerId.toString().trim();
        const wIdClean = rawId.toUpperCase();
        
        // শিটে আইডি না মিললে এক্সটেনশনের পাঠানো ইউজারনেম অথবা আইডটাই নাম হিসেবে ব্যাকআপ থাকবে
        const info = userTeams[wIdClean] || { 
            username: hit.username || rawId, 
            team: "Unknown" 
        };
        
        const newRecord = {
            workerId: rawId,
            username: hit.username || info.username, 
            workerName: info.username, 
            team: info.team,
            requester: hit.requester || 'N/A',
            title: hit.title || 'No Title',
            reward: hit.reward || '$0.00',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: hit.timeLeft || '-',
            status: hit.status || 'Active',
            timestamp: Date.now()
        };

        // ইউনিক ডেটা হ্যান্ডলিং (আইডি এবং টাইটেল দিয়ে ইউনিক ফিল্টার)
        const idx = databaseHits.findIndex(h => h.workerId.toUpperCase() === wIdClean && h.title === hit.title);
        if (idx > -1) {
            databaseHits[idx] = { ...databaseHits[idx], ...newRecord };
        } else {
            databaseHits.unshift(newRecord);
        }
    });

    if (databaseHits.length > 2500) databaseHits = databaseHits.slice(0, 2500);

    // সকেটে রিয়েল-টাইম ব্রডকাস্ট
    io.emit('dashboard-update', { liveHits: databaseHits });
    res.sendStatus(200);
});

// ডাটাবেজ রিসেট এপিআই
app.post('/api/reset', (req, res) => {
    databaseHits = [];
    io.emit('dashboard-update', { liveHits: [] });
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Server Running on Port ${PORT}`));
