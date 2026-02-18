/**
 * WhatsApp Bot SaaS — Multi-user Server
 * Express + Socket.io + Baileys (no Puppeteer!) + Firebase Admin
 *
 * Each authenticated user gets their own:
 *  - WhatsApp Baileys socket (lightweight, ~20-30 MB per bot)
 *  - Configuration (saved per UID)
 *  - Socket.io room (events only reach their browser)
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server: SocketServer } = require('socket.io');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { getAIResponse } = require('./aiService');
const Stripe = require('stripe');

// ─── Baileys (lightweight WhatsApp library — no Chrome!) ─
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

// ─── Firebase Admin + Firestore ─────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
    // Local dev: load from file if it exists
    const saPath = path.join(__dirname, 'firebase-service-account.json');
    if (fs.existsSync(saPath)) {
        serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
    } else {
        console.error('❌ FIREBASE_SERVICE_ACCOUNT env var is not set and firebase-service-account.json not found!');
        console.error('   Set the FIREBASE_SERVICE_ACCOUNT variable in Railway with the JSON content.');
        process.exit(1);
    }
}
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id || 'chatbot-1d169'
});
const db = admin.firestore();

// ─── Stripe ─────────────────────────────────────────────
const STRIPE_SECRET_KEY  = process.env.STRIPE_SECRET_KEY  || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = new Stripe(STRIPE_SECRET_KEY);

// Plans definition (MXN)
const PLANS = {
    monthly: {
        id: 'monthly',
        name: 'Mensual',
        price: 7900,          // $79.00 MXN in centavos
        currency: 'mxn',
        duration: 1,          // 1 month
        bonus: 0,
        label: '$79 MXN / mes',
        description: '1 mes de Botly',
        badge: null
    },
    quarterly: {
        id: 'quarterly',
        name: 'Trimestral',
        price: 23700,         // $237.00 MXN in centavos
        currency: 'mxn',
        duration: 3,          // 3 months paid
        bonus: 1,             // +1 month free = 4 months total
        label: '$237 MXN / 3 meses',
        description: '3 meses + 1 mes gratis (4 meses total)',
        badge: '+1 mes gratis'
    },
    yearly: {
        id: 'yearly',
        name: 'Anual',
        price: 94800,         // $948.00 MXN in centavos
        currency: 'mxn',
        duration: 12,         // 12 months paid
        bonus: 6,             // +6 months free = 18 months total
        label: '$948 MXN / año',
        description: '12 meses + 6 meses gratis (18 meses total)',
        badge: '+6 meses gratis'
    }
};

// ─── Config ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// Emails that bypass subscription checks (admin/owner accounts)
const FREE_PASS_EMAILS = ['yoelskygold@gmail.com'];

// ─── Express + Socket.io ─────────────────────────────────
const app    = express();
const server = http.createServer(app);
const io     = new SocketServer(server, { cors: { origin: '*' } });

// Stripe webhook needs raw body — MUST come before express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    console.log('[Stripe] 📨 Webhook received!');
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        if (STRIPE_WEBHOOK_SECRET) {
            event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
        } else {
            event = JSON.parse(req.body.toString());
        }
    } catch (err) {
        console.error('[Stripe] Webhook signature error:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    console.log(`[Stripe] Event type: ${event.type}`);

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const uid = session.metadata?.uid;
        const planId = session.metadata?.planId;
        if (uid && planId) {
            const plan = PLANS[planId];
            const totalMonths = plan ? (plan.duration + plan.bonus) : 1;
            const now = new Date();
            // Check if user already has active sub — extend from expiresAt
            const existing = await loadUserConfig(uid);
            let startFrom = now;
            if (existing.subscription && existing.subscription.expiresAt) {
                const existingExpiry = new Date(existing.subscription.expiresAt);
                if (existingExpiry > now) startFrom = existingExpiry;
            }
            const expiresAt = new Date(startFrom);
            expiresAt.setMonth(expiresAt.getMonth() + totalMonths);

            await saveUserConfig(uid, {
                subscription: {
                    active: true,
                    planId: planId,
                    planName: plan?.name || planId,
                    paidAt: now.toISOString(),
                    expiresAt: expiresAt.toISOString(),
                    stripeSessionId: session.id,
                    stripeCustomerId: session.customer || null,
                    totalMonths: totalMonths
                }
            });
            console.log(`[Stripe] ✅ Subscription activated for ${uid}: ${planId} (${totalMonths} months until ${expiresAt.toISOString()})`);
            io.to(`user_${uid}`).emit('subscription_updated', { active: true, planId, expiresAt: expiresAt.toISOString() });
        }
    }

    res.json({ received: true });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src', 'public')));

// ══════════════════════════════════════════════════════════
//  IN-MEMORY CACHES (avoid repeated network round-trips)
// ══════════════════════════════════════════════════════════

// Token verification cache: raw-token → { uid, email, name, ts }
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// User config cache: uid → { data, ts }
const configCache = new Map();
const CONFIG_CACHE_TTL = 30 * 1000; // 30 seconds

// Periodic cleanup every 10 min to avoid unbounded growth
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of tokenCache)  if (now - v.ts > TOKEN_CACHE_TTL)  tokenCache.delete(k);
    for (const [k, v] of configCache) if (now - v.ts > CONFIG_CACHE_TTL) configCache.delete(k);
}, 10 * 60 * 1000);

// ─── Per-user state ──────────────────────────────────────
// Maps: uid → { client, status, lastQR, stats }
const userBots = new Map();

// ─── Messages storage (Firestore: users/{uid}/messages) ──
async function loadMessages(uid) {
    try {
        const snap = await db.collection('users').doc(uid).collection('messages')
            .orderBy('timestamp', 'asc').limit(500).get();
        return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
    } catch (e) { console.error('[Firestore] loadMessages error:', e.message); }
    return [];
}

async function saveMessage(uid, msgObj) {
    try {
        await db.collection('users').doc(uid).collection('messages').add(msgObj);
    } catch (e) { console.error('[Firestore] saveMessage error:', e.message); }
    return msgObj;
}

async function clearMessages(uid) {
    try {
        const snap = await db.collection('users').doc(uid).collection('messages').get();
        const batch = db.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
    } catch (e) { console.error('[Firestore] clearMessages error:', e.message); }
}

// ─── Firebase Auth Middleware (cached) ───────────────────
async function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido.' });
    }
    const raw = header.slice(7);

    // Check token cache first (avoids ~300-500 ms Firebase round-trip)
    const cached = tokenCache.get(raw);
    if (cached && Date.now() - cached.ts < TOKEN_CACHE_TTL) {
        req.uid   = cached.uid;
        req.email = cached.email;
        req.name  = cached.name;
        // Prevent browser from caching per-user API responses across accounts
        res.set('Cache-Control', 'no-store');
        return next();
    }

    try {
        const decoded = await admin.auth().verifyIdToken(raw);
        req.uid   = decoded.uid;
        req.email = decoded.email || '';
        req.name  = decoded.name || '';
        tokenCache.set(raw, { uid: decoded.uid, email: decoded.email || '', name: decoded.name || '', ts: Date.now() });
        // Prevent browser from caching per-user API responses across accounts
        res.set('Cache-Control', 'no-store');
        next();
    } catch (err) {
        tokenCache.delete(raw);
        return res.status(401).json({ error: 'Token inválido o expirado.' });
    }
}

// ─── Config helpers (Firestore: users/{uid} — cached) ───
async function loadUserConfig(uid) {
    // Check in-memory cache first (avoids ~300 ms Firestore round-trip)
    const cached = configCache.get(uid);
    if (cached && Date.now() - cached.ts < CONFIG_CACHE_TTL) {
        return cached.data;
    }
    try {
        const doc = await db.collection('users').doc(uid).get();
        const data = doc.exists ? doc.data() : {};
        configCache.set(uid, { data, ts: Date.now() });
        return data;
    } catch (e) { console.error('[Firestore] loadUserConfig error:', e.message); }
    return {};
}

async function saveUserConfig(uid, data) {
    try {
        await db.collection('users').doc(uid).set(data, { merge: true });
        // Invalidate cache so next read fetches fresh merged data
        configCache.delete(uid);
    } catch (e) { console.error('[Firestore] saveUserConfig error:', e.message); }
    return data;
}

// ══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ══════════════════════════════════════════════════════════

// Save user profile after registration (optional extra data)
// Also grants a 1-day free trial for NEW users.
app.post('/api/auth/profile', authMiddleware, async (req, res) => {
    const { name, businessName } = req.body;

    // Check if user already exists (returning user vs brand-new)
    const existing = await loadUserConfig(req.uid);
    const isNewUser = !existing.createdAt;

    const profileData = {
        name: name || req.name,
        businessName: businessName || '',
        email: req.email,
        createdAt: existing.createdAt || new Date().toISOString()
    };

    // Grant 1-day trial ONLY to brand-new users who have no subscription
    if (isNewUser && !existing.subscription) {
        const now = new Date();
        const trialExpiry = new Date(now);
        trialExpiry.setDate(trialExpiry.getDate() + 1); // +1 day

        profileData.subscription = {
            active: true,
            planId: 'trial',
            planName: 'Prueba gratuita (1 día)',
            paidAt: now.toISOString(),
            expiresAt: trialExpiry.toISOString(),
            stripeSessionId: null,
            stripeCustomerId: null,
            totalMonths: 0,
            isTrial: true
        };
        console.log(`[Auth] 🎁 1-day trial granted to ${req.email} (expires ${trialExpiry.toISOString()})`);
    }

    const config = await saveUserConfig(req.uid, profileData);
    console.log(`[Auth] Profile saved: ${req.email} (${req.uid})`);
    res.json({ ok: true, data: config });
});

// ══════════════════════════════════════════════════════════
//  CONFIG ROUTES (protected)
// ══════════════════════════════════════════════════════════

app.get('/api/config', authMiddleware, async (req, res) => {
    const config = await loadUserConfig(req.uid);
    res.json({ ok: true, data: config });
});

app.post('/api/config', authMiddleware, async (req, res) => {
    const config = await saveUserConfig(req.uid, req.body);
    console.log(`[Config] Updated for ${req.email}`);
    res.json({ ok: true, data: config });
});

// ══════════════════════════════════════════════════════════
//  BOT ROUTES (protected — one bot per user)
// ══════════════════════════════════════════════════════════

app.get('/api/bot/status', authMiddleware, (req, res) => {
    const bot = userBots.get(req.uid);
    res.json({
        ok: true,
        status: bot ? bot.status : 'off',
        qrPending: bot?.status === 'qr',
        stats: bot?.stats || { messagesToday: 0, contactsCount: 0 }
    });
});

app.post('/api/bot/start', authMiddleware, async (req, res) => {
    const uid = req.uid;

    // Admin bypass
    const isAdmin = FREE_PASS_EMAILS.includes(req.email);

    // Check subscription/trial before starting bot
    if (!isAdmin) {
        const config = await loadUserConfig(uid);
        const sub = config.subscription;
        if (!sub || !sub.expiresAt || new Date(sub.expiresAt) <= new Date()) {
            const reason = sub?.isTrial ? 'trial_expired' : (!sub ? 'no_subscription' : 'expired');
            return res.status(403).json({
                error: reason === 'trial_expired'
                    ? 'Tu prueba gratuita ha expirado. Suscríbete para seguir usando Botly.'
                    : 'Se requiere una suscripción activa para iniciar el bot.',
                reason
            });
        }
    }

    const existing = userBots.get(uid);
    if (existing && (existing.status === 'connected' || existing.status === 'qr' || existing.status === 'starting')) {
        return res.json({ ok: true, message: `Bot ya está en estado: ${existing.status}` });
    }

    startBot(uid, req.email);
    res.json({ ok: true, message: 'Bot iniciando… el QR aparecerá en segundos.' });
});

app.post('/api/bot/stop', authMiddleware, async (req, res) => {
    await stopBot(req.uid);
    res.json({ ok: true, message: 'Bot detenido.' });
});

// Reset session — destroy client, wipe auth folder, restart for new QR
app.post('/api/bot/reset', authMiddleware, async (req, res) => {
    const uid = req.uid;
    console.log(`[Bot] Reset requested by ${req.email} (${uid})`);

    // 1. Stop the running bot if any
    await stopBot(uid);

    // 2. Delete the local auth data for this user so a fresh QR is generated
    const authDir = path.join(__dirname, '.baileys_auth', uid);
    try {
        if (fs.existsSync(authDir)) {
            fs.rmSync(authDir, { recursive: true, force: true });
            console.log(`[Bot] Auth data removed for ${uid}`);
        }
    } catch (e) {
        console.error(`[Bot] Error removing auth data:`, e.message);
    }

    // 3. Restart the bot — a new QR will be emitted via socket
    startBot(uid, req.email);
    res.json({ ok: true, message: 'Sesión reseteada. Un nuevo QR aparecerá en segundos.' });
});

// ══════════════════════════════════════════════════════════
//  MESSAGES ROUTES (protected)
// ══════════════════════════════════════════════════════════

app.get('/api/messages', authMiddleware, async (req, res) => {
    const msgs = await loadMessages(req.uid);
    res.json({ ok: true, data: msgs });
});

// Get conversations (grouped by contact)
app.get('/api/conversations', authMiddleware, async (req, res) => {
    const msgs = await loadMessages(req.uid);
    const convos = {};
    msgs.forEach(m => {
        const key = m.from;
        if (!convos[key]) {
            convos[key] = { phone: key, senderName: m.senderName || key, messages: [], lastMessage: null, lastTimestamp: null, unread: 0 };
        }
        convos[key].messages.push(m);
        convos[key].lastMessage = m.body;
        convos[key].lastTimestamp = m.timestamp;
        convos[key].senderName = m.senderName || convos[key].senderName;
        if (m.direction === 'incoming') convos[key].unread++;
    });
    // Sort by last message time (newest first)
    const sorted = Object.values(convos).sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp));
    res.json({ ok: true, data: sorted });
});

// Get messages for a specific contact
app.get('/api/messages/:phone', authMiddleware, async (req, res) => {
    const msgs = await loadMessages(req.uid);
    const phone = req.params.phone;
    const filtered = msgs.filter(m => m.from === phone);
    res.json({ ok: true, data: filtered });
});

// Send a manual message
app.post('/api/messages/send', authMiddleware, async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
        return res.status(400).json({ error: 'Se requiere phone y message.' });
    }
    const bot = userBots.get(req.uid);
    if (!bot || bot.status !== 'connected') {
        return res.status(400).json({ error: 'El bot no está conectado.' });
    }
    try {
        const chatId = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
        await bot.sock.sendMessage(chatId, { text: message });
        const msgObj = {
            id: 'manual_' + Date.now(),
            from: phone.replace('@c.us', ''),
            senderName: 'Tú (manual)',
            body: message,
            direction: 'outgoing',
            timestamp: new Date().toISOString()
        };
        await saveMessage(req.uid, msgObj);
        io.to(`user_${req.uid}`).emit('new_message', msgObj);
        console.log(`[Bot][${req.email}] ✉️ Manual msg to ${phone}: ${message.substring(0, 60)}`);
        res.json({ ok: true, data: msgObj });
    } catch (e) {
        console.error(`[Bot] Send error:`, e.message);
        res.status(500).json({ error: 'Error al enviar: ' + e.message });
    }
});

app.delete('/api/messages', authMiddleware, async (req, res) => {
    await clearMessages(req.uid);
    res.json({ ok: true, message: 'Historial de mensajes borrado.' });
});

// ══════════════════════════════════════════════════════════
//  RESPONSE MODE & PER-CHAT PAUSE ROUTES
// ══════════════════════════════════════════════════════════

// Set response mode: 'auto' or 'semiauto'
app.post('/api/config/response-mode', authMiddleware, async (req, res) => {
    const { mode } = req.body;
    if (!['auto', 'semiauto'].includes(mode)) {
        return res.status(400).json({ error: 'Modo inválido. Usa "auto" o "semiauto".' });
    }
    await saveUserConfig(req.uid, { responseMode: mode });
    console.log(`[Config] Response mode set to '${mode}' for ${req.email}`);
    res.json({ ok: true, mode });
});

// Get response mode
app.get('/api/config/response-mode', authMiddleware, async (req, res) => {
    const config = await loadUserConfig(req.uid);
    res.json({ ok: true, mode: config.responseMode || 'auto' });
});

// Pause bot for a specific chat
app.post('/api/bot/pause-chat', authMiddleware, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Se requiere phone.' });
    const config = await loadUserConfig(req.uid);
    const paused = config.pausedChats || [];
    if (!paused.includes(phone)) paused.push(phone);
    await saveUserConfig(req.uid, { pausedChats: paused });
    console.log(`[Bot][${req.email}] ⏸ Paused chat: ${phone}`);
    res.json({ ok: true, pausedChats: paused });
});

// Resume bot for a specific chat
app.post('/api/bot/resume-chat', authMiddleware, async (req, res) => {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Se requiere phone.' });
    const config = await loadUserConfig(req.uid);
    const paused = (config.pausedChats || []).filter(p => p !== phone);
    await saveUserConfig(req.uid, { pausedChats: paused });
    console.log(`[Bot][${req.email}] ▶ Resumed chat: ${phone}`);
    res.json({ ok: true, pausedChats: paused });
});

// Get paused chats
app.get('/api/bot/paused-chats', authMiddleware, async (req, res) => {
    const config = await loadUserConfig(req.uid);
    res.json({ ok: true, pausedChats: config.pausedChats || [] });
});

// Approve AI reply for semi-auto mode
app.post('/api/bot/approve-reply', authMiddleware, async (req, res) => {
    const { phone, msgId } = req.body;
    if (!phone) return res.status(400).json({ error: 'Se requiere phone.' });
    const bot = userBots.get(req.uid);
    if (!bot || bot.status !== 'connected') {
        return res.status(400).json({ error: 'El bot no está conectado.' });
    }
    try {
        const jid = phone.includes('@') ? phone : phone + '@s.whatsapp.net';
        const config = await loadUserConfig(req.uid);
        // Find the pending message to get context
        const msgs = await loadMessages(req.uid);
        const pendingIncoming = msgs.filter(m => m.from === phone && m.direction === 'incoming');
        const lastIncoming = pendingIncoming[pendingIncoming.length - 1];
        const text = lastIncoming ? lastIncoming.body : '';
        const senderName = lastIncoming ? lastIncoming.senderName : phone;

        const reply = await getAIResponse(req.uid, jid, text, senderName, config);
        await bot.sock.sendMessage(jid, { text: reply });

        const outgoingMsg = {
            id: (msgId || 'approve_' + Date.now()) + '_reply',
            from: phone,
            senderName: senderName,
            body: reply,
            direction: 'outgoing',
            timestamp: new Date().toISOString()
        };
        await saveMessage(req.uid, outgoingMsg);
        io.to(`user_${req.uid}`).emit('new_message', outgoingMsg);
        console.log(`[Bot][${req.email}] ✅ Approved AI reply to ${phone}`);
        res.json({ ok: true, data: outgoingMsg });
    } catch (e) {
        console.error(`[Bot] Approve reply error:`, e.message);
        res.status(500).json({ error: 'Error al enviar respuesta: ' + e.message });
    }
});

// ══════════════════════════════════════════════════════════
//  STRIPE / SUBSCRIPTION ROUTES
// ══════════════════════════════════════════════════════════

// Get available plans
app.get('/api/plans', (_req, res) => {
    res.json({ ok: true, data: PLANS });
});

// Get user subscription status
app.get('/api/subscription', authMiddleware, async (req, res) => {
    // Admin always has access
    if (FREE_PASS_EMAILS.includes(req.email)) {
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, data: { active: true, planId: 'admin', planName: 'Administrador', expiresAt: null, isAdmin: true } });
    }

    const config = await loadUserConfig(req.uid);
    const sub = config.subscription || null;
    let active = false;
    let reason = null;
    if (sub && sub.expiresAt) {
        active = new Date(sub.expiresAt) > new Date();
        if (!active) {
            reason = sub.isTrial ? 'trial_expired' : 'expired';
        }
    } else {
        reason = 'no_subscription';
    }

    // Calculate remaining hours for trial
    let trialHoursLeft = null;
    if (sub && sub.isTrial && active) {
        const msLeft = new Date(sub.expiresAt) - new Date();
        trialHoursLeft = Math.max(0, Math.round(msLeft / (1000 * 60 * 60) * 10) / 10);
    }

    // no-store: browser must NEVER cache this — data is per-user
    res.set('Cache-Control', 'no-store');
    res.json({
        ok: true,
        data: sub
            ? { ...sub, active, reason, trialHoursLeft }
            : { active: false, reason: 'no_subscription' }
    });
});

// Create Stripe Checkout session
app.post('/api/stripe/checkout', authMiddleware, async (req, res) => {
    const { planId } = req.body;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Plan inválido.' });

    // ── Free-pass: activate instantly for owner/demo accounts ──
    if (FREE_PASS_EMAILS.includes(req.email)) {
        const totalMonths = plan.duration + plan.bonus;
        const now = new Date();
        const existing = await loadUserConfig(req.uid);
        let startFrom = now;
        if (existing.subscription && existing.subscription.expiresAt) {
            const existingExpiry = new Date(existing.subscription.expiresAt);
            if (existingExpiry > now) startFrom = existingExpiry;
        }
        const expiresAt = new Date(startFrom);
        expiresAt.setMonth(expiresAt.getMonth() + totalMonths);

        await saveUserConfig(req.uid, {
            subscription: {
                active: true,
                planId: planId,
                planName: plan.name,
                paidAt: now.toISOString(),
                expiresAt: expiresAt.toISOString(),
                stripeSessionId: 'free_pass_' + Date.now(),
                stripeCustomerId: null,
                totalMonths: totalMonths
            }
        });
        console.log(`[Stripe] 🎫 Free-pass subscription for ${req.email}: ${planId} (${totalMonths} months until ${expiresAt.toISOString()})`);
        io.to(`user_${req.uid}`).emit('subscription_updated', { active: true, planId, expiresAt: expiresAt.toISOString() });
        // Redirect to success — client will handle this as a simulated payment
        return res.json({ ok: true, freePass: true, plan: plan.name, totalMonths, expiresAt: expiresAt.toISOString() });
    }

    // ── Normal paid flow via Stripe Checkout ──
    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: plan.currency,
                    product_data: {
                        name: `Botly — Plan ${plan.name}`,
                        description: plan.description
                    },
                    unit_amount: plan.price
                },
                quantity: 1
            }],
            metadata: {
                uid: req.uid,
                planId: plan.id,
                email: req.email
            },
            customer_email: req.email,
            success_url: `${req.protocol}://${req.get('host')}/?payment=success&plan=${planId}&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${req.protocol}://${req.get('host')}/?payment=cancelled`
        });
        console.log(`[Stripe] Checkout created for ${req.email}: ${planId} → ${session.id}`);
        res.json({ ok: true, url: session.url });
    } catch (err) {
        console.error('[Stripe] Checkout error:', err.message);
        res.status(500).json({ error: 'Error al crear sesión de pago: ' + err.message });
    }
});

// ─── Verify Stripe session (called when user returns from checkout) ───
app.get('/api/stripe/verify-session', authMiddleware, async (req, res) => {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id requerido.' });

    try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        // Only process paid sessions
        if (session.payment_status !== 'paid') {
            return res.json({ ok: false, error: 'Pago no completado', status: session.payment_status });
        }

        // Only process if it belongs to this user
        const uid = session.metadata?.uid;
        if (uid !== req.uid) {
            return res.status(403).json({ error: 'Sesión no corresponde a este usuario.' });
        }

        const planId = session.metadata?.planId;
        const plan = PLANS[planId];
        if (!plan) return res.status(400).json({ error: 'Plan inválido en sesión.' });

        // Check if this session was already processed (idempotency)
        const existing = await loadUserConfig(uid);
        if (existing.subscription && existing.subscription.stripeSessionId === sessionId) {
            console.log(`[Stripe] ✅ Session already processed for ${req.email}: ${sessionId}`);
            return res.json({ ok: true, alreadyProcessed: true, data: existing.subscription });
        }

        // Activate subscription
        const totalMonths = plan.duration + plan.bonus;
        const now = new Date();
        let startFrom = now;
        if (existing.subscription && existing.subscription.expiresAt) {
            const existingExpiry = new Date(existing.subscription.expiresAt);
            if (existingExpiry > now) startFrom = existingExpiry;
        }
        const expiresAt = new Date(startFrom);
        expiresAt.setMonth(expiresAt.getMonth() + totalMonths);

        const subData = {
            active: true,
            planId: planId,
            planName: plan.name,
            paidAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            stripeSessionId: sessionId,
            stripeCustomerId: session.customer || null,
            totalMonths: totalMonths
        };

        await saveUserConfig(uid, { subscription: subData });
        console.log(`[Stripe] ✅ Subscription verified & activated for ${req.email}: ${planId} (${totalMonths} months until ${expiresAt.toISOString()})`);
        io.to(`user_${uid}`).emit('subscription_updated', { active: true, planId, expiresAt: expiresAt.toISOString() });

        res.json({ ok: true, data: subData });
    } catch (err) {
        console.error('[Stripe] Verify session error:', err.message);
        res.status(500).json({ error: 'Error verificando sesión: ' + err.message });
    }
});

// ─── TEST: Manual subscription activation (REMOVE IN PRODUCTION) ─────
app.get('/api/test/activate-sub', authMiddleware, async (req, res) => {
    const planId = req.query.plan || 'monthly';
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Plan inválido' });

    const totalMonths = plan.duration + plan.bonus;
    const now = new Date();
    const existing = await loadUserConfig(req.uid);
    let startFrom = now;
    if (existing.subscription && existing.subscription.expiresAt) {
        const existingExpiry = new Date(existing.subscription.expiresAt);
        if (existingExpiry > now) startFrom = existingExpiry;
    }
    const expiresAt = new Date(startFrom);
    expiresAt.setMonth(expiresAt.getMonth() + totalMonths);

    await saveUserConfig(req.uid, {
        subscription: {
            active: true,
            planId: planId,
            planName: plan.name,
            paidAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            stripeSessionId: 'test_' + Date.now(),
            stripeCustomerId: null,
            totalMonths: totalMonths
        }
    });

    console.log(`[TEST] ✅ Subscription manually activated for ${req.email}: ${planId} (${totalMonths} months until ${expiresAt.toISOString()})`);
    io.to(`user_${req.uid}`).emit('subscription_updated', { active: true, planId, expiresAt: expiresAt.toISOString() });
    res.json({ ok: true, message: `Plan ${plan.name} activado por ${totalMonths} meses`, expiresAt: expiresAt.toISOString() });
});

// ══════════════════════════════════════════════════════════
//  ADMIN PANEL — Owner only
// ══════════════════════════════════════════════════════════
const ADMIN_EMAILS = ['yoelskygold@gmail.com'];

function adminMiddleware(req, res, next) {
    if (!ADMIN_EMAILS.includes(req.email)) {
        return res.status(403).json({ error: 'Acceso denegado. Solo administradores.' });
    }
    next();
}

// ─── Admin: KPI Metrics ──────────────────────────────────
app.get('/api/admin/metrics', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const usersSnap = await db.collection('users').get();
        const users = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

        const now = new Date();
        let totalUsers = users.length;
        let activeSubs = 0;
        let mrrCentavos = 0;
        let cancelledSubs = 0;
        let totalRevenue = 0;
        let newUsersThisMonth = 0;
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);

        for (const u of users) {
            const sub = u.subscription;
            if (sub && sub.expiresAt && new Date(sub.expiresAt) > now) {
                activeSubs++;
                // Estimate MRR from plan
                const plan = PLANS[sub.planId];
                if (plan) {
                    const monthlyEquiv = Math.round(plan.price / (plan.duration + plan.bonus));
                    mrrCentavos += monthlyEquiv;
                }
            } else if (sub && sub.expiresAt) {
                cancelledSubs++;
            }
            // Total revenue: count all paid sessions
            if (sub && sub.paidAt && sub.stripeSessionId && !sub.stripeSessionId.startsWith('free_pass')) {
                const plan = PLANS[sub.planId];
                if (plan) totalRevenue += plan.price;
            }
            // New users this month
            if (u.createdAt && new Date(u.createdAt) >= firstDay) {
                newUsersThisMonth++;
            }
        }

        // Active bots
        const activeBots = userBots.size;

        res.json({
            ok: true,
            data: {
                totalUsers,
                activeSubs,
                cancelledSubs,
                churnRate: totalUsers > 0 ? Math.round((cancelledSubs / totalUsers) * 100) : 0,
                mrrCentavos,
                totalRevenueCentavos: totalRevenue,
                newUsersThisMonth,
                activeBots
            }
        });
    } catch (err) {
        console.error('[Admin] Metrics error:', err.message);
        res.status(500).json({ error: 'Error obteniendo métricas.' });
    }
});

// ─── Admin: Users List ───────────────────────────────────
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        console.log('[Admin] Fetching users list…');
        const usersSnap = await db.collection('users').get();
        const now = new Date();
        const users = usersSnap.docs.map(d => {
            const data = d.data();
            const sub = data.subscription || {};
            let status = 'free';
            if (sub.expiresAt) {
                status = new Date(sub.expiresAt) > now ? 'active' : 'expired';
            }
            const plan = PLANS[sub.planId];
            const ltv = (sub.paidAt && plan && !sub.stripeSessionId?.startsWith('free_pass'))
                ? plan.price : 0;

            // Bot status
            const bot = userBots.get(d.id);
            const botStatus = bot ? bot.status : 'off';

            return {
                uid: d.id,
                name: data.name || '',
                email: data.email || '',
                businessName: data.businessName || '',
                createdAt: data.createdAt || null,
                planId: sub.planId || null,
                planName: sub.planName || 'Gratis',
                expiresAt: sub.expiresAt || null,
                paidAt: sub.paidAt || null,
                status,
                ltvCentavos: ltv,
                botStatus,
                stripeSessionId: sub.stripeSessionId || null,
                stripeCustomerId: sub.stripeCustomerId || null,
                totalMonths: sub.totalMonths || 0
            };
        });

        res.json({ ok: true, data: users });
        console.log('[Admin] Users list sent:', users.length, 'users');
    } catch (err) {
        console.error('[Admin] Users error:', err.message);
        res.status(500).json({ error: 'Error obteniendo usuarios.' });
    }
});

// ─── Admin: Activate/extend subscription manually ────────
app.post('/api/admin/users/:uid/activate', authMiddleware, adminMiddleware, async (req, res) => {
    const { uid } = req.params;
    const { planId } = req.body;
    const plan = PLANS[planId || 'monthly'];
    if (!plan) return res.status(400).json({ error: 'Plan inválido.' });

    const totalMonths = plan.duration + plan.bonus;
    const now = new Date();
    const existing = await loadUserConfig(uid);
    let startFrom = now;
    if (existing.subscription && existing.subscription.expiresAt) {
        const existingExpiry = new Date(existing.subscription.expiresAt);
        if (existingExpiry > now) startFrom = existingExpiry;
    }
    const expiresAt = new Date(startFrom);
    expiresAt.setMonth(expiresAt.getMonth() + totalMonths);

    await saveUserConfig(uid, {
        subscription: {
            active: true, planId: plan.id, planName: plan.name,
            paidAt: now.toISOString(), expiresAt: expiresAt.toISOString(),
            stripeSessionId: 'admin_' + Date.now(), stripeCustomerId: null,
            totalMonths
        }
    });

    console.log(`[Admin] ✅ Subscription activated for ${uid}: ${plan.id} (${totalMonths} months)`);
    io.to(`user_${uid}`).emit('subscription_updated', { active: true, planId: plan.id, expiresAt: expiresAt.toISOString() });
    res.json({ ok: true, message: `Plan ${plan.name} activado por ${totalMonths} meses.` });
});

// ─── Admin: Revoke subscription ──────────────────────────
app.post('/api/admin/users/:uid/revoke', authMiddleware, adminMiddleware, async (req, res) => {
    const { uid } = req.params;
    await saveUserConfig(uid, {
        subscription: {
            active: false, planId: null, planName: null,
            paidAt: null, expiresAt: null,
            stripeSessionId: null, stripeCustomerId: null,
            totalMonths: 0
        }
    });
    console.log(`[Admin] 🚫 Subscription revoked for ${uid}`);
    io.to(`user_${uid}`).emit('subscription_updated', { active: false });
    res.json({ ok: true, message: 'Suscripción revocada.' });
});

// ─── Admin: Kill bot for a user ──────────────────────────
app.post('/api/admin/users/:uid/kill-bot', authMiddleware, adminMiddleware, async (req, res) => {
    const { uid } = req.params;
    await stopBot(uid);
    res.json({ ok: true, message: 'Bot detenido.' });
});

// ─── SPA fallback ────────────────────────────────────────
// Landing page at root
app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'landing.html'));
});
app.get('/landing', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'landing.html'));
});
// Dashboard (protected by client-side auth)
app.get('/dashboard', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'index.html'));
});
app.get('/auth.html', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'auth.html'));
});
app.get('/admin', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
});
app.get('/admin.html', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'admin.html'));
});
app.get('/terms.html', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'terms.html'));
});
app.get('/privacy.html', (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'privacy.html'));
});
// SPA catch-all — unknown routes go to landing page
app.get(/^\/(?!api|socket\.io|admin|landing|terms|privacy).*/, (_req, res) => {
    res.sendFile(path.join(__dirname, 'src', 'public', 'landing.html'));
});

// ══════════════════════════════════════════════════════════
//  SOCKET.IO — Room per user (verified by Firebase token)
// ══════════════════════════════════════════════════════════

io.on('connection', async (socket) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
        socket.disconnect(true);
        return;
    }

    try {
        const decoded = await admin.auth().verifyIdToken(token);
        const uid = decoded.uid;
        const room = `user_${uid}`;
        socket.join(room);
        console.log(`[Socket] ${decoded.email} joined room ${room}`);

        // Send current state
        const bot = userBots.get(uid);
        if (bot?.status === 'qr' && bot.lastQR) {
            socket.emit('qr', bot.lastQR);   // Already a data URL from Baileys
        } else if (bot?.status === 'connected') {
            socket.emit('ready');
        }

        socket.on('disconnect', () => {
            console.log(`[Socket] ${decoded.email} left room ${room}`);
        });
    } catch {
        socket.disconnect(true);
    }
});

// ══════════════════════════════════════════════════════════
//  WHATSAPP CLIENT LIFECYCLE (per user) — Baileys
// ══════════════════════════════════════════════════════════

// Message deduplication (shared)
const processedMsgs = new Set();
function dedup(id) {
    if (processedMsgs.has(id)) return true;
    processedMsgs.add(id);
    setTimeout(() => processedMsgs.delete(id), 60_000);
    return false;
}

// Baileys logger (silent by default, set BAILEYS_DEBUG=true for verbose)
const baileysLogger = pino({ level: process.env.BAILEYS_DEBUG ? 'debug' : 'silent' });

async function startBot(uid, email) {
    const room = `user_${uid}`;
    console.log(`\n[Bot] Starting for ${email} (${uid})`);

    // If there's already a running bot, clean it up first
    const existing = userBots.get(uid);
    if (existing && existing.sock) {
        try {
            existing.sock.ev.removeAllListeners();
            existing.sock.end(undefined);
        } catch(e) { /* ignore */ }
    }

    const botState = {
        sock: null,
        status: 'starting',
        lastQR: null,
        stats: { messagesToday: 0, contactsCount: 0 },
        retryCount: 0
    };
    userBots.set(uid, botState);

    // Auth state stored per user in .baileys_auth/<uid>/
    const authDir = path.join(__dirname, '.baileys_auth', uid);
    if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    const { version } = await fetchLatestBaileysVersion();
    console.log(`[Bot] Using Baileys WA version ${version.join('.')}`);

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, baileysLogger)
        },
        logger: baileysLogger,
        printQRInTerminal: false,
        browser: ['Botly', 'Chrome', '120.0.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        qrTimeout: 40000,
        defaultQueryTimeoutMs: 0
    });

    botState.sock = sock;

    // Save credentials whenever they update
    sock.ev.on('creds.update', saveCreds);

    // ─── Connection updates (QR, connected, disconnected) ───
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // QR code received — convert to base64 dataURL and send to client
        if (qr) {
            try {
                const qrDataURL = await QRCode.toDataURL(qr, {
                    width: 400,
                    margin: 2,
                    color: { dark: '#000000', light: '#FFFFFF' },
                    errorCorrectionLevel: 'M'
                });
                botState.status = 'qr';
                botState.lastQR = qrDataURL;
                console.log(`[Bot] QR generated for ${email} (${qrDataURL.length} bytes)`);
                io.to(room).emit('qr', qrDataURL);
            } catch (err) {
                console.error(`[Bot] QR generation error:`, err.message);
            }
        }

        if (connection === 'open') {
            botState.status = 'connected';
            botState.lastQR = null;
            botState.retryCount = 0;
            const phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id || 'unknown';
            console.log(`[Bot] Connected for ${email} — ${phoneNumber}`);
            io.to(room).emit('ready');
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`[Bot] Connection closed for ${email}: code=${statusCode}, reconnect=${shouldReconnect}`);

            if (shouldReconnect && botState.retryCount < 5) {
                botState.retryCount++;
                console.log(`[Bot] Reconnecting for ${email} (attempt ${botState.retryCount})…`);
                setTimeout(() => startBot(uid, email), 3000);
            } else {
                // Logged out or too many retries — clean up
                botState.status = 'off';
                botState.lastQR = null;

                if (statusCode === DisconnectReason.loggedOut) {
                    // Clear auth so next start gets a fresh QR
                    try {
                        fs.rmSync(authDir, { recursive: true, force: true });
                        console.log(`[Bot] Auth cleared for ${email} (logged out)`);
                    } catch (e) { /* ignore */ }
                }

                console.log(`[Bot] Disconnected for ${email}: ${statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'max_retries'}`);
                io.to(room).emit('disconnected', statusCode === DisconnectReason.loggedOut ? 'logged_out' : 'connection_lost');
                userBots.delete(uid);
            }
        }
    });

    // ─── Incoming messages ──────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            try {
                // Skip if not a text message
                const text = msg.message?.conversation
                    || msg.message?.extendedTextMessage?.text
                    || null;
                if (!text) continue;

                // Skip own messages, group messages, status broadcasts
                if (msg.key.fromMe) continue;
                const jid = msg.key.remoteJid;
                if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;

                // Dedup
                const msgId = msg.key.id;
                if (dedup(msgId)) continue;

                // Skip URLs-only messages
                if (/^https?:\/\/\S+$/i.test(text.trim())) continue;

                // Check subscription is still active (skip for admin)
                const isAdmin = FREE_PASS_EMAILS.includes(email);
                if (!isAdmin) {
                    const userConf = await loadUserConfig(uid);
                    const sub = userConf.subscription;
                    if (!sub || !sub.expiresAt || new Date(sub.expiresAt) <= new Date()) {
                        console.log(`[Bot][${email}] ⛔ Subscription expired — ignoring message`);
                        io.to(room).emit('subscription_expired', {
                            reason: sub?.isTrial ? 'trial_expired' : 'expired'
                        });
                        return;
                    }
                }

                // Extract phone number and sender name
                const phone = jid.replace('@s.whatsapp.net', '');
                const senderName = msg.pushName || phone;
                console.log(`[Bot][${email}] 📩 ${senderName}: ${text.substring(0, 80)}`);

                botState.stats.messagesToday++;
                io.to(room).emit('stats', botState.stats);

                // Save incoming message
                const incomingMsg = {
                    id: msgId,
                    from: phone,
                    senderName: senderName,
                    body: text,
                    direction: 'incoming',
                    timestamp: new Date().toISOString()
                };
                await saveMessage(uid, incomingMsg);
                io.to(room).emit('new_message', incomingMsg);

                // Load this user's config
                const config = await loadUserConfig(uid);

                // Check if this chat is paused
                const pausedChats = config.pausedChats || [];
                if (pausedChats.includes(phone)) {
                    console.log(`[Bot][${email}] ⏸ Chat paused for ${phone} — skipping auto-reply`);
                    continue;
                }

                // Check response mode
                const responseMode = config.responseMode || 'auto';

                if (responseMode === 'semiauto') {
                    // Semi-auto: emit pending message alert, don't auto-reply
                    console.log(`[Bot][${email}] 🔔 Semi-auto: pending reply for ${phone}`);
                    io.to(room).emit('pending_message', {
                        phone: phone,
                        senderName: senderName,
                        body: text,
                        msgId: msgId,
                        timestamp: new Date().toISOString()
                    });
                    continue;
                }

                // Auto mode: get AI response and send
                const reply = await getAIResponse(uid, jid, text, senderName, config);

                // Send reply via Baileys
                await sock.sendMessage(jid, { text: reply });

                // Save bot reply
                const outgoingMsg = {
                    id: msgId + '_reply',
                    from: phone,
                    senderName: senderName,
                    body: reply,
                    direction: 'outgoing',
                    timestamp: new Date().toISOString()
                };
                await saveMessage(uid, outgoingMsg);
                io.to(room).emit('new_message', outgoingMsg);
            } catch (error) {
                console.error(`[Bot][${email}] Error:`, error.message);
            }
        }
    });
}

async function stopBot(uid) {
    const bot = userBots.get(uid);
    if (!bot) return;

    try {
        if (bot.sock) {
            bot.sock.ev.removeAllListeners();
            // Just close the socket — do NOT logout() so session stays valid
            bot.sock.end(undefined);
        }
    } catch (e) {
        console.error(`[Bot] Error stopping:`, e.message);
    }

    io.to(`user_${uid}`).emit('disconnected', 'manual_stop');
    userBots.delete(uid);
    console.log(`[Bot] Stopped for ${uid}`);
}

// ─── Start Server ────────────────────────────────────────
server.listen(PORT, () => {
    console.log('━'.repeat(50));
    console.log(`🚀 Botly: http://localhost:${PORT}`);
    console.log(`📋 Login:     http://localhost:${PORT}/auth.html`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/`);
    console.log('━'.repeat(50));
    console.log('Cada usuario obtiene su propio bot al registrarse\n');
});
