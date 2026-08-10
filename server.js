const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// Import WebcastPushConnection từ tiktok-live-connector v2
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
app.use(cors());
app.use(express.json());

// Trang chủ kiểm tra Server
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
        // Khởi tạo kết nối với cấu hình v2
        tiktokConnection = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedGiftInfo: true,
            enableWebSockets: true,
            requestOptions: {
                timeout: 10000
            }
        });

        let isResponded = false;

        tiktokConnection.connect().then(state => {
            const roomId = state && state.roomId ? state.roomId : "Live_Room";
            console.log(`[TikTok] Đã kết nối thành công tới Live của: @${username} (Room ID: ${roomId})`);
            
            io.emit('TIKTOK_STATUS', { connected: true, username });
            
            if (!isResponded) {
                isResponded = true;
                res.json({ success: true, roomId });
            }
        }).catch(err => {
            const errorMsg = (err && err.message) ? err.message : "Tài khoản hiện KHÔNG BẮT ĐẦU LIVE hoặc sai Username";
            console.error('[TikTok] Lỗi kết nối:', errorMsg);
            
            io.emit('TIKTOK_STATUS', { connected: false, error: errorMsg });
            
            if (!isResponded) {
                isResponded = true;
                res.status(500).json({ error: errorMsg });
            }
        });

        // 1. SỰ KIỆN KHÁN GIẢ MỚI VÀO PHÒNG LIVE
        tiktokConnection.on('member', data => {
            if (!data) return;
            const nickname = data.nickname || data.uniqueId || 'Khán giả';
            console.log(`[Join] Khán giả mới vào: ${nickname}`);
            io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname });
        });

        // 2. SỰ KIỆN BÌNH LUẬN (CHAT)
        tiktokConnection.on('chat', data => {
            if (!data || !data.comment) return;
            const comment = data.comment.toLowerCase().trim();
            const nickname = data.nickname || data.uniqueId || 'Viewer';

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
            if (!data) return;
            if (data.giftType === 1 && data.repeatEnd) {
                const nickname = data.nickname || data.uniqueId || 'Mạnh thường quân';
                const giftName = data.giftName || 'Món quà';
                const count = data.repeatCount || 1;

                if (giftName === 'Rose' || giftName === 'Hoa hồng') {
                    for (let i = 0; i < Math.min(count, 5); i++) {
                        io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname });
                    }
                } else if ((data.diamondCount || 0) >= 10) {
                    io.emit('GAME_COMMAND', { type: 'ULTIMATE', user: nickname, giftName });
                }
            }
        });

        // 4. SỰ KIỆN THẢ TIM (LIKE)
        tiktokConnection.on('like', data => {
            io.emit('GAME_COMMAND', { type: 'ENVIRONMENT', action: 'flash_light' });
        });

        // Bắt lỗi ngầm không làm sập server
        tiktokConnection.on('streamEnd', () => {
            console.log('[TikTok] Phiên Live đã kết thúc.');
            io.emit('TIKTOK_STATUS', { connected: false, error: "Phiên Live đã kết thúc" });
        });

    } catch (err) {
        const message = (err && err.message) ? err.message : String(err);
        console.error('[Init Error]:', message);
        res.status(500).json({ error: "Lỗi khởi tạo thư viện TikTok: " + message });
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
