const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });
const path = require('path');
const cors = require('cors');

app.use(cors());
app.use(express.json());

// সব স্ট্যাটিক ফাইল রুট ডিরেক্টরি থেকে লোড করবে
app.use(express.static(path.join(__dirname, '.')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/update-hits', (req, res) => {
    io.emit('dashboard-update', { liveHits: req.body.hits });
    res.sendStatus(200);
});

server.listen(10000, () => console.log('Server running on port 10000'));
