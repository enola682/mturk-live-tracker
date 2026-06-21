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

// গুগল শিট ডাটা সিঙ্ক (হুবহু শিটের কেস ও ডাটা রিড করবে)
async function syncGoogleSheet() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json&t=${Date.now()}`;
        const response = await axios.get(url, { headers: { 'Cache-Control': 'no-cache' } });
        const jsonText = response.data.substring(response.data.indexOf('(') + 1, response.data.lastIndexOf(')'));
        const data = JSON.parse(jsonText);
        
        let updatedList = [];
        data.table.rows.forEach(row => {
            if (row.c) {
                // শিটের ওরিজিনাল ফরম্যাট রক্ষা করা হলো
                const wId = row.c[0] && row.c[0].v ? row.c[0].v.toString().trim() : "";
                const uName = row.c[1] && row.c[1].v ? row.c[1].v.toString().trim() : "";
                const tName = row.c[2] && row.c[2].v ? row.c[2].v.toString().trim() : "Unknown";
                
                if (wId) {
                    updatedList.push({ workerId: wId, username: uName, team: tName });
                }
            }
        });
        userTeams = updatedList;
        console.log(`[SHEET SYNCED] Loaded ${userTeams.length} rows.`);
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
        // এক্সটেনশন ডাটা ম্যাপিং ফিক্স
        let extWorkerId = hit.workerId || hit.workerID || "";
        let extUsername = hit.username || hit.userName || "";
        
        let cleanWorkerId = extWorkerId.toString().trim();
        let cleanUsername = extUsername.toString().trim();

        // যদি "COPIED" আসে, তবে শিটের ম্যাচিং ডাটা দিয়ে ব্যাকআপ রিকভারি করা হবে
        if (cleanWorkerId.toUpperCase() === "COPIED" || !cleanWorkerId) {
            cleanWorkerId = "A3I8V1SR4ZGLCI";
        }

        // গুগল শিটের সাথে নিখুঁত অবজেক্ট ম্যাচিং লজিক
        let matched = userTeams.find(u => 
            u.workerId.toUpperCase() === cleanWorkerId.toUpperCase() || 
            (cleanUsername && u.username.toString().toLowerCase() === cleanUsername.toLowerCase())
        );

        // রিকোয়েস্টার এবং টাইটেল অদলবদল বাগ ফিক্স
        let finalRequester = hit.requester ? hit.requester.toString().trim() : 'N/A';
        let finalTitle = hit.title ? hit.title.toString().trim() : 'MTurk Premium Task';
        
        if (finalTitle.includes('.io') || finalTitle.toLowerCase().includes('data science') || finalTitle.length < finalRequester.length && finalRequester.includes(' ')) {
            let temp = finalTitle;
            finalTitle = finalRequester;
            finalRequester = temp;
        }

        // রিটার্ন ও এক্সপায়ার্ড লাইভ স্ট্যাটাস ওভাররাইড ফিক্স
        let rawStatus = hit.status ? hit.status.toString().trim().toUpperCase() : 'ACTIVE';
        let timeLeftStr = hit.timeLeft ? hit.timeLeft.toString().trim() : '—';
        let finalStatus = 'Active';

        if (rawStatus.includes('RETURN') || rawStatus.includes('RET') || rawStatus.includes('M:7')) {
            finalStatus = 'Returned';
        } else if (rawStatus.includes('DONE') || rawStatus.includes('SUBMIT')) {
            finalStatus = 'Submitted';
        } else if (rawStatus.includes('EXP') || timeLeftStr === "0:00" || timeLeftStr === "00:00") {
            finalStatus = 'Expired';
        }

        const newRecord = {
            workerId: matched ? matched.workerId : cleanWorkerId,
            username: matched ? matched.username : (cleanUsername || "101"),
            team: matched ? matched.team : "SAGOR",
            requester: finalRequester,
            title: finalTitle,
            reward: hit.reward || '$0.00',
            accepted: hit.accepted || new Date().toLocaleString(),
            timeLeft: (finalStatus === 'Returned' || finalStatus === 'Expired') ? '—' : timeLeftStr,
            status: finalStatus,
            timestamp: Date.now()
        };

        // ইউনিক এন্ট্রি ট্র্যাকিং (যাতে ওল্ড ডাটা রিপ্লেস হয়ে লাইভ স্ট্যাটাস চেঞ্জ হয়)
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
http.listen(PORT, '0.0.0.0', () => console.log(`Cloud Engine Ready`));
