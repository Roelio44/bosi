import 'dotenv/config';
import crypto from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';

const PORT = Number(process.env.PORT) || 3000;
const NEXUSGGR_BASE = 'https://nexusggr.games';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const CACHE_TTL_MS = 10 * 60 * 1000;

interface NexusProvider {
    code: string;
    name: string;
    type: string;
    status: number;
    games: number | null;
}

interface NexusGame {
    id: number;
    game_code: string;
    game_name: string;
    banner: string;
    status: number;
    banners?: {
        portrait?: string;
        landscape?: string;
    };
    providerCode: string;
    providerName: string;
    categoryType: string;
}

interface UserRecord {
    _id: string;
    username: string;
    name: string;
    email: string;
    passwordHash: string;
    currency: string;
    avatar: string;
    balance: number;
    kyc: boolean;
    firstDeposit: boolean;
    stake: { name: string; value: number }[];
    preference: {
        userId: string;
        theme: string;
        hideUsername: boolean;
        maxBetAlert: boolean;
        currency: { _id: string; name: string; icon: string };
        depositEmailNotify: boolean;
        withdrawEmailNotify: boolean;
        marketingEmailNotify: boolean;
    };
    createdAt: string;
    updatedAt: string;
}

const CURRENCIES = [
    { _id: 'USD', name: 'USD', icon: '/assets/images/payment/USDT.webp' },
    { _id: 'EUR', name: 'EUR', icon: '/assets/images/payment/ETH.webp' },
    { _id: 'BRL', name: 'BRL', icon: '/assets/images/payment/BTC.webp' }
];

const DEFAULT_BANNERS = [
    { image: '/assets/images/home/players-banner.png', order: 1 },
    { image: '/assets/images/home/players-banner.png', order: 2 },
    { image: '/assets/images/home/players-banner.png', order: 3 }
];

interface BonusRecord {
    _id: string;
    autoCalc: boolean;
    banner: string;
    bonusCap: number;
    casino: boolean;
    createdAt: string;
    description: string;
    expireDate: string;
    isExpired: boolean;
    maxBet: number;
    minBet: number;
    multiply: number;
    name: string;
    option: string;
    percent: number;
    slot: boolean;
    status: boolean;
    updatedAt: string;
}

const usersByUsername = new Map<string, UserRecord>();
const disabledProviders = new Set<string>();
const siteBanners: { image: string; order: number }[] = [...DEFAULT_BANNERS];
const siteBonuses: BonusRecord[] = [
    {
        _id: 'welcome-deposit-bonus',
        autoCalc: true,
        banner: '/assets/images/home/players-banner.png',
        bonusCap: 5000,
        casino: true,
        createdAt: new Date().toISOString(),
        description: '<p>Enjoy a 100% Welcome Demo Bonus up to $5,000 across Slots and Live Casino tables.</p>',
        expireDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        isExpired: false,
        maxBet: 1000,
        minBet: 10,
        multiply: 30,
        name: '100% Welcome Bonus',
        option: 'deposit',
        percent: 100,
        slot: true,
        status: true,
        updatedAt: new Date().toISOString()
    }
];
const sportsbookConfig = {
    enabled: true,
    title: 'Nexustrike Sportsbook',
    currency: ['USD', 'EUR', 'BRL']
};

let claimedAdminPasswordHash: string | null = null;

let providersCache: { data: NexusProvider[]; expiresAt: number } | null = null;
const gamesCache = new Map<string, { data: NexusGame[]; expiresAt: number }>();

function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
    const [salt, hashHex] = stored.split(':');
    if (!salt || !hashHex) return false;
    const derived = crypto.scryptSync(password, salt, 64);
    const storedBuf = Buffer.from(hashHex, 'hex');
    if (derived.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derived, storedBuf);
}

function signToken(userId: string, username: string, role: 'user' | 'admin' = 'user'): string {
    const payload = Buffer.from(
        JSON.stringify({ sub: userId, username, role, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    return `${payload}.${sig}`;
}

function verifyToken(token: string): { sub: string; username: string; role?: string; exp: number } | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payload, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
    }
    try {
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!parsed.exp || parsed.exp < Date.now()) return null;
        return parsed;
    } catch {
        return null;
    }
}

function timingSafeSecretEqual(a: string, b: string): boolean {
    const digestA = crypto.createHash('sha256').update(a).digest();
    const digestB = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(digestA, digestB);
}

function getEnvAdminPasscode(): string {
    return (process.env.ADMIN_PASSCODE || '').trim();
}

function verifyAdminTokenFromReq(req: Request): boolean {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return false;
    }
    const token = authHeader.slice(7).trim();
    const decoded = verifyToken(token);
    return Boolean(decoded && decoded.role === 'admin');
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
    if (!verifyAdminTokenFromReq(req)) {
        return res.status(401).json({ message: 'Admin authentication required' });
    }
    next();
}

function sanitizeUser(user: UserRecord) {
    const { passwordHash: _ignored, ...safe } = user;
    return safe;
}

interface AuthedRequest extends Request {
    user?: UserRecord;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    const token = authHeader.slice(7).trim();
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ message: 'Invalid or expired session' });
    }
    const user = usersByUsername.get(decoded.username);
    if (!user) {
        return res.status(401).json({ message: 'User not found' });
    }
    req.user = user;
    next();
}

function isSafeExternalUrl(rawUrl: unknown): rawUrl is string {
    if (typeof rawUrl !== 'string') return false;
    try {
        const parsed = new URL(rawUrl);
        return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
        return false;
    }
}

function isSafeAssetOrHttpsUrl(rawUrl: unknown): rawUrl is string {
    if (typeof rawUrl !== 'string') return false;
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
        return true;
    }
    try {
        const parsed = new URL(trimmed);
        return parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function fetchProviders(): Promise<NexusProvider[]> {
    const now = Date.now();
    if (providersCache && providersCache.expiresAt > now) {
        return providersCache.data;
    }
    const response = await fetch(`${NEXUSGGR_BASE}/api/providers`, {
        signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
        throw new Error(`Providers fetch failed (${response.status})`);
    }
    const json: any = await response.json();
    const list: NexusProvider[] = Array.isArray(json?.data) ? json.data : [];
    providersCache = { data: list, expiresAt: now + CACHE_TTL_MS };
    return list;
}

async function fetchGamesByProvider(providerCode: string): Promise<NexusGame[]> {
    const cleanCode = String(providerCode || '').replace(/[^A-Za-z0-9_]/g, '');
    if (!cleanCode) return [];

    const now = Date.now();
    const cached = gamesCache.get(cleanCode);
    if (cached && cached.expiresAt > now) {
        return cached.data;
    }

    const providers = await fetchProviders();
    const providerMeta = providers.find((p) => p.code === cleanCode);
    if (!providerMeta) return [];

    const response = await fetch(`${NEXUSGGR_BASE}/api/games`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerCode: cleanCode, region: 'eu' }),
        signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) {
        return [];
    }
    const json: any = await response.json();
    const rawGames: any[] = Array.isArray(json?.data) ? json.data : [];
    const mapped: NexusGame[] = rawGames.map((g) => ({
        id: Number(g.id) || 0,
        game_code: String(g.game_code || ''),
        game_name: String(g.game_name || g.game_code || ''),
        banner: String(g.banners?.portrait || g.banner || '/assets/images/games/slot.png'),
        status: Number(g.status) || 1,
        banners: g.banners,
        providerCode: cleanCode,
        providerName: providerMeta.name,
        categoryType: providerMeta.type
    }));

    gamesCache.set(cleanCode, { data: mapped, expiresAt: now + CACHE_TTL_MS });
    return mapped;
}

async function fetchGamesFromProviders(codes: string[]): Promise<NexusGame[]> {
    const results = await Promise.all(codes.map((c) => fetchGamesByProvider(c).catch(() => [])));
    return results.flat();
}

function toAgGameShape(g: NexusGame) {
    return {
        gameCode: g.game_code,
        gameName: g.game_name,
        ownImg: g.banner,
        image_url: g.banner,
        provider: g.providerName,
        providerCode: g.providerCode,
        categoryCode: `AG_${g.providerCode}`,
        gameType: 'SLOT'
    };
}

function toProviderGameShape(g: NexusGame, productCode: number, gameType: string) {
    return {
        game_code: g.game_code,
        game_name: g.game_name,
        image_url: g.banner,
        ownImg: g.banner,
        product_code: productCode,
        provider: g.providerName,
        providerCode: g.providerCode,
        game_type: gameType,
        support_currency: 'USD,EUR,BRL'
    };
}

function mapFrontendTypeToProviders(gameType: string, allProviders: NexusProvider[]): NexusProvider[] {
    const active = allProviders.filter((p) => !disabledProviders.has(p.code));
    switch (gameType) {
        case 'LIVE_CASINO':
            return active.filter((p) => p.type === 'live');
        case 'FISHING':
            return active.filter((p) => p.type === 'FH');
        case 'POKER':
        case 'OTHER':
            return active.filter((p) => p.type === 'MN');
        case 'SLOT':
        case 'HOT_GAME':
        default:
            return active.filter((p) => p.type === 'slot');
    }
}

async function startServer() {
    const app = express();
    app.use(express.json({ limit: '1mb' }));

    // --- Site & Metadata Routes ---
    app.get('/api/setting/site', (_req, res) => {
        res.json({
            currencies: CURRENCIES,
            cryptoCurrencies: {
                USDT: [],
                BTC: [],
                ETH: []
            },
            banners: siteBanners
        });
    });

    app.get('/api/help', (_req, res) => {
        res.json([
            {
                _id: 'getting-started',
                title: 'Getting Started',
                content:
                    '<p>Browse slots, live dealer tables, crash &amp; mini games, fishing games, and live sportsbook powered by the NexusGGR Demo API. All games launch directly in free demo mode.</p>'
            },
            {
                _id: 'demo-credits',
                title: 'Demo Credits & Currencies',
                content:
                    '<p>Games launch in free demo mode using virtual demo credits so you can test slots, live casino tables, and sportsbook markets with zero risk.</p>'
            }
        ]);
    });

    app.get('/api/vip-level/list', (_req, res) => {
        res.json([
            { _id: 'bronze', levelName: 'Bronze 1', xp: 0, tiersName: 'Bronze', icon: '/assets/images/vip/bronze.png' },
            { _id: 'silver', levelName: 'Silver 1', xp: 5000, tiersName: 'Silver', icon: '/assets/images/vip/silver.png' },
            { _id: 'gold', levelName: 'Gold 1', xp: 25000, tiersName: 'Gold', icon: '/assets/images/vip/gold.png' }
        ]);
    });

    app.get('/api/bonus', (_req, res) => {
        res.json(siteBonuses.filter((b) => b.status));
    });

    app.get('/api/bonus/:id', (req, res) => {
        const found = siteBonuses.find((b) => b._id === req.params.id);
        if (!found) {
            return res.status(404).json({ message: 'Bonus not found' });
        }
        res.json(found);
    });

    // --- Sportsbook Routes ---
    app.get('/api/sport', (_req, res) => {
        res.json([
            {
                _id: 'nexustrike-116',
                provider: 'NEXUSTRIKE',
                currency: sportsbookConfig.currency,
                status: sportsbookConfig.enabled ? 'active' : 'maintenance',
                state: sportsbookConfig.enabled,
                provider_id: 116,
                product_id: 116,
                product_code: 116,
                game_type: 'SPORT_BOOK',
                product_title: sportsbookConfig.title,
                order: 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            }
        ]);
    });

    // --- Casino & Slot Catalog Routes (NexusGGR) ---
    app.get('/api/casino/ag-category', async (_req, res) => {
        try {
            const providers = await fetchProviders();
            const slotProviders = providers.filter((p) => p.type === 'slot' && !disabledProviders.has(p.code));
            res.json(
                slotProviders.map((p) => ({
                    categoryCode: `AG_${p.code}`,
                    categoryName: p.name
                }))
            );
        } catch (err) {
            console.error('ag-category error:', err);
            res.status(502).json({ message: 'Failed to load categories' });
        }
    });

    app.post('/api/casino/ag-games', async (req, res) => {
        try {
            const currentPage = Math.max(1, Number(req.body?.currentPage) || 1);
            const perPage = Math.min(100, Math.max(1, Number(req.body?.perPage) || 30));
            const categoryCodes: string[] = Array.isArray(req.body?.categoryCodes) ? req.body.categoryCodes : [];

            let targetCodes: string[];
            if (categoryCodes.includes('AG_HOT_PG')) {
                targetCodes = ['PGSOFT', 'PRAGMATIC'];
            } else if (categoryCodes.includes('AG_PP')) {
                targetCodes = ['PRAGMATIC', 'HACKSAW', 'NETENT'];
            } else if (categoryCodes.length > 0) {
                targetCodes = categoryCodes.map((c) => String(c).replace(/^AG_/, ''));
            } else {
                targetCodes = ['PGSOFT', 'PRAGMATIC', 'HACKSAW', 'NETENT'];
            }

            targetCodes = targetCodes.filter((code) => !disabledProviders.has(code));
            const games = await fetchGamesFromProviders(targetCodes);
            const start = (currentPage - 1) * perPage;
            const sliced = games.slice(start, start + perPage).map(toAgGameShape);

            res.json({ data: sliced, count: games.length });
        } catch (err) {
            console.error('ag-games error:', err);
            res.status(502).json({ data: [], count: 0 });
        }
    });

    app.get('/api/casino/ag-game-detail/:gameCode', async (req, res) => {
        try {
            const gameCode = String(req.params.gameCode || '');
            const defaultSlotCodes = ['PGSOFT', 'PRAGMATIC', 'HACKSAW', 'NETENT', 'PLAYNGO', 'JILI', 'HABANERO'];
            const games = await fetchGamesFromProviders(defaultSlotCodes);
            const found = games.find((g) => g.game_code === gameCode);
            if (!found) {
                return res.status(404).json({ message: 'Game not found' });
            }
            res.json(toAgGameShape(found));
        } catch (err) {
            console.error('ag-game-detail error:', err);
            res.status(502).json({ message: 'Failed to load game detail' });
        }
    });

    app.post('/api/casino/ag-launch', async (req, res) => {
        try {
            const gameCode = String(req.body?.gameCode || '').trim();
            if (!gameCode) {
                return res.status(400).json({ status: 0, message: 'gameCode is required' });
            }

            const allProviders = await fetchProviders();
            const slotCodes = allProviders.filter((p) => p.type === 'slot').map((p) => p.code);
            let matched: NexusGame | undefined;

            // Search cached providers first, then popular providers
            for (const code of slotCodes) {
                const cached = gamesCache.get(code);
                if (cached) {
                    matched = cached.data.find((g) => g.game_code === gameCode);
                    if (matched) break;
                }
            }
            if (!matched) {
                const fallbackGames = await fetchGamesFromProviders(['PGSOFT', 'PRAGMATIC', 'HACKSAW', 'NETENT']);
                matched = fallbackGames.find((g) => g.game_code === gameCode);
            }

            const providerCode = matched?.providerCode || 'PGSOFT';
            const launchRes = await fetch(`${NEXUSGGR_BASE}/api/game_launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerCode,
                    gameCode,
                    region: 'eu',
                    lang: 'en',
                    currency: 'USD'
                }),
                signal: AbortSignal.timeout(12000)
            });

            const launchJson: any = await launchRes.json();
            if (launchJson?.status && isSafeExternalUrl(launchJson?.url)) {
                return res.json({ status: 1, url: launchJson.url });
            }
            return res.status(502).json({ status: 0, message: launchJson?.msg || 'Could not launch game' });
        } catch (err) {
            console.error('ag-launch error:', err);
            res.status(502).json({ status: 0, message: 'Failed to launch game' });
        }
    });

    app.post('/api/casino/provider', async (req, res) => {
        try {
            const gameType = String(req.body?.gameType || 'LIVE_CASINO');
            const allProviders = await fetchProviders();
            const matched = mapFrontendTypeToProviders(gameType, allProviders);
            res.json(
                matched.map((p, idx) => ({
                    product_id: idx + 1,
                    product_code: idx + 1,
                    product_title: p.name,
                    provider: p.code,
                    provider_id: idx + 1,
                    game_type: gameType,
                    currency: 'USD,EUR,BRL'
                }))
            );
        } catch (err) {
            console.error('casino/provider error:', err);
            res.status(502).json([]);
        }
    });

    app.post('/api/casino/games', async (req, res) => {
        try {
            const gameType = String(req.body?.gameType || 'LIVE_CASINO');
            const currentPage = Math.max(1, Number(req.body?.currentPage) || 1);
            const perPage = Math.min(100, Math.max(1, Number(req.body?.perPage) || 15));
            const productIds: number[] = Array.isArray(req.body?.productIds) ? req.body.productIds.map(Number) : [];

            const allProviders = await fetchProviders();
            const matchedProviders = mapFrontendTypeToProviders(gameType, allProviders);
            const selectedProviders =
                productIds.length > 0
                    ? matchedProviders.filter((_, idx) => productIds.includes(idx + 1))
                    : matchedProviders.slice(0, 3);

            const codes = selectedProviders.map((p) => p.code);
            const allGames = await fetchGamesFromProviders(codes);

            let filtered = allGames;
            if (gameType === 'POKER') {
                const pokerLike = allGames.filter((g) => /hilo|roulette|keno|dice|goal|plinko/i.test(g.game_name));
                filtered = pokerLike.length > 0 ? pokerLike : allGames;
            }

            const start = (currentPage - 1) * perPage;
            const sliced = filtered.slice(start, start + perPage).map((g) => {
                const pIdx = Math.max(1, matchedProviders.findIndex((p) => p.code === g.providerCode) + 1);
                return toProviderGameShape(g, pIdx, gameType);
            });

            res.json({ data: sliced, count: filtered.length });
        } catch (err) {
            console.error('casino/games error:', err);
            res.status(502).json({ data: [], count: 0 });
        }
    });

    app.get('/api/casino/game-detail/:gameCode', async (req, res) => {
        try {
            const gameCode = String(req.params.gameCode || '');
            const candidateCodes = ['PP_LIVE_PRO', 'SPRIBE', 'FISHHUNTER', 'PGSOFT', 'PRAGMATIC'];
            const games = await fetchGamesFromProviders(candidateCodes);
            const found = games.find((g) => g.game_code === gameCode);
            if (!found) {
                return res.status(404).json({ message: 'Game not found' });
            }
            const gameType =
                found.categoryType === 'live'
                    ? 'LIVE_CASINO'
                    : found.categoryType === 'FH'
                      ? 'FISHING'
                      : 'OTHER';
            res.json(toProviderGameShape(found, 1, gameType));
        } catch (err) {
            console.error('game-detail error:', err);
            res.status(502).json({ message: 'Failed to load game detail' });
        }
    });

    app.post('/api/casino/launch', async (req, res) => {
        try {
            const gameType = String(req.body?.gameType || '');
            const currency = String(req.body?.currency || 'USD').replace(/[^A-Z0-9]/g, '') || 'USD';
            const lang = String(req.body?.language || 'en').replace(/[^a-zA-Z-]/g, '') || 'en';

            if (gameType === 'SPORT_BOOK') {
                if (!sportsbookConfig.enabled) {
                    return res.status(503).json({ status: 0, message: 'Sportsbook is currently paused by administrator' });
                }
                const sbRes = await fetch(`${NEXUSGGR_BASE}/api/sportsbook`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ region: 'eu', lang, currency }),
                    signal: AbortSignal.timeout(12000)
                });
                const sbJson: any = await sbRes.json();
                if (sbJson?.status && isSafeExternalUrl(sbJson?.url)) {
                    return res.json({ status: 1, url: sbJson.url });
                }
                return res.status(502).json({ status: 0, message: sbJson?.msg || 'Could not launch sportsbook' });
            }

            const gameCode = String(req.body?.gameCode || '').trim();
            if (!gameCode) {
                return res.status(400).json({ status: 0, message: 'gameCode is required' });
            }

            const candidateCodes = ['PP_LIVE_PRO', 'SPRIBE', 'FISHHUNTER', 'PGSOFT', 'PRAGMATIC'];
            let matched: NexusGame | undefined;
            for (const code of candidateCodes) {
                const cached = gamesCache.get(code);
                if (cached) {
                    matched = cached.data.find((g) => g.game_code === gameCode);
                    if (matched) break;
                }
            }
            if (!matched) {
                const games = await fetchGamesFromProviders(candidateCodes);
                matched = games.find((g) => g.game_code === gameCode);
            }

            const providerCode = matched?.providerCode || 'SPRIBE';
            const launchRes = await fetch(`${NEXUSGGR_BASE}/api/game_launch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    providerCode,
                    gameCode,
                    region: 'eu',
                    lang,
                    currency
                }),
                signal: AbortSignal.timeout(12000)
            });

            const launchJson: any = await launchRes.json();
            if (launchJson?.status && isSafeExternalUrl(launchJson?.url)) {
                return res.json({ status: 1, url: launchJson.url });
            }
            return res.status(502).json({ status: 0, message: launchJson?.msg || 'Could not launch game' });
        } catch (err) {
            console.error('casino/launch error:', err);
            res.status(502).json({ status: 0, message: 'Failed to launch game' });
        }
    });

    app.post('/api/casino/search', async (req, res) => {
        try {
            const name = String(req.body?.name || '').trim().toLowerCase();
            const gameType = String(req.body?.gameType || '');
            const perPage = Math.min(100, Math.max(1, Number(req.body?.perPage) || 40));

            let codes = ['PGSOFT', 'PRAGMATIC', 'SPRIBE', 'PP_LIVE_PRO', 'FISHHUNTER'];
            if (gameType === 'LIVE_CASINO') codes = ['PP_LIVE_PRO'];
            else if (gameType === 'FISHING') codes = ['FISHHUNTER'];
            else if (gameType === 'POKER' || gameType === 'OTHER') codes = ['SPRIBE'];
            else if (gameType === 'SLOT' || gameType === 'HOT_GAME') codes = ['PGSOFT', 'PRAGMATIC'];

            const games = await fetchGamesFromProviders(codes);
            const filtered = name
                ? games.filter((g) => g.game_name.toLowerCase().includes(name) || g.game_code.toLowerCase().includes(name))
                : games;

            const mapped = filtered.slice(0, perPage).map((g) => {
                if (g.categoryType === 'slot') {
                    return toAgGameShape(g);
                }
                const mappedType = g.categoryType === 'live' ? 'LIVE_CASINO' : g.categoryType === 'FH' ? 'FISHING' : 'OTHER';
                return toProviderGameShape(g, 1, mappedType);
            });

            res.json({ data: mapped, count: filtered.length });
        } catch (err) {
            console.error('casino/search error:', err);
            res.status(502).json({ data: [], count: 0 });
        }
    });

    app.get('/api/casino/recommend', async (_req, res) => {
        try {
            const games = await fetchGamesFromProviders(['SPRIBE', 'PGSOFT', 'PRAGMATIC']);
            res.json(games.slice(0, 12).map((g) => (g.categoryType === 'slot' ? toAgGameShape(g) : toProviderGameShape(g, 1, 'OTHER'))));
        } catch {
            res.json([]);
        }
    });

    app.get('/api/casino/recent-big-win', async (_req, res) => {
        try {
            const games = await fetchGamesFromProviders(['PGSOFT', 'SPRIBE']);
            const sample = games.slice(0, 12).map((g, idx) => ({
                game: {
                    image_url: g.banner,
                    game_name: g.game_name
                },
                profitAmount: (125.5 * (idx + 1)).toFixed(2),
                currency: 'USD'
            }));
            res.json(sample);
        } catch {
            res.json([]);
        }
    });

    // --- Auth & User Session Routes ---
    app.post('/api/auth/register', (req, res) => {
        const username = String(req.body?.username || '').trim();
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        const currencyId = String(req.body?.currencyId || 'USD');

        if (!username || username.length < 4 || !email || !password) {
            return res.status(400).json({ message: 'Username, email, and password are required' });
        }
        if (usersByUsername.has(username)) {
            return res.status(409).json({ message: 'Username already exists' });
        }

        const currencyObj = CURRENCIES.find((c) => c._id === currencyId) || CURRENCIES[0];
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();

        const user: UserRecord = {
            _id: userId,
            username,
            name: username,
            email,
            passwordHash: hashPassword(password),
            currency: currencyObj.name,
            avatar: '/assets/images/avatar/default.png',
            balance: 1000,
            kyc: false,
            firstDeposit: false,
            stake: [],
            preference: {
                userId,
                theme: 'dark',
                hideUsername: false,
                maxBetAlert: false,
                currency: currencyObj,
                depositEmailNotify: false,
                withdrawEmailNotify: false,
                marketingEmailNotify: false
            },
            createdAt: now,
            updatedAt: now
        };

        usersByUsername.set(username, user);
        res.status(201).json({ message: 'Registered successfully' });
    });

    app.post('/api/auth/login', (req, res) => {
        const username = String(req.body?.username || '').trim();
        const password = String(req.body?.password || '');
        const user = usersByUsername.get(username);
        if (!user || !verifyPassword(password, user.passwordHash)) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }
        const accessToken = signToken(user._id, user.username);
        res.json({ accessToken, user: sanitizeUser(user) });
    });

    app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
        res.json(sanitizeUser(req.user!));
    });

    app.post('/api/auth/logout', (_req, res) => {
        res.json({ ok: true });
    });

    app.get('/api/preference', requireAuth, (req: AuthedRequest, res) => {
        res.json({ ...req.user!.preference, language: 'en' });
    });

    app.patch('/api/preference', requireAuth, (req: AuthedRequest, res) => {
        req.user!.preference = { ...req.user!.preference, ...req.body };
        res.json(req.user!.preference);
    });

    app.get('/api/player/balance', requireAuth, (req: AuthedRequest, res) => {
        const currencyObj = CURRENCIES.find((c) => c.name === req.user!.currency) || CURRENCIES[0];
        res.json({
            amount: req.user!.balance,
            pending: 0,
            turnover: 0,
            bonus: 0,
            withdrawable: req.user!.balance,
            currency: currencyObj.name,
            icon: currencyObj.icon
        });
    });

    app.get('/api/player/my-games', requireAuth, (_req, res) => {
        res.json([]);
    });

    app.get('/api/notification', requireAuth, (_req, res) => {
        res.json([]);
    });

    // --- Admin Panel Routes ---
    app.get('/api/admin/status', (req, res) => {
        const envConfigured = Boolean(getEnvAdminPasscode());
        res.json({
            envConfigured,
            claimed: Boolean(claimedAdminPasswordHash),
            authenticated: verifyAdminTokenFromReq(req)
        });
    });

    app.post('/api/admin/claim', (req, res) => {
        if (getEnvAdminPasscode()) {
            return res.status(403).json({ message: 'Admin passcode is managed by environment configuration' });
        }
        if (claimedAdminPasswordHash) {
            return res.status(403).json({ message: 'Admin passcode has already been claimed' });
        }
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (password.length < 8 || password.length > 128) {
            return res.status(400).json({ message: 'Passcode must be between 8 and 128 characters' });
        }
        claimedAdminPasswordHash = hashPassword(password);
        return res.status(201).json({ accessToken: signToken('admin', 'admin', 'admin') });
    });

    app.post('/api/admin/login', (req, res) => {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!password || password.length > 128) {
            return res.status(400).json({ message: 'Passcode is required' });
        }
        const envPasscode = getEnvAdminPasscode();
        if (envPasscode) {
            if (!timingSafeSecretEqual(password, envPasscode)) {
                return res.status(401).json({ message: 'Invalid admin passcode' });
            }
            return res.json({ accessToken: signToken('admin', 'admin', 'admin') });
        }
        if (!claimedAdminPasswordHash) {
            return res.status(403).json({ message: 'Admin passcode has not been claimed yet' });
        }
        if (!verifyPassword(password, claimedAdminPasswordHash)) {
            return res.status(401).json({ message: 'Invalid admin passcode' });
        }
        return res.json({ accessToken: signToken('admin', 'admin', 'admin') });
    });

    app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
        try {
            const allUsers = Array.from(usersByUsername.values());
            const totalBalance = allUsers.reduce((sum, u) => sum + Number(u.balance || 0), 0);
            const providers = await fetchProviders().catch(() => []);
            const activeProviders = providers.filter((p) => !disabledProviders.has(p.code)).length;
            let cachedGamesCount = 0;
            for (const entry of gamesCache.values()) {
                cachedGamesCount += entry.data.length;
            }
            res.json({
                totalUsers: allUsers.length,
                totalBalance,
                totalProviders: providers.length,
                activeProviders,
                disabledProvidersCount: disabledProviders.size,
                cachedGamesCount,
                sportsbookEnabled: sportsbookConfig.enabled,
                bannersCount: siteBanners.length,
                bonusesCount: siteBonuses.length
            });
        } catch (err) {
            console.error('admin overview error:', err);
            res.status(500).json({ message: 'Failed to load admin overview' });
        }
    });

    app.get('/api/admin/users', requireAdmin, (_req, res) => {
        const list = Array.from(usersByUsername.values()).map(sanitizeUser);
        res.json(list);
    });

    app.post('/api/admin/users', requireAdmin, (req, res) => {
        const username = String(req.body?.username || '').trim();
        const email = String(req.body?.email || '').trim();
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        const currencyId = String(req.body?.currency || 'USD').trim();
        const initialBalance = Number(req.body?.balance ?? 1000);

        if (!username || username.length < 4 || !email || password.length < 6) {
            return res.status(400).json({ message: 'Valid username (4+ chars), email, and password (6+ chars) required' });
        }
        if (!Number.isFinite(initialBalance) || initialBalance < 0 || initialBalance > 1_000_000_000) {
            return res.status(400).json({ message: 'Initial balance must be a valid non-negative number' });
        }
        if (usersByUsername.has(username)) {
            return res.status(409).json({ message: 'Username already exists' });
        }

        const currencyObj = CURRENCIES.find((c) => c.name === currencyId || c._id === currencyId) || CURRENCIES[0];
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();

        const user: UserRecord = {
            _id: userId,
            username,
            name: username,
            email,
            passwordHash: hashPassword(password),
            currency: currencyObj.name,
            avatar: '/assets/images/avatar/default.png',
            balance: initialBalance,
            kyc: false,
            firstDeposit: false,
            stake: [],
            preference: {
                userId,
                theme: 'dark',
                hideUsername: false,
                maxBetAlert: false,
                currency: currencyObj,
                depositEmailNotify: false,
                withdrawEmailNotify: false,
                marketingEmailNotify: false
            },
            createdAt: now,
            updatedAt: now
        };
        usersByUsername.set(username, user);
        res.status(201).json(sanitizeUser(user));
    });

    app.patch('/api/admin/users/:id/balance', requireAdmin, (req, res) => {
        const target = Array.from(usersByUsername.values()).find((u) => u._id === req.params.id);
        if (!target) {
            return res.status(404).json({ message: 'User not found' });
        }
        const mode = String(req.body?.mode || 'credit');
        const amount = Number(req.body?.amount);
        if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000) {
            return res.status(400).json({ message: 'Amount must be a finite non-negative number' });
        }
        if (mode === 'set') {
            target.balance = Number(amount.toFixed(2));
        } else if (mode === 'debit') {
            target.balance = Number(Math.max(0, target.balance - amount).toFixed(2));
        } else {
            target.balance = Number((target.balance + amount).toFixed(2));
        }
        target.updatedAt = new Date().toISOString();
        res.json(sanitizeUser(target));
    });

    app.patch('/api/admin/users/:id/kyc', requireAdmin, (req, res) => {
        const target = Array.from(usersByUsername.values()).find((u) => u._id === req.params.id);
        if (!target) {
            return res.status(404).json({ message: 'User not found' });
        }
        target.kyc = Boolean(req.body?.kyc);
        target.updatedAt = new Date().toISOString();
        res.json(sanitizeUser(target));
    });

    app.get('/api/admin/providers', requireAdmin, async (_req, res) => {
        try {
            const providers = await fetchProviders();
            res.json({
                providers: providers.map((p) => ({
                    ...p,
                    enabled: !disabledProviders.has(p.code)
                })),
                sportsbook: sportsbookConfig
            });
        } catch (err) {
            console.error('admin providers error:', err);
            res.status(502).json({ message: 'Failed to load NexusGGR providers' });
        }
    });

    app.patch('/api/admin/providers/:code', requireAdmin, (req, res) => {
        const code = String(req.params.code || '').replace(/[^A-Za-z0-9_]/g, '');
        if (!code) {
            return res.status(400).json({ message: 'Invalid provider code' });
        }
        const enabled = Boolean(req.body?.enabled);
        if (enabled) {
            disabledProviders.delete(code);
        } else {
            disabledProviders.add(code);
        }
        res.json({ code, enabled });
    });

    app.patch('/api/admin/sportsbook', requireAdmin, (req, res) => {
        if (typeof req.body?.enabled === 'boolean') {
            sportsbookConfig.enabled = req.body.enabled;
        }
        if (typeof req.body?.title === 'string' && req.body.title.trim()) {
            sportsbookConfig.title = req.body.title.trim().slice(0, 60);
        }
        res.json(sportsbookConfig);
    });

    app.post('/api/admin/cache/refresh', requireAdmin, async (_req, res) => {
        try {
            providersCache = null;
            gamesCache.clear();
            const providers = await fetchProviders();
            res.json({ ok: true, providersCount: providers.length });
        } catch (err) {
            console.error('cache refresh error:', err);
            res.status(502).json({ message: 'Failed to refresh NexusGGR cache' });
        }
    });

    app.get('/api/admin/banners', requireAdmin, (_req, res) => {
        res.json(siteBanners);
    });

    app.post('/api/admin/banners', requireAdmin, (req, res) => {
        const image = typeof req.body?.image === 'string' ? req.body.image.trim() : '';
        if (!isSafeAssetOrHttpsUrl(image)) {
            return res.status(400).json({ message: 'Banner URL must start with / or https://' });
        }
        siteBanners.push({ image, order: siteBanners.length + 1 });
        res.status(201).json(siteBanners);
    });

    app.delete('/api/admin/banners/:index', requireAdmin, (req, res) => {
        const idx = Number(req.params.index);
        if (!Number.isInteger(idx) || idx < 0 || idx >= siteBanners.length) {
            return res.status(404).json({ message: 'Banner not found' });
        }
        siteBanners.splice(idx, 1);
        siteBanners.forEach((b, i) => {
            b.order = i + 1;
        });
        res.json(siteBanners);
    });

    app.get('/api/admin/bonuses', requireAdmin, (_req, res) => {
        res.json(siteBonuses);
    });

    app.post('/api/admin/bonuses', requireAdmin, (req, res) => {
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const banner = typeof req.body?.banner === 'string' ? req.body.banner.trim() : '/assets/images/home/players-banner.png';
        const descriptionRaw = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
        const percent = Number(req.body?.percent ?? 100);
        const bonusCap = Number(req.body?.bonusCap ?? 1000);
        const expireDays = Math.max(1, Math.min(365, Number(req.body?.expireDays ?? 30)));

        if (!name || name.length > 80) {
            return res.status(400).json({ message: 'Bonus name is required (max 80 chars)' });
        }
        if (!isSafeAssetOrHttpsUrl(banner)) {
            return res.status(400).json({ message: 'Banner URL must start with / or https://' });
        }
        if (!Number.isFinite(percent) || percent < 1 || percent > 1000) {
            return res.status(400).json({ message: 'Bonus percent must be between 1 and 1000' });
        }
        if (!Number.isFinite(bonusCap) || bonusCap < 1 || bonusCap > 1_000_000) {
            return res.status(400).json({ message: 'Bonus cap must be between 1 and 1,000,000' });
        }

        const now = new Date().toISOString();
        const record: BonusRecord = {
            _id: crypto.randomUUID(),
            autoCalc: true,
            banner,
            bonusCap,
            casino: true,
            createdAt: now,
            description: `<p>${escapeHtml(descriptionRaw || name)}</p>`,
            expireDate: new Date(Date.now() + expireDays * 24 * 60 * 60 * 1000).toISOString(),
            isExpired: false,
            maxBet: 1000,
            minBet: 10,
            multiply: 30,
            name,
            option: 'deposit',
            percent,
            slot: true,
            status: true,
            updatedAt: now
        };
        siteBonuses.unshift(record);
        res.status(201).json(record);
    });

    app.delete('/api/admin/bonuses/:id', requireAdmin, (req, res) => {
        const idx = siteBonuses.findIndex((b) => b._id === req.params.id);
        if (idx === -1) {
            return res.status(404).json({ message: 'Bonus not found' });
        }
        siteBonuses.splice(idx, 1);
        res.json({ ok: true });
    });

    // --- Vite Dev Middleware / Production Static Serving ---
    if (process.env.NODE_ENV === 'production') {
        const distDir = path.resolve(process.cwd(), 'dist');
        app.use(express.static(distDir));
        app.use((req, res, next) => {
            if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
                return next();
            }
            res.sendFile(path.join(distDir, 'index.html'));
        });
    } else {
        const { createServer: createViteServer } = await import('vite');
        const vite = await createViteServer({
            server: {
                middlewareMode: true,
                hmr: process.env.DISABLE_HMR !== 'true'
            },
            appType: 'spa'
        });
        app.use(vite.middlewares);

        app.use(async (req, res, next) => {
            if (req.method !== 'GET' || req.originalUrl.startsWith('/api')) {
                return next();
            }
            try {
                const indexHtml = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
                const html = await vite.transformIndexHtml(req.originalUrl, indexHtml);
                res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
            } catch (e) {
                vite.ssrFixStacktrace(e as Error);
                next(e);
            }
        });
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server listening on http://0.0.0.0:${PORT}`);
    });
}

startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
