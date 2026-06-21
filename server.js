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
                const uName = row.c[1] && row.c[1].v ? row.c[1].v.toString().trim().toUpperCase() : "";
                const tName = row.c[2] && row.c[2].v ? row.c[2].v.toString().trim() : "Unknown Team";
                
                if (wId || uName) {
                    updatedList.push({ workerId: wId, username: uName, team: tName });
                }
            }
        });
        userTeams = updatedList;
        console.log("Sheet Sync completed.");
    } catch (e) { 
        console.log("Sheet Sync Error: ", e.message); 
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
        let rawId = hit.workerId ? hit.workerId.toString().trim() : "COPIED";
        let rawUser = hit.username ? hit.username.toString().trim() : "";

        // ১. ফেক টাইটেল রিমুভাল (যদি টাইটেল ছোট সংখ্যা বা রিওয়ার্ডের সমান হয়)
        let finalTitle = hit.title ? hit.title.toString().trim() : "No Title";
        if (finalTitle.length <= 2 || finalTitle.includes("$") || finalTitle.toLowerCase() === "copied" || !isNaN(finalTitle)) {
            finalTitle = hit.requester ? `${hit.requester} - Live Survey Task` : "MTurk Premium HIT";
        }

        // ২. টাইম শেষ হলে অটো-স্ট্যাটাস EXPIRED করা
        let finalStatus = hit.status || 'Active';
        const timeLeftStr = hit.timeLeft ? hit.timeLeft.toString().trim() : "";
        if (timeLeftStr === "0:00" || timeLeftStr === "00:00" || timeLeftStr === "-" || timeLeftStr === "") {
            finalStatus = 'Expired';
        }

        // ৩. শিটের সাথে ম্যাচিং ট্রাই (ব্যাকআপ লজিক)
        let matched = userTeams.find(u => 
            (rawId !== "COPIED" && u.workerId === rawId.toUpperCase()) || 
            (rawUser !== "" && u.username === rawUser.toUpperCase())
        );

        const newRecord = {
            workerId: matched ? matched.workerId : rawId,
            username: matched ? matched.username : (rawUser || "COPIED"),
            team: matched ? matched.team : "Unknown",
            requester: hit.requester || 'N/A',
            title: finalTitle,
            reward: hit.reward || '$0.00',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: timeLeftStr || '-',
            status: finalStatus,
            timestamp: Date.now()
        };

        // ইউনিক এন্ট্রি ট্র্যাকিং (যাতে ডুপ্লিকেট না হয়)
        const idx = databaseHits.findIndex(h => h.title === newRecord.title && h.requester === newRecord.requester);
        if (idx > -1) {
            databaseHits[idx] = { ...databaseHits[idx], ...newRecord };
        } else {
            databaseHits.unshift(newRecord);
        }
    });

    if (databaseHits.length > 2000) databaseHits = databaseHits.slice(0, 2000);

    io.emit('dashboard-update', { liveHits: databaseHits });
    res.sendStatus(200);
});

app.post('/api/reset', (req, res) => {
    databaseHits = [];
    io.emit('dashboard-update', { liveHits: [] });
    res.sendStatus(200);
});

const PORT = process.env.PORT || 10000;
http.listen(PORT, '0.0.0.0', () => console.log(`Server Running`));
