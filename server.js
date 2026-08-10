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
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
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
        try { tiktokConnection.disconnect(); } catch(e) {}
    }

    // Thiết lập kết nối với thời gian chờ Timeout 10 giây
    tiktokConnection = new WebcastPushConnection(username, {
        processInitialData: false,
        enableExtendedGiftInfo: true,
        requestOptions: {
            timeout: 10000 // 10 giây không phản hồi sẽ tự ngắt
        }
    });

    // Biến kiểm tra xem response đã được trả về chưa
    let isResponded = false;

    tiktokConnection.connect().then(state => {
        console.log(`[TikTok] Đã kết nối tới Live của: @${username} (Room ID: ${state.roomId})`);
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
            res.status(500).json({ error: "Không thể kết nối. Đảm bảo tài khoản đang BẮT ĐẦU LIVE!" });
        }
    });

    // Thêm sự kiện lắng nghe ngắt kết nối đột ngột từ TikTok
    tiktokConnection.on('streamEnd', () => {
        console.log('[TikTok] Phiên Live đã kết thúc.');
        io.emit('TIKTOK_STATUS', { connected: false, error: "Phiên Live đã kết thúc" });
    });

    // Bắt lỗi chung của Socket TikTok
    tiktokConnection.on('error', err => {
        console.error('[TikTok Error]:', err);
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
// Thêm đường dẫn trang chủ GET / để kiểm tra trạng thái
app.get('/', (req, res) => {
    res.send('<h1>TikTok Arena Backend Server Is Running Online!</h1>');
});
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
    console.log(`=================================`);
    console.log(`Server Backend đang chạy tại: http://localhost:${PORT}`);
    console.log(`=================================`);
});
