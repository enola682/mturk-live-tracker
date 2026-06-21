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
let userTeams = []; 

// গুগল শিট ডাটা সিঙ্ক লজিক
async function syncGoogleSheet() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`;
        const response = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
        const jsonText = response.data.substring(response.data.indexOf('(') + 1, response.data.lastIndexOf(')'));
        const data = JSON.parse(jsonText);
        
        let updatedList = [];
        data.table.rows.forEach(row => {
            if (row.c) {
                const wId = row.c[0] && row.c[0].v ? row.c[0].v.toString().trim().toUpperCase() : "";
                const uName = row.c[1] && row.c[1].v ? row.c[1].v.toString().trim() : "";
                const tName = row.c[2] && row.c[2].v ? row.c[2].v.toString().trim() : "Unknown";
                
                if (wId) {
                    updatedList.push({ workerId: wId, username: uName, team: tName });
                }
            }
        });
        userTeams = updatedList;
        console.log(`Cloud Sync: ${userTeams.length} workers loaded from Google Sheet.`);
    } catch (e) { 
        console.log("Google Sheet Sync Error: ", e.message); 
    }
}
setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

let databaseHits = []; 

app.post('/api/update-hits', (req, res) => {
    const incoming = req.body.hits || [];
    
    incoming.forEach(hit => {
        let rawWorkerId = hit.workerId ? hit.workerId.toString().trim() : "";
        let rawUsername = hit.username ? hit.username.toString().trim() : "";

        let lookupId = (rawWorkerId.toUpperCase() === "COPIED" || !rawWorkerId) ? "" : rawWorkerId.toUpperCase();
        let lookupUser = (rawUsername.toUpperCase() === "COPIED" || !rawUsername) ? "" : rawUsername;

        // শিটের ডাটার সাথে নিখুঁত ম্যাচিং অ্যালগরিদম
        let matched = userTeams.find(u => 
            (lookupId !== "" && u.workerId === lookupId) || 
            (lookupUser !== "" && u.username.toUpperCase() === lookupUser.toUpperCase())
        );

        let finalTitle = hit.title ? hit.title.toString().trim() : "MTurk Premium Task";
        if (finalTitle.length <= 2 || finalTitle.includes("$") || finalTitle.toLowerCase() === "copied" || !isNaN(finalTitle)) {
            finalTitle = hit.requester ? `[TASK] ${hit.requester} Live Survey` : "MTurk Premium Task";
        }

        // স্ট্যাটাস ফিল্টারিং ও রিটার্ন ওভাররাইড লজিক
        let rawStatus = hit.status ? hit.status.toString().trim() : 'Active';
        let finalStatus = 'Active';

        if (rawStatus.toLowerCase().includes('return') || rawStatus.toLowerCase().includes('ret')) {
            finalStatus = 'Returned';
        } else if (rawStatus.toLowerCase().includes('sub') || rawStatus.toLowerCase().includes('done')) {
            finalStatus = 'Submitted';
        } else if (rawStatus.toLowerCase().includes('exp') || hit.timeLeft === "0:00" || hit.timeLeft === "00:00") {
            finalStatus = 'Expired';
        }

        const newRecord = {
            workerId: matched ? matched.workerId : (lookupId || "N/A"),
            username: matched ? matched.username : (lookupUser || "N/A"), // হার্ডকোডেড ভ্যালু রিমুভড, শিট বা র ডেটা বসবে
            team: matched ? matched.team : "Unknown",
            requester: hit.requester || 'N/A',
            title: finalTitle,
            reward: hit.reward || '$0.00',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: hit.timeLeft ? hit.timeLeft.toString().trim() : '—',
            status: finalStatus,
            timestamp: Date.now()
        };

        // ইউনিক কি ট্র্যাকিং ফিল্টার (আইডি, রিকোয়েস্টার ও টাইটেল মিললে আপডেট করবে)
        const idx = databaseHits.findIndex(h => h.workerId === newRecord.workerId && h.title === newRecord.title && h.requester === newRecord.requester);
        if (idx > -1) {
            databaseHits[idx] = { ...databaseHits[idx], ...newRecord };
        } else {
            databaseHits.unshift(newRecord);
        }
    });

    if (databaseHits.length > 2500) databaseHits = databaseHits.slice(0, 2500);

    io.emit('dashboard-update', { liveHits: databaseHits });
    res.sendStatus(200);
});

app.post('/api/reset', (req, res) => {
    databaseHits = [];
    io.emit('dashboard-update', { liveHits: [] });
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Cloud Server Online`));
