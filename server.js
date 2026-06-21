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

// গুগল শিট থেকে ডাটা সিঙ্ক
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
        console.log(`Cloud Sync: ${userTeams.length} workers sync completed.`);
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
        // এক্সটেনশন থেকে আসা ডাটা ক্লিনিং এবং সঠিক ভেরিয়েবলে অ্যাসাইনমেন্ট
        let rawWorkerId = hit.workerId ? hit.workerId.toString().trim() : "";
        let rawUsername = hit.username ? hit.username.toString().trim() : "";
        
        // যদি ডাটা "COPIED" আসে বা ফাঁকা থাকে, তবে গুগল শিটের প্রথম এন্ট্রির সাথে ডেমো ট্র্যাকিং ম্যাচিং
        let lookupId = (rawWorkerId.toUpperCase() === "COPIED" || !rawWorkerId) ? "A3I8V1SR4ZGLCI" : rawWorkerId.toUpperCase();
        
        let matched = userTeams.find(u => u.workerId === lookupId);

        // রিকোয়েস্টার এবং টাইটেল ডাটা যাতে অদলবদল না হয় তার ফিক্স
        let finalRequester = hit.requester ? hit.requester.toString().trim() : 'N/A';
        let finalTitle = hit.title ? hit.title.toString().trim() : 'MTurk Premium Task';
        
        // যদি ভুল করে টাইটেল রিকোয়েস্টারে চলে আসে বা উল্টো হয়
        if (finalTitle.includes('.io') || finalTitle.toLowerCase().includes('data science')) {
            let temp = finalTitle;
            finalTitle = finalRequester;
            finalRequester = temp;
        }

        // টাস্ক রিটার্ন এবং লাইভ অ্যাক্টিভ স্ট্যাটাস ওভাররাইড বাগ ফিক্স
        let rawStatus = hit.status ? hit.status.toString().trim().toUpperCase() : 'ACTIVE';
        let timeLeftStr = hit.timeLeft ? hit.timeLeft.toString().trim() : '—';
        let finalStatus = 'Active';

        if (rawStatus.includes('RETURN') || rawStatus.includes('RET') || rawStatus === 'M:7' || rawStatus === 'M RETURN') {
            finalStatus = 'Returned';
        } else if (rawStatus.includes('DONE') || rawStatus.includes('SUBMIT')) {
            finalStatus = 'Submitted';
        } else if (rawStatus.includes('EXP') || timeLeftStr === "0:00" || timeLeftStr === "00:00") {
            finalStatus = 'Expired';
        }

        const newRecord = {
            workerId: lookupId,
            username: matched ? matched.username : (rawUsername || "101"),
            team: matched ? matched.team : "SAGOR",
            requester: finalRequester,
            title: finalTitle.replace('Live Survey', '').trim() + ' Live Survey',
            reward: hit.reward && hit.reward.includes('$') ? hit.reward : '$0.05',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: finalStatus === 'Returned' || finalStatus === 'Expired' ? '—' : timeLeftStr,
            status: finalStatus,
            timestamp: Date.now()
        };

        // ইউনিক কি ইনডেক্সিং (একই ইউজারের টাস্ক স্ট্যাটাস রিয়েল-টাইমে রিপ্লেস করার জন্য)
        const idx = databaseHits.findIndex(h => h.workerId === newRecord.workerId && h.requester === newRecord.requester);
        if (idx > -1) {
            databaseHits[idx] = { ...databaseHits[idx], ...newRecord };
        } else {
            databaseHits.unshift(newRecord);
        }
    });

    if (databaseHits.length > 1500) databaseHits = databaseHits.slice(0, 1500);

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
