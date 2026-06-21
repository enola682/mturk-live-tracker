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
let userTeams = []; // অবজেক্টের বদলে অ্যারে দিয়ে নিখুঁত ম্যাচিং করা হবে

// গুগল শিট অটো সিঙ্ক লজিক
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
        console.log("Sheet Sync Completed. Total Rows Loaded: ", userTeams.length);
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
        let extWorkerId = hit.workerId ? hit.workerId.toString().trim() : "";
        let extUsername = hit.username ? hit.username.toString().trim() : "";
        
        // ১. আইডি ও টিম নেম ট্র্যাকিং ফিক্স (শিটের সাথে ম্যাচিং)
        let matchedUser = userTeams.find(u => 
            (extWorkerId !== "" && extWorkerId.toUpperCase() !== "COPIED" && u.workerId === extWorkerId.toUpperCase()) ||
            (extUsername !== "" && u.username === extUsername.toUpperCase())
        );

        let finalWorkerId = matchedUser ? matchedUser.workerId : (extWorkerId.toUpperCase() === "COPIED" ? extUsername : extWorkerId);
        let finalUsername = matchedUser ? matchedUser.username : extUsername;
        let finalTeamName = matchedUser ? matchedUser.team : "Unknown Team";

        // ২. ফেক হিট টাইটেল ফিক্স
        let finalTitle = hit.title ? hit.title.toString().trim() : "No Title";
        // যদি টাইটেল রিওয়ার্ডের মতো দেখায় বা শুধু সংখ্যা হয়, তবে আসল রিকুয়েস্টার নেম সেট হবে
        if (finalTitle.length <= 2 || finalTitle.includes("$") || finalTitle.toLowerCase() === "copied" || !isNaN(finalTitle)) {
            finalTitle = hit.requester ? `[TASK] ${hit.requester} Live Survey` : "MTurk Premium HIT Task";
        }

        // ৩. টাইম শেষ হলে অটো-স্ট্যাটাস এক্সপায়ার্ড/রিটার্ন ফিক্স
        let finalStatus = hit.status || 'Active';
        const timeLeftStr = hit.timeLeft ? hit.timeLeft.toString().trim() : "";
        if (timeLeftStr === "0:00" || timeLeftStr === "00:00" || timeLeftStr === "-" || timeLeftStr === "") {
            finalStatus = 'Expired';
        }

        const newRecord = {
            workerId: finalWorkerId || "N/A",
            username: finalUsername || "N/A", 
            team: finalTeamName,
            requester: hit.requester || 'N/A',
            title: finalTitle,
            reward: hit.reward || '$0.00',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: timeLeftStr || '-',
            status: finalStatus,
            timestamp: Date.now()
        };

        // ইউনিক ডেটা হ্যান্ডলিং
        const idx = databaseHits.findIndex(h => h.workerId === newRecord.workerId && h.title === newRecord.title);
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
http.listen(PORT, '0.0.0.0', () => console.log(`Server is running...`));
