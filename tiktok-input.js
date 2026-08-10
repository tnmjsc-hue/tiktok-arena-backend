const TIKTOK_HOSTS = new Set([
    'tiktok.com',
    'www.tiktok.com',
    'm.tiktok.com',
    'vt.tiktok.com',
    'vm.tiktok.com'
]);

function usernameFromTikTokUrl(url) {
    const match = url.pathname.match(/^\/@([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
}

async function resolveTikTokUsername(input) {
    const value = String(input || '').trim();
    if (!value) throw new Error('Vui lòng nhập Username hoặc link TikTok Live');

    // Plain usernames and @user do not need a network request.
    if (!/^https?:\/\//i.test(value)) {
        const username = value.replace(/^@/, '').trim();
        if (!/^[\w.]+$/.test(username)) throw new Error('Username TikTok không hợp lệ');
        return username;
    }

    let currentUrl = new URL(value);
    for (let redirectCount = 0; redirectCount < 5; redirectCount++) {
        if (!TIKTOK_HOSTS.has(currentUrl.hostname.toLowerCase())) {
            throw new Error('Link phải thuộc tên miền TikTok');
        }

        const username = usernameFromTikTokUrl(currentUrl);
        if (username) return username;

        const response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(10000),
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        const location = response.headers.get('location');
        if (!location) break;
        currentUrl = new URL(location, currentUrl);
    }

    throw new Error('Không tìm thấy Username trong link TikTok Live');
}

module.exports = { resolveTikTokUsername };
