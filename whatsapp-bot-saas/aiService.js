/**
 * aiService.js — Google Gemini AI per-user service
 *
 * Each user gets:
 *  - Their own Gemini client (keyed by API key)
 *  - Per-chat conversation history (keyed by uid + chatId)
 *  - System prompt built from their dashboard config
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Global Gemini API Key (owner-provided, shared by all users) ──
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ─── Gemini client cache ──
const clientCache = new Map();

// ─── Conversation histories: Map<`${uid}::${chatId}`, Array<{role,parts}>> ──
const chatHistories = new Map();

const MAX_HISTORY = 30; // messages per conversation

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function getDayName() {
    const days = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return days[new Date().getDay()];
}

function formatTime(date) {
    return date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
}

/**
 * Check if the business is currently open based on schedule config.
 * Returns { isOpen: boolean, statusMsg: string }
 */
function checkSchedule(schedule) {
    if (!schedule) return { isOpen: true, statusMsg: 'Horario no configurado' };

    const dayMap = {
        'domingo': 'domingo', 'lunes': 'lunes', 'martes': 'martes',
        'miércoles': 'miercoles', 'jueves': 'jueves', 'viernes': 'viernes', 'sábado': 'sabado'
    };

    const today = getDayName();
    const key = dayMap[today] || today;
    const daySchedule = schedule[key];

    if (!daySchedule || !daySchedule.active) {
        return { isOpen: false, statusMsg: `Hoy ${today} no hay servicio.` };
    }

    const now = new Date();
    const [openH, openM] = (daySchedule.open || '00:00').split(':').map(Number);
    const [closeH, closeM] = (daySchedule.close || '00:00').split(':').map(Number);

    const openMin = openH * 60 + openM;
    const closeMin = closeH * 60 + closeM;
    const nowMin = now.getHours() * 60 + now.getMinutes();

    if (closeMin === 0 && openMin === 0) {
        return { isOpen: true, statusMsg: 'Abierto todo el día' };
    }

    if (nowMin >= openMin && nowMin <= closeMin) {
        return { isOpen: true, statusMsg: `Abierto hasta las ${daySchedule.close}` };
    }

    return {
        isOpen: false,
        statusMsg: `Hoy ${today} el horario es de ${daySchedule.open} a ${daySchedule.close}.`
    };
}

function buildScheduleText(schedule) {
    if (!schedule) return 'No configurado';
    const dayLabels = {
        lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles',
        jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo'
    };
    const lines = [];
    for (const [key, label] of Object.entries(dayLabels)) {
        const d = schedule[key];
        if (!d) { lines.push(`  - ${label}: Sin datos`); continue; }
        if (!d.active) { lines.push(`  - ${label}: Cerrado`); continue; }
        lines.push(`  - ${label}: ${d.open} — ${d.close}`);
    }
    return lines.join('\n');
}

// ─────────────────────────────────────────────────────────
//  Build system prompt from user config
// ─────────────────────────────────────────────────────────

function buildSystemPrompt(config) {
    const name = config.businessName || 'el negocio';
    const desc = config.businessDescription || '';
    const menu = config.menu || 'No hay menú configurado.';
    const customPrompt = config.botPrompt || '';
    const scheduleText = buildScheduleText(config.schedule);
    const { isOpen, statusMsg } = checkSchedule(config.schedule);
    const now = new Date();
    const dayName = getDayName();
    const timeStr = formatTime(now);

    return `${customPrompt}

═══════════════════════════════════
INFORMACIÓN DEL NEGOCIO:
• Nombre: ${name}
${desc ? `• Descripción: ${desc}` : ''}

⏰ HORARIOS:
${scheduleText}

🕐 Hora actual: ${timeStr} del ${dayName}
${isOpen
    ? `✅ ESTADO: ABIERTO — ${statusMsg}. Puedes atender pedidos normalmente.`
    : `🚫 ESTADO: CERRADO — ${statusMsg}. NO tomes pedidos. Informa amablemente el horario y que con gusto los atiendes cuando abran.`
}

═══════════════════════════════════
MENÚ / PRODUCTOS / SERVICIOS:
${menu}
═══════════════════════════════════

REGLAS IMPORTANTES:
- NUNCA inventes productos o precios que no estén en el menú.
- Si preguntan por algo que no existe, di que no lo manejas y ofrece alternativas del menú.
- Si el negocio está CERRADO, NO tomes pedidos. Disculpa e informa el horario.
- Usa *negritas* para nombres de productos y precios.
- Usa • para listas.
- Sé breve y natural, como si escribieras por WhatsApp.
- Responde siempre en el mismo idioma que el cliente.`;
}

// ─────────────────────────────────────────────────────────
//  Get or create a Gemini GenerativeModel
// ─────────────────────────────────────────────────────────

function getModel(apiKey, systemPrompt) {
    if (!apiKey) return null;

    let genAI = clientCache.get(apiKey);
    if (!genAI) {
        genAI = new GoogleGenerativeAI(apiKey);
        clientCache.set(apiKey, genAI);
    }

    return genAI.getGenerativeModel({
        model: 'gemini-2.0-flash',
        systemInstruction: systemPrompt,
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000,
        }
    });
}

// ─────────────────────────────────────────────────────────
//  Main: get AI response
// ─────────────────────────────────────────────────────────

/**
 * @param {string} uid       – Firebase user id
 * @param {string} chatId    – WhatsApp chat id (e.g. 521234567890@c.us)
 * @param {string} message   – User's incoming message text
 * @param {string} senderName – Contact name
 * @param {object} config    – User's saved config from data/{uid}.json
 * @returns {Promise<string>} – Reply text (or fallback)
 */
async function getAIResponse(uid, chatId, message, senderName, config) {
    if (!GEMINI_API_KEY) {
        return fallbackResponse(message, config);
    }

    // ── Build system prompt ──
    const systemPrompt = buildSystemPrompt(config);

    const model = getModel(GEMINI_API_KEY, systemPrompt);
    if (!model) {
        return fallbackResponse(message, config);
    }

    // ── History key ──
    const histKey = `${uid}::${chatId}`;
    let history = chatHistories.get(histKey) || [];

    // ── Start chat with history ──
    const chat = model.startChat({
        history: history,
    });

    try {
        const result = await chat.sendMessage(message);
        const response = result.response;
        const text = response.text().trim();

        // ── Update history ──
        history.push({ role: 'user', parts: [{ text: message }] });
        history.push({ role: 'model', parts: [{ text }] });

        // Trim history
        if (history.length > MAX_HISTORY * 2) {
            history = history.slice(-MAX_HISTORY * 2);
        }
        chatHistories.set(histKey, history);

        return text;
    } catch (err) {
        const errStr = err.message || String(err);
        console.error(`[AI][${uid}] Gemini error:`, errStr);

        // Rate limit → retry once after short wait
        if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
            try {
                await new Promise(r => setTimeout(r, 5000));
                const retry = await chat.sendMessage(message);
                const retryText = retry.response.text().trim();
                history.push({ role: 'user', parts: [{ text: message }] });
                history.push({ role: 'model', parts: [{ text: retryText }] });
                chatHistories.set(histKey, history);
                return retryText;
            } catch {
                /* fall through to fallback */
            }
        }

        // API key invalid
        if (errStr.includes('API_KEY_INVALID') || errStr.includes('403')) {
            return '⚠️ La API Key de Gemini configurada no es válida. Revisa tu configuración en el dashboard.';
        }

        return fallbackResponse(message, config);
    }
}

/**
 * Fallback sin IA — respuestas basadas en palabras clave.
 */
function fallbackResponse(message, config) {
    const msg = message.toLowerCase().trim();
    const name = config.businessName || 'nuestro negocio';

    const greetings = ['hola', 'buenas', 'buen día', 'buenas tardes', 'buenas noches', 'hey', 'hi', 'hello', 'qué onda'];
    if (greetings.some(g => msg.includes(g))) {
        const { statusMsg } = checkSchedule(config.schedule);
        return `¡Hola! 👋 Bienvenido a *${name}*.\n\n${statusMsg}\n\n¿En qué puedo ayudarte?\n• Escribe *menú* para ver nuestros productos\n• Escribe *horarios* para ver nuestros horarios\n• O dime directamente qué necesitas 😊`;
    }

    if (['menú', 'menu', 'carta', 'que tienen', 'qué tienen', 'platillos', 'productos'].some(w => msg.includes(w))) {
        return config.menu
            ? `📋 *Menú de ${name}:*\n\n${config.menu}`
            : `Aún no tenemos el menú cargado. Contacta al negocio directamente.`;
    }

    if (['horario', 'hora', 'abren', 'cierran', 'abierto', 'cerrado'].some(w => msg.includes(w))) {
        return `⏰ *Horarios de ${name}:*\n\n${buildScheduleText(config.schedule)}`;
    }

    return `¡Hola! Soy el asistente de *${name}*. Recibí tu mensaje y te responderé pronto. 😊`;
}

/**
 * Clear history for a specific chat.
 */
function clearChatHistory(uid, chatId) {
    chatHistories.delete(`${uid}::${chatId}`);
}

/**
 * Clear ALL histories for a user.
 */
function clearUserHistories(uid) {
    for (const key of chatHistories.keys()) {
        if (key.startsWith(`${uid}::`)) {
            chatHistories.delete(key);
        }
    }
}

module.exports = {
    getAIResponse,
    clearChatHistory,
    clearUserHistories,
    fallbackResponse
};
