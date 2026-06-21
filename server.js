const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const SPREADSHEET_ID = '1cryIViTqSQLPhskdKzLuDYYN8Xs70a6U95gfXFkHXv0'; 
let userTeams = {}; 
let liveHits = [];        // রিয়েল-টাইম লাইভ ডেটা
let historyLog = [];      // ৭ দিন ও ৩০ দিনের হিস্টোরি সেভ রাখার জন্য

// গুগল শিট থেকে অটোমেটিক মেম্বার ও টিম সিঙ্ক করার ফাংশন
async function syncGoogleSheetTeams() {
    try {
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:json`;
        const response = await axios.get(url);
        const jsonText = response.data.match(/google\.visualization\.Query\.setResponse\(([\s\S\n\r]*)\);/)[1];
        const data = JSON.parse(jsonText);
        const rows = data.table.rows;
        
        let updatedTeams = {};
        rows.forEach(row => {
            const workerId = row.c[0] ? row.c[0].v.toString().trim() : null;
            const username = row.c[1] ? row.c[1].v.toString().trim() : null;
            const team = row.c[2] ? row.c[2].v.toString().trim() : 'No Team';
            
            if (workerId) {
                updatedTeams[workerId] = { username: username || workerId, team: team };
            }
        });
        userTeams = updatedTeams;
        console.log(`♻️ Google Sheet synced seamlessly! Active Workers found: ${Object.keys(userTeams).length}`);
        
        // ড্যাশবোর্ডে নতুন মেম্বার লিস্ট পুশ করা
        io.emit('stats-update', { liveHits, historyLog });
    } catch (error) {
        console.error('❌ Google Sheet Sync Error:', error.message);
    }
}

// প্রতি ১২০ সেকেন্ড (২ মিনিট) পর পর ব্যাকএন্ড নিজে থেকেই গুগল শিট চেক করবে
setInterval(syncGoogleSheetTeams, 120000);
syncGoogleSheetTeams();

io.on('connection', (socket) => {
    socket.emit('init-data', { liveHits, historyLog });
});

// RDP থেকে লাইভ কাজের ডেটা রিসিভ করার API
app.post('/api/update-hits', (req, res) => {
    const incomingHits = req.body.hits;
    const timestamp = new Date();
    
    incomingHits.forEach(hit => {
        // গুগল শিটের ডেটার সাথে ম্যাচ করা (মফিজ/করিম যা-ই অ্যাড হোক)
        if (userTeams[hit.workerId]) {
            hit.username = userTeams[hit.workerId].username;
            hit.team = userTeams[hit.workerId].team;
        } else {
            hit.username = hit.workerId;
            hit.team = 'Unknown Team';
        }
        
        hit.updatedAt = timestamp.toISOString();

        // লাইভ ট্র্যাকিং আপডেট
        const existingIndex = liveHits.findIndex(h => h.title === hit.title && h.workerId === hit.workerId);
        if (existingIndex > -1) {
            liveHits[existingIndex] = { ...liveHits[existingIndex], ...hit };
        } else {
            liveHits.unshift(hit);
        }

        // হিস্টোরি লগ-এ ডেটা সেভ করা (৭ দিন ও ৩০ দিনের রিপোর্টের জন্য)
        const historyExists = historyLog.some(h => h.title === hit.title && h.workerId === hit.workerId && h.status === hit.status);
        if (!historyExists) {
            historyLog.unshift({ ...hit, dateKey: timestamp.toLocaleDateString() });
        }
    });

    // ড্যাশবোর্ডে লাইভ ব্রডকাস্ট
    io.emit('dashboard-update', { liveHits, historyLog });
    res.status(200).json({ success: true });
});

// ড্যাশবোর্ড রিসেট করার API
app.post('/api/reset', (req, res) => {
    liveHits = [];
    historyLog = [];
    io.emit('dashboard-update', { liveHits, historyLog });
    res.sendStatus(200);
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Pro Server Running live on port ${PORT}`));
