const express = require('express');
const app = express();
const server = require('http').createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });
const cors = require('cors');

app.use(cors());
app.use(express.json());

// আরডিপি থেকে হিট রিসিভ করার এন্ডপয়েন্ট
app.post('/api/update-hits', (req, res) => {
    console.log("Data Received from RDP");
    io.emit('dashboard-update', { liveHits: req.body.hits });
    res.sendStatus(200);
});

// ড্যাশবোর্ডে কানেকশন হ্যান্ডলার
io.on('connection', (socket) => {
    console.log('Dashboard connected');
    socket.emit('dashboard-update', { liveHits: [] }); // কানেক্ট হওয়ার সাথে সাথে ব্ল্যাঙ্ক ডেটা পাঠাবে
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
