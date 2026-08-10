const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { resolveTikTokUsername } = require('./tiktok-input');

const { TikTokLiveConnection } = require('tiktok-live-connector');

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
let activeTikTokUsername = null;
let tiktokConnectPromise = null;
let giftCommandBindings = {};
let giftDisplayCatalog = [];
let fighterDisplayNames = { blue: 'VÕ SĨ XANH', red: 'VÕ SĨ ĐỎ' };

function normalizeGiftName(name) {
    return String(name || '').trim().toLocaleLowerCase('vi-VN');
}

function sanitizeGiftBindings(bindings) {
    const allowedSides = new Set(['blue', 'red']);
    const allowedActions = new Set(['punch', 'kick', 'energy']);
    const sanitized = {};
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) return sanitized;

    Object.entries(bindings).forEach(([key, giftName]) => {
        const [side, action] = String(key).split(':');
        const normalizedGift = normalizeGiftName(giftName);
        if (allowedSides.has(side) && allowedActions.has(action) && normalizedGift) {
            sanitized[`${side}:${action}`] = normalizedGift;
        }
    });
    return sanitized;
}

function sanitizeGiftCatalog(catalog) {
    if (!Array.isArray(catalog)) return [];
    const seen = new Set();
    return catalog.slice(0, 250).reduce((result, gift) => {
        const name = String(gift && gift.name || '').trim().slice(0, 80);
        const id = normalizeGiftName(name);
        if (!id || seen.has(id)) return result;
        seen.add(id);
        result.push({
            name,
            diamonds: Math.max(0, Math.round(Number(gift.diamonds) || 0)),
            source: String(gift.source || 'control').slice(0, 20)
        });
        return result;
    }, []);
}

function sanitizeFighterNames(names) {
    if (!names || typeof names !== 'object') return fighterDisplayNames;
    return {
        blue: String(names.blue || 'VÕ SĨ XANH').trim().slice(0, 24),
        red: String(names.red || 'VÕ SĨ ĐỎ').trim().slice(0, 24)
    };
}

function getGiftDisplayConfig() {
    return {
        bindings: giftCommandBindings,
        catalog: giftDisplayCatalog,
        fighterNames: fighterDisplayNames
    };
}

function resolveGiftCommand(giftName) {
    const normalizedGift = normalizeGiftName(giftName);
    const match = Object.entries(giftCommandBindings)
        .find(([, assignedGift]) => assignedGift === normalizedGift);
    if (!match) return null;
    const [side, action] = match[0].split(':');
    return { side, action };
}

function getTikTokStatus() {
    let connected = false;
    try {
        connected = Boolean(tiktokConnection && tiktokConnection.state.isConnected);
    } catch (err) {}

    return {
        connected,
        connecting: Boolean(tiktokConnectPromise),
        username: activeTikTokUsername
    };
}

// API kết nối phòng TikTok Live
app.post('/api/connect-tiktok', async (req, res) => {
    let username;
    try {
        username = await resolveTikTokUsername(req.body.username);
        console.log(`[TikTok] Đã xác định Username: @${username}`);
    } catch (err) {
        const message = (err && err.message) ? err.message : 'Link TikTok không hợp lệ';
        return res.status(400).json({ error: message });
    }

    const currentStatus = getTikTokStatus();
    if (activeTikTokUsername === username && (currentStatus.connected || tiktokConnectPromise)) {
        try {
            const state = currentStatus.connected ? tiktokConnection.state : await tiktokConnectPromise;
            return res.json({ success: true, roomId: state.roomId, reused: true });
        } catch (err) {
            const message = (err && err.message) ? err.message : 'Không thể kết nối TikTok Live';
            return res.status(500).json({ error: message });
        }
    }

    if (tiktokConnection) {
        try { tiktokConnection.disconnect(); } catch(e) {}
    }

    try {
        // Khởi tạo kết nối với cấu hình v2
        tiktokConnection = new TikTokLiveConnection(username, {
            processInitialData: false,
            // Extended gift metadata requires EulerStream's paid signing route.
            // Basic gift events still include the fields used by this app.
            enableExtendedGiftInfo: false,
            webClientOptions: {
                timeout: {
                    request: 10000
                }
            }
        });
        activeTikTokUsername = username;

        let isResponded = false;

        const currentConnectPromise = tiktokConnection.connect();
        tiktokConnectPromise = currentConnectPromise;

        currentConnectPromise.then(state => {
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
        }).finally(() => {
            if (tiktokConnectPromise === currentConnectPromise) {
                tiktokConnectPromise = null;
            }
        });

        // 1. SỰ KIỆN KHÁN GIẢ MỚI VÀO PHÒNG LIVE
        tiktokConnection.on('member', data => {
            if (!data) return;
            const nickname = data.user?.nickname || data.user?.displayId || 'Khán giả';
            console.log(`[Join] Khán giả mới vào: ${nickname}`);
            io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname });
        });

        // 2. SỰ KIỆN BÌNH LUẬN (CHAT)
        tiktokConnection.on('chat', data => {
            if (!data || !data.content) return;
            const comment = data.content.toLowerCase().trim();
            const nickname = data.user?.nickname || data.user?.displayId || 'Viewer';

            console.log(`[Chat] ${nickname}: ${comment}`);
            io.emit('GAME_COMMAND', {
                type: 'VIEWER_COMMENT',
                action: 'comment',
                user: nickname,
                comment: data.content
            });

            if (comment === '!dam' || comment === 'dam') {
                io.emit('GAME_COMMAND', { type: 'FINISHER', side: 'blue', action: 'punch', user: nickname });
            } else if (comment === '!da' || comment === 'da') {
                io.emit('GAME_COMMAND', { type: 'FINISHER', side: 'blue', action: 'kick', user: nickname });
            } else if (comment === '!chuong' || comment === 'chuong') {
                io.emit('GAME_COMMAND', { type: 'FINISHER', side: 'blue', action: 'energy', user: nickname });
            } else if (comment === '!damdo' || comment === 'damdo') {
                io.emit('GAME_COMMAND', { type: 'FINISHER', side: 'red', action: 'punch', user: nickname });
            } else if (comment === '!dado' || comment === 'dado') {
                io.emit('GAME_COMMAND', { type: 'FINISHER', side: 'red', action: 'kick', user: nickname });
            } else if (comment === '!chuongdo' || comment === 'chuongdo') {
                io.emit('GAME_COMMAND', { type: 'FINISHER', side: 'red', action: 'energy', user: nickname });
            } else if (comment === '!zoom' || comment === 'zoom') {
                io.emit('GAME_COMMAND', { type: 'CAMERA', action: 'zoom_in' });
            }
        });

        // 3. SỰ KIỆN TẶNG QUÀ (GIFT)
        tiktokConnection.on('gift', data => {
            if (!data || !data.gift) return;
            if (data.gift.type === 1 && !data.repeatEnd) return;

            const nickname = data.user?.nickname || data.user?.displayId || 'Mạnh thường quân';
            const giftName = data.gift.name || 'Món quà';
            const count = data.repeatCount || 1;
            const diamondCount = (data.gift.diamondCount || 0) * count;
            const isLargeGift = diamondCount >= 10;

            if (giftName === 'Rose' || giftName === 'Hoa hồng') {
                for (let i = 0; i < Math.min(count, 5); i++) {
                    io.emit('GAME_COMMAND', { type: 'SPAWN_AUDIENCE', user: nickname });
                }
            }

            io.emit('GAME_COMMAND', {
                type: 'GIFT_RECEIVED',
                action: 'gift',
                user: nickname,
                giftName,
                count,
                diamondCount,
                isLargeGift,
                giftCommand: resolveGiftCommand(giftName)
            });
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
    const { type, action, side, user, giftName, count, diamondCount, isLargeGift } = req.body;
    io.emit('GAME_COMMAND', {
        type,
        action,
        side,
        user: user || 'Viewer_Test',
        giftName,
        count,
        diamondCount,
        isLargeGift,
        giftCommand: type === 'GIFT_RECEIVED' ? resolveGiftCommand(giftName) : null
    });
    res.json({ status: 'sent' });
});

io.on('connection', (socket) => {
    console.log('[Socket] Client Frontend đã kết nối:', socket.id);
    socket.on('GET_TIKTOK_STATUS', (callback) => {
        if (typeof callback === 'function') callback(getTikTokStatus());
    });
    socket.on('UPDATE_GIFT_BINDINGS', (payload, callback) => {
        const bindings = payload && payload.bindings ? payload.bindings : payload;
        giftCommandBindings = sanitizeGiftBindings(bindings);
        if (payload && Array.isArray(payload.catalog)) {
            giftDisplayCatalog = sanitizeGiftCatalog(payload.catalog);
        }
        if (payload && payload.fighterNames) {
            fighterDisplayNames = sanitizeFighterNames(payload.fighterNames);
        }
        io.emit('GIFT_BINDINGS_UPDATED', getGiftDisplayConfig());
        if (typeof callback === 'function') callback({ success: true, count: Object.keys(giftCommandBindings).length });
    });
    socket.on('GET_GIFT_BINDINGS', (callback) => {
        if (typeof callback === 'function') callback(getGiftDisplayConfig());
    });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
    console.log(`Server Backend đang chạy tại port: ${PORT}`);
});
