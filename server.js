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

// স্ট্যাটাস ভিত্তিক লাইফটাইম কাউন্টার অবজেক্ট
let globalStats = {
    totalSelected: 0,
    estimatedEarned: 0,
    submittedCount: 0,
    returnedCount: 0
};

// লাইভ টেবিলের জন্য শুধুমাত্র Active হিটগুলো রাখার অ্যারে
let liveActiveHits = [];

// গুগল শিট ডেটা সিঙ্ক ফাংশন (উন্নত ফরম্যাট ফিক্স)
async function syncGoogleSheet() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`;
        const response = await axios.get(url);
        const jsonText = response.data.substring(response.data.indexOf('(') + 1, response.data.lastIndexOf(')'));
        const data = JSON.parse(jsonText);
        
        let updatedTeams = {};
        data.table.rows.forEach(row => {
            // কলাম ০ = Worker ID, কলাম ১ = Worker Name, কলাম ২ = Team Name
            const id = row.c[0] && row.c[0].v ? row.c[0].v.toString().trim() : null;
            const name = row.c[1] && row.c[1].v ? row.c[1].v.toString().trim() : "Unknown";
            const team = row.c[2] && row.c[2].v ? row.c[2].v.toString().trim() : "Team";
            
            if (id) {
                updatedTeams[id] = { username: name, team: team };
            }
        });
        userTeams = updatedTeams;
        console.log("Google Sheet Synced. Total Workers Loaded:", Object.keys(userTeams).length);
    } catch (e) { 
        console.log("Sheet Sync Error:", e.message); 
    }
}

setInterval(syncGoogleSheet, 30000);
syncGoogleSheet();

// আরডিপি থেকে হিট ডাটা রিসিভ
app.post('/api/update-hits', (req, res) => {
    const incomingHits = req.body.hits || [];
    
    incomingHits.forEach(hit => {
        // গুগল শিট থেকে আইডি ধরে ইউজার এবং টিম ম্যাচিং (Case Insensitive & Trim ফিক্স)
        const workerIdClean = hit.workerId ? hit.workerId.toString().trim() : "";
        const info = userTeams[workerIdClean] || { username: workerIdClean || "Unknown", team: "Unknown" };
        
        const currentStatus = (hit.status || 'Active').toLowerCase();
        const rewardNum = parseFloat(hit.reward ? hit.reward.toString().replace('$', '') : '0') || 0;

        const processedHit = { 
            ...hit, 
            username: info.username, 
            team: info.team,
            status: hit.status || 'Active',
            requester: hit.requester || 'N/A',
            timeLeft: hit.timeLeft || 'Just Now'
        };

        // ১. যদি হিটটি সাবমিট বা রিটার্ন হয়, তবে মেইন কাউন্টার বক্স বাড়িয়ে দেব
        if (currentStatus === 'submitted') {
            globalStats.submittedCount++;
            globalStats.estimatedEarned += rewardNum;
            globalStats.totalSelected++;
            // লাইভ লিস্টে থাকলে তা সরিয়ে দেব
            liveActiveHits = liveActiveHits.filter(h => !(h.workerId === processedHit.workerId && h.title === processedHit.title));
        } 
        else if (currentStatus === 'returned') {
            globalStats.returnedCount++;
            globalStats.totalSelected++;
            // লাইভ লিস্টে থাকলে তা সরিয়ে দেব
            liveActiveHits = liveActiveHits.filter(h => !(h.workerId === processedHit.workerId && h.title === processedHit.title));
        } 
        else {
            // ২. যদি হিটটি Active হয়, তবে লাইভ তালিকায় যোগ বা আপডেট করব
            const existingIndex = liveActiveHits.findIndex(h => h.workerId === processedHit.workerId && h.title === processedHit.title);
            if (existingIndex > -1) {
                liveActiveHits[existingIndex] = processedHit;
            } else {
                liveActiveHits.unshift(processedHit);
                globalStats.totalSelected++;
            }
        }
    });

    // সর্বোচ্চ ১০০ টি একটিভ হিট মেমোরিতে রাখবে
    if (liveActiveHits.length > 100) {
        liveActiveHits = liveActiveHits.slice(0, 100);
    }
    
    // ড্যাশবোর্ডে লাইভ একটিভ হিট এবং স্ট্যাটাস কাউন্ট পাঠানো
    io.emit('dashboard-update', { 
        liveHits: liveActiveHits,
        stats: globalStats
    });
    
    res.sendStatus(200);
});

// ডেটাবেস রিসেট
app.post('/api/reset', (req, res) => {
    liveActiveHits = [];
    globalStats = { totalSelected: 0, estimatedEarned: 0, submittedCount: 0, returnedCount: 0 };
    io.emit('dashboard-update', { liveHits: [], stats: globalStats });
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
