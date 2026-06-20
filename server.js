const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });
const cors = require('cors');
const path = require('path');

app.use(cors());
app.use(express.json());

// গুরুত্বপূর্ণ: আপনার index.html ফাইলটি যেখানে আছে সেই ফোল্ডারটি রুট হিসেবে সেট করা
app.use(express.static(path.join(__dirname, '/')));

app.post('/api/update-hits', (req, res) => {
    io.emit('dashboard-update', { liveHits: req.body.hits });
    res.sendStatus(200);
});

io.on('connection', (socket) => {
    console.log('Client connected');
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
