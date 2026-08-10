const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import an toàn tương thích mọi phiên bản tiktok-live-connector
const TikTokLive = require('tiktok-live-connector');
const WebcastPushConnection = TikTokLive.WebcastPushConnection || TikTokLive.default || TikTokLive;

const app = express();
app.use(cors());
app.use(express.json());

// Trang chủ báo trạng thái Server hoạt động
app.get('/', (req, res) => {
    res.send('<h1 style="color: green; text-align: center; margin-top: 50px;">TikTok Arena Backend Server Is Running Online!</h1>');
});

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    transports: ['polling', 'websocket']
});

let tiktokConnection = null;

// API kết nối phòng TikTok Live
app.post('/api/connect-tiktok', (req, res) => {
    const { username } = req.body;
    if (!username) {
        return res.status(400).json({ error: "Vui lòng nhập TikTok Username" });
    }

    if (tiktokConnection) {
        try { tiktokConnection.disconnect(); } catch(e) {}
    }

    try {
        tiktokConnection = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            requestOptions: { timeout: 10000 }
        });

        let isResponded = false;

        tiktokConnection.connect().then(state => {
            console.log(`[TikTok] Đã kết nối thành công tới Live của: @${username}`);
            io.emit('TIKTOK_STATUS', { connected: true, username });
            if (!isResponded) {
                isResponded = true;
                res.json({ success: true, roomId: state.roomId });
            }
        }).catch(err => {
            console.error('[TikTok] Lỗi kết nối:', err.message || err);
            io.emit('TIKTOK_STATUS', { connected: false, error: "Kênh chưa phát Live hoặc lỗi TikTok" });
            if (!isResponded) {
                isResponded = true;
                res.status(500).json({ error: "Không thể kết nối. Hãy đảm bảo tài khoản đang BẮT ĐẦU LIVE!" });
            }
        });

        // 1. SỰ KIỆN KHÁN GIẢ MỚI VÀO PHÒNG LIVE
        tiktokConnection.on('member', data => {
            const nickname = data.nickname || data.uniqueId;
            console.log(`[Join] Khán giả mới vào: ${nickname}`);
            io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname });
        });

        // 2. SỰ KIỆN BÌNH LUẬN (CHAT)
        tiktokConnection.on('chat', data => {
            const comment = data.comment.toLowerCase().trim();
            const nickname = data.nickname || data.uniqueId;

            console.log(`[Chat] ${nickname}: ${comment}`);

            if (comment === '!dam' || comment === 'dam') {
                io.emit('GAME_COMMAND', { type: 'ATTACK', action: 'punch', user: nickname });
            } else if (comment === '!da' || comment === 'da') {
                io.emit('GAME_COMMAND', { type: 'ATTACK', action: 'kick', user: nickname });
            } else if (comment === '!zoom' || comment === 'zoom') {
                io.emit('GAME_COMMAND', { type: 'CAMERA', action: 'zoom_in' });
            }
        });

        // 3. SỰ KIỆN TẶNG QUÀ (GIFT)
        tiktokConnection.on('gift', data => {
            if (data.giftType === 1 && data.repeatEnd) {
                const nickname = data.nickname || data.uniqueId;
                const giftName = data.giftName;
                const count = data.repeatCount;

                if (giftName === 'Rose' || giftName === 'Hoa hồng') {
                    for (let i = 0; i < Math.min(count, 5); i++) {
                        io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname });
                    }
                } else if (data.diamondCount >= 10) {
                    io.emit('GAME_COMMAND', { type: 'ULTIMATE', user: nickname, giftName });
                }
            }
        });

        // 4. SỰ KIỆN THẢ TIM (LIKE)
        tiktokConnection.on('like', data => {
            io.emit('GAME_COMMAND', { type: 'ENVIRONMENT', action: 'flash_light' });
        });

    } catch (err) {
        console.error('[Init Error]:', err);
        res.status(500).json({ error: "Lỗi khởi tạo thư viện TikTok" });
    }
});

// API giả lập test khi không cắm Live
app.post('/api/test-command', (req, res) => {
    const { type, action, user } = req.body;
    io.emit('GAME_COMMAND', { type, action, user: user || 'Viewer_Test' });
    res.json({ status: 'sent' });
});

io.on('connection', (socket) => {
    console.log('[Socket] Client Frontend đã kết nối:', socket.id);
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server Backend đang chạy tại port: ${PORT}`);
});
