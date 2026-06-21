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
app.use(express.static(path.join(__dirname, '/')));

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {};
let globalHitsList = []; // সমস্ত হিট জমা রাখার জন্য গ্লোবাল অ্যারে (যাতে ডিলিট না হয়)

// গুগল শিট ডেটা সিঙ্ক
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
        console.log("Sync Done. Workers:", Object.keys(userTeams).length);
    } catch (e) { 
        console.log("Sheet Sync Error:", e.message); 
    }
}

setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

// আরডিপি থেকে হিট ডাটা রিসিভ
app.post('/api/update-hits', (req, res) => {
    const incomingHits = req.body.hits || [];
    
    incomingHits.forEach(newHit => {
        const info = userTeams[newHit.workerId?.trim()] || { username: newHit.workerId, team: 'Unknown' };
        
        const processedHit = { 
            ...newHit, 
            username: info.username, 
            team: info.team,
            status: newHit.status || 'Active',
            requester: newHit.requester || 'N/A',
            timeLeft: newHit.timeLeft || 'Just Now',
            timestamp: Date.now() // ইউনিক ট্র্যাকিংয়ের জন্য
        };

        // আগের তালিকায় এই সেম হিট অলরেডি আছে কি না চেক করা (ডুপ্লিকেট আটকানো)
        const existingIndex = globalHitsList.findIndex(h => h.workerId === processedHit.workerId && h.title === processedHit.title);
        
        if (existingIndex > -1) {
            // থাকলে আপডেট করে দাও
            globalHitsList[existingIndex] = processedHit;
        } else {
            // না থাকলে তালিকার একদম শুরুতে (Top) যোগ করো
            globalHitsList.unshift(processedHit);
        }
    });

    // সর্বোচ্চ 999 টা হিট হিস্ট্রি ধরে রাখবে (সার্ভার স্লো হওয়া আটকাতে)
    if (globalHitsList.length > 200) {
        globalHitsList = globalHitsList.slice(0, 200);
    }
    
    // পুরো জমানো তালিকাটি ড্যাশবোর্ডে পাঠানো
    io.emit('dashboard-update', { liveHits: globalHitsList });
    res.sendStatus(200);
});

// রিসেট ডাটাবেস বাটন চাপলে সব ক্লিয়ার হবে
app.post('/api/reset', (req, res) => {
    globalHitsList = [];
    io.emit('dashboard-update', { liveHits: [] });
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
