const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" } });
const cors = require('cors');
const path = require('path');

app.use(cors());
app.use(express.json());

// স্ট্যাটিক ফাইল সার্ভ করা (যাতে index.html লোড হয়)
app.use(express.static(path.join(__dirname, '/')));

// আরডিপি থেকে হিট রিসিভ করার এন্ডপয়েন্ট
app.post('/api/update-hits', (req, res) => {
    console.log("Data Received from RDP");
    // ডাটা ড্যাশবোর্ডে পাঠানো
    io.emit('dashboard-update', { liveHits: req.body.hits });
    res.sendStatus(200);
});

// ড্যাশবোর্ড রিসেট করার এন্ডপয়েন্ট
app.post('/api/reset', (req, res) => {
    io.emit('dashboard-update', { liveHits: [] });
    res.sendStatus(200);
});

// সকেট কানেকশন
io.on('connection', (socket) => {
    console.log('Dashboard connected: ' + socket.id);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
