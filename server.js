const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// ==========================================
// 1. Quản lý kết nối TikTok Live
// ==========================================
let tiktokConnection = null;

// API kết nối tới một phòng TikTok Live theo Username
app.post('/api/connect-tiktok', (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Vui lòng nhập TikTok Username" });
    }

    if (tiktokConnection) {
        tiktokConnection.disconnect();
    }

    tiktokConnection = new WebcastPushConnection(username);

    tiktokConnection.connect().then(state => {
        console.log(`[TikTok] Đã kết nối tới Live của: @${username} (Room ID: ${state.roomId})`);
        io.emit('TIKTOK_STATUS', { connected: true, username });
        res.json({ success: true, roomId: state.roomId });
    }).catch(err => {
        console.error('[TikTok] Lỗi kết nối:', err);
        io.emit('TIKTOK_STATUS', { connected: false, error: err.message });
        res.status(500).json({ error: "Không thể kết nối TikTok Live" });
    });

    // Lắng nghe COMMENT
    tiktokConnection.on('chat', data => {
        const comment = data.comment.toLowerCase().trim();
        const nickname = data.nickname || data.uniqueId;

        console.log(`[Chat] ${nickname}: ${comment}`);

        // Xử lý lệnh từ chat
        if (comment === '!dam' || comment === 'dam') {
            io.emit('GAME_COMMAND', { type: 'ATTACK', action: 'punch', user: nickname });
        } else if (comment === '!da' || comment === 'da') {
            io.emit('GAME_COMMAND', { type: 'ATTACK', action: 'kick', user: nickname });
        } else if (comment === '!zoom' || comment === 'zoom') {
            io.emit('GAME_COMMAND', { type: 'CAMERA', action: 'zoom_in' });
        } else if (comment === '!nhay' || comment === 'nhay') {
            io.emit('GAME_COMMAND', { type: 'ATTACK', action: 'jump', user: nickname });
        }
    });

    // Lắng nghe TẶNG QUÀ (Gift)
    tiktokConnection.on('gift', data => {
        if (data.giftType === 1 && data.repeatEnd) { // Khi kết thúc chuỗi combo quà
            const nickname = data.nickname || data.uniqueId;
            const giftName = data.giftName;
            const count = data.repeatCount;

            console.log(`[Gift] ${nickname} tặng ${count}x ${giftName}`);

            if (giftName === 'Rose' || giftName === 'Hoa hồng') {
                // Tặng hoa hồng -> Tạo khán giả mới
                io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname, count: count });
            } else if (data.diamondCount >= 10) {
                // Quà lớn -> Chiêu đặc biệt + Cinematic Camera
                io.emit('GAME_COMMAND', { type: 'ULTIMATE', user: nickname, giftName: giftName });
            }
        }
    });

    // Lắng nghe THẢ TIM (Like)
    tiktokConnection.on('like', data => {
        io.emit('GAME_COMMAND', { type: 'ENVIRONMENT', action: 'flash_light', totalLikes: data.totalLikeCount });
    });
});

// API giả lập test khi không có Live Stream thực tế
app.post('/api/test-command', (req, res) => {
    const { type, action, user } = req.body;
    io.emit('GAME_COMMAND', { type, action, user: user || 'TestUser' });
    res.json({ status: 'sent' });
});

// Socket.io Real-time Connection
io.on('connection', (socket) => {
    console.log('[Socket] Client Frontend đã kết nối:', socket.id);
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`Server Backend đang chạy tại: http://localhost:${PORT}`);
    console.log(`=================================`);
});