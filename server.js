const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { cors: { origin: "*" } });
const cors = require('cors');
const axios = require('axios');
const path = require('path');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {};
let databaseHits = []; 

// গুগল শিট ডাটা ১০০% নিশ্চিত করার উন্নত মেথড
async function syncGoogleSheet() {
    try {
        // গুগল শিটের ক্যাশ এড়াতে প্রতিবার টাইমস্ট্যাম্প যোগ করা হয়েছে
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`;
        const response = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
        const jsonText = response.data.substring(response.data.indexOf('(') + 1, response.data.lastIndexOf(')'));
        const data = JSON.parse(jsonText);
        
        let updatedTeams = {};
        data.table.rows.forEach(row => {
            if (row.c && row.c[0]) {
                const id = row.c[0].v ? row.c[0].v.toString().trim().toUpperCase() : null; // Case-insensitive matching
                const username = row.c[1] && row.c[1].v ? row.c[1].v.toString().trim() : "Unknown";
                const team = row.c[2] && row.c[2].v ? row.c[2].v.toString().trim() : "Unknown Team";
                
                if (id) {
                    updatedTeams[id] = { username: username, team: team };
                }
            }
        });
        userTeams = updatedTeams;
        console.log("Sheet Connected Successfully. Total valid rows loaded:", Object.keys(userTeams).length);
    } catch (e) { 
        console.log("Google Sheet Critical Sync Error:", e.message); 
    }
}

// প্রতি ৩০ সেকেন্ডে শিট রিলোড হবে
setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

app.post('/api/update-hits', (req, res) => {
    const incoming = req.body.hits || [];
    
    incoming.forEach(hit => {
        if (!hit.workerId || hit.workerId.toString().trim() === "" || hit.workerId === "COPIED") return;
        
        const wIdClean = hit.workerId.toString().trim().toUpperCase();
        const info = userTeams[wIdClean] || { username: hit.workerId, team: "Unknown Team" };
        
        const newRecord = {
            workerId: hit.workerId.toString().trim(),
            username: info.username,
            team: info.team,
            requester: hit.requester || 'N/A',
            title: hit.title || 'No Title',
            reward: hit.reward || '$0.00',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: hit.timeLeft || '-',
            status: hit.status || 'Active',
            timestamp: Date.now()
        };

        // ইউনিক আইডি ও টাইটেল দিয়ে ইনসার্ট অথবা আপডেট ট্র্যাকিং
        const idx = databaseHits.findIndex(h => h.workerId.toUpperCase() === wIdClean && h.title === hit.title);
        if (idx > -1) {
            databaseHits[idx] = { ...databaseHits[idx], ...newRecord };
        } else {
            databaseHits.unshift(newRecord);
        }
    });

    // ডাটা হিস্ট্রি ধরে রাখার সাইজ সীমা বৃদ্ধি (সর্বোচ্চ ৩০০০ রেকর্ড)
    if (databaseHits.length > 3000) databaseHits = databaseHits.slice(0, 3000);

    io.emit('dashboard-update', { liveHits: databaseHits });
    res.sendStatus(200);
});

app.post('/api/reset', (req, res) => {
    databaseHits = [];
    io.emit('dashboard-update', { liveHits: [] });
    res.sendStatus(200);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

http.listen(process.env.PORT || 10000, '0.0.0.0', () => console.log('Server is fully responsive'));
