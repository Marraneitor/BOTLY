/* ============================================================
   WhatsApp Bot SaaS — Dashboard Client
   Firebase Auth guard + per-user bot management
   ============================================================ */
(function () {
    'use strict';

    // --- Auth Guard ---
    var token = localStorage.getItem('botsaas_token');
    // Preview mode: only when opened as a static file (no protocol http/https)
    var isPreview = window.location.protocol === 'file:';

    if (!token && !isPreview) {
        window.location.href = '/auth.html';
        return;
    }

    // --- Constants ---
    var API = '/api';
    var TOAST_MS = 3500;

    // --- Helpers ---
    var $ = function(s) { return document.querySelector(s); };
    var $$ = function(s) { return document.querySelectorAll(s); };

    function debounce(fn, ms) {
        var t;
        return function() {
            var args = arguments;
            clearTimeout(t);
            t = setTimeout(function() { fn.apply(null, args); }, ms);
        };
    }

    // --- User info ---
    var user = JSON.parse(localStorage.getItem('botsaas_user') || '{}');

    // Inject user bar into sidebar
    function renderUserBar() {
        var brand = $('.sidebar__brand');
        if (!brand || !user.email) return;
        var initials = (user.name || user.email || '?')
            .split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
        var bar = document.createElement('div');
        bar.className = 'sidebar__user';
        bar.innerHTML =
            '<div class="sidebar__user-avatar">' +
                (user.photo
                    ? '<img src="' + user.photo + '" alt="" referrerpolicy="no-referrer">'
                    : initials) +
            '</div>' +
            '<div class="sidebar__user-info">' +
                '<span class="sidebar__user-name">' + (user.name || user.email) + '</span>' +
                '<span class="sidebar__user-email">' + user.email + '</span>' +
            '</div>';
        brand.after(bar);
    }
    renderUserBar();

    // --- Show admin link for admin emails ---
    (function () {
        var ADMIN_EMAILS = ['yoelskygold@gmail.com'];
        var adminLink = document.getElementById('admin-link');
        if (adminLink && user.email && ADMIN_EMAILS.indexOf(user.email) !== -1) {
            adminLink.style.display = '';
        }
    })();

    // --- Password toggle for API key field ---
    $$('[data-toggle-password]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var input = $('#' + btn.dataset.togglePassword);
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    var brandSpan = $('.sidebar__brand span');
    if (user.businessName && brandSpan) {
        brandSpan.textContent = user.businessName;
    }

    // --- DOM refs ---
    var sidebar      = $('#sidebar');
    var hamburger    = $('#hamburger');
    var sidebarLinks = $$('.sidebar__link');
    var sections     = $$('.section');
    var configForm   = $('#config-form');
    var toastEl      = $('#toast');
    var qrPlaceholder = $('#qr-placeholder');
    var qrCanvas     = $('#qr-canvas');
    var connDot      = $('#conn-dot');
    var connLabel    = $('#conn-label');
    var statusIcon   = $('#status-icon');
    var statusText   = $('#status-text');
    var btnStartBot  = $('#btn-start-bot');
    var btnStopBot   = $('#btn-stop-bot');
    var btnResetDraft = $('#btn-reset-draft');

    // --- State ---
    var socket = null;
    var botConnected = false;

    // --- Navigation ---
    function navigateTo(name) {
        sections.forEach(function(s) { s.classList.add('section--hidden'); });
        var target = $('#section-' + name);
        if (target) target.classList.remove('section--hidden');
        sidebarLinks.forEach(function(l) { l.classList.remove('sidebar__link--active'); });
        var link = $('[data-section="' + name + '"]');
        if (link) link.classList.add('sidebar__link--active');
        sidebar.classList.remove('sidebar--open');
    }

    sidebarLinks.forEach(function(l) {
        l.addEventListener('click', function(e) {
            if (!l.dataset.section) return;   // let normal <a> navigation happen (e.g. /admin)
            e.preventDefault();
            navigateTo(l.dataset.section);
        });
    });
    $$('[data-goto]').forEach(function(b) {
        b.addEventListener('click', function() { navigateTo(b.dataset.goto); });
    });
    if (hamburger) {
        hamburger.addEventListener('click', function() { sidebar.classList.toggle('sidebar--open'); });
    }

    // --- Toast ---
    function showToast(msg, type) {
        type = type || 'success';
        toastEl.textContent = msg;
        toastEl.className = 'toast toast--' + type + ' toast--visible';
        setTimeout(function() { toastEl.classList.remove('toast--visible'); }, TOAST_MS);
    }

    // --- Auth headers ---
    function authHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (localStorage.getItem('botsaas_token') || '')
        };
    }

    // --- API helper ---
    function apiCall(path, options) {
        options = options || {};
        if (isPreview) return Promise.reject(new Error('PREVIEW'));

        return fetch(API + path, Object.assign({ headers: authHeaders() }, options))
            .then(function(res) {
                if (res.status === 401) {
                    localStorage.removeItem('botsaas_token');
                    localStorage.removeItem('botsaas_user');
                    window.location.href = '/auth.html';
                    return Promise.reject(new Error('AUTH_EXPIRED'));
                }
                var ct = res.headers.get('content-type') || '';
                if (ct.indexOf('application/json') === -1) return Promise.reject(new Error('NOT_JSON'));
                return res.json().then(function(json) {
                    if (!res.ok) return Promise.reject(new Error(json.error || 'Error ' + res.status));
                    return json;
                });
            });
    }

    // --- LocalStorage Draft ---
    var DRAFT_KEY = 'botsaas_draft_' + (user.uid || 'default');

    function saveDraft() {
        var data = serializeForm();
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    }

    function loadDraft() {
        try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch(e) { return null; }
    }

    function clearDraft() { localStorage.removeItem(DRAFT_KEY); }

    if (configForm) {
        configForm.addEventListener('input', debounce(saveDraft, 400));
    }

    if (btnResetDraft) {
        btnResetDraft.addEventListener('click', function() {
            clearDraft();
            configForm.reset();
            showToast('Borrador descartado', 'success');
        });
    }

    // --- Form Serialization / Hydration ---
    function serializeForm() {
        if (!configForm) return {};
        var fd = new FormData(configForm);
        var data = {};

        ['businessName', 'businessDescription', 'menu', 'botPrompt'].forEach(function(k) {
            data[k] = fd.get(k) || '';
        });

        var days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'];
        data.schedule = {};
        days.forEach(function(d) {
            var cb = configForm.querySelector('[name="schedule_' + d + '_active"]');
            data.schedule[d] = {
                open:   fd.get('schedule_' + d + '_open') || '00:00',
                close:  fd.get('schedule_' + d + '_close') || '00:00',
                active: cb ? cb.checked : false
            };
        });

        return data;
    }

    function hydrateForm(data) {
        if (!data || !configForm) return;

        ['businessName', 'businessDescription', 'menu', 'botPrompt'].forEach(function(k) {
            var el = configForm.querySelector('[name="' + k + '"]');
            if (el && data[k] !== undefined) el.value = data[k];
        });

        if (data.schedule) {
            Object.keys(data.schedule).forEach(function(day) {
                var val = data.schedule[day];
                var o = configForm.querySelector('[name="schedule_' + day + '_open"]');
                var c = configForm.querySelector('[name="schedule_' + day + '_close"]');
                var a = configForm.querySelector('[name="schedule_' + day + '_active"]');
                if (o) o.value = val.open;
                if (c) c.value = val.close;
                if (a) a.checked = val.active;
            });
        }
    }

    // --- Form Submit ---
    if (configForm) {
        configForm.addEventListener('submit', function(e) {
            e.preventDefault();
            var btn = $('#btn-save');
            var data = serializeForm();

            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Guardando...';

            apiCall('/config', {
                method: 'POST',
                body: JSON.stringify(data)
            }).then(function() {
                clearDraft();
                showToast('Configuracion guardada correctamente');
            }).catch(function(err) {
                saveDraft();
                if (err.message === 'PREVIEW') {
                    showToast('Guardado localmente', 'success');
                } else {
                    showToast(err.message || 'Error al guardar', 'error');
                }
            }).finally(function() {
                btn.disabled = false;
                btn.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>' +
                    '<polyline points="17 21 17 13 7 13 7 21"/>' +
                    '<polyline points="7 3 7 8 15 8"/>' +
                    '</svg> Guardar configuracion';
            });
        });
    }

    // --- Socket.io ---
    function initSocket() {
        if (socket || isPreview) return;
        if (typeof io === 'undefined') return;

        socket = io({
            auth: { token: localStorage.getItem('botsaas_token') },
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            timeout: 8000
        });

        socket.on('connect', function() { console.log('[Socket] Conectado'); });

        socket.on('qr', function(qrString) {
            console.log('[Socket] QR recibido');
            renderQR(qrString);
        });

        socket.on('ready', function() {
            setConnectionStatus(true);
            showToast('Bot conectado exitosamente!');
        });

        socket.on('disconnected', function(reason) {
            setConnectionStatus(false);
            showToast('Bot desconectado: ' + (reason || 'desconocido'), 'error');
        });

        socket.on('stats', function(data) {
            if (data.messagesToday != null) {
                var el = $('#messages-today');
                if (el) el.textContent = data.messagesToday;
            }
            if (data.contactsCount != null) {
                var el2 = $('#contacts-count');
                if (el2) el2.textContent = data.contactsCount;
            }
        });

        // Real-time messages
        socket.on('new_message', function(msg) {
            allMessages.push(msg);
            // Update conversations list
            updateConversationInList(msg);
            // If chat view is open for this contact, append the message
            if (currentChatPhone && msg.from === currentChatPhone) {
                appendChatBubble(msg);
                scrollChatToBottom();
            }
            // Update counter
            var counterEl = $('#messages-today');
            if (counterEl && msg.direction === 'incoming') {
                counterEl.textContent = parseInt(counterEl.textContent || '0') + 1;
            }
        });

        // Semi-auto: pending message alert
        socket.on('pending_message', function(msg) {
            pendingMessages.push(msg);
            showPendingAlert(msg);
        });

        socket.on('auth_error', function(msg) { showToast(msg || 'Error de autenticacion', 'error'); });
        socket.on('connect_error', function() { console.warn('[Socket] Error de conexion'); });

        // Subscription updated via webhook
        socket.on('subscription_updated', function(data) {
            invalidateSubCache();
            loadSubscription(true);
            if (data.active) {
                showToast('¡Suscripción activada! Plan activo hasta ' + new Date(data.expiresAt).toLocaleDateString('es'), 'success');
            }
        });

        // Subscription expired while bot is running
        socket.on('subscription_expired', function(data) {
            invalidateSubCache();
            loadSubscription(true);
            var msg = data.reason === 'trial_expired'
                ? 'Tu prueba gratuita ha expirado. El bot dejará de responder.'
                : 'Tu suscripción ha expirado. El bot dejará de responder.';
            showToast(msg, 'error');
        });
    }

    // --- QR Rendering ---
    function renderQR(qrString) {
        if (!qrCanvas) return;
        qrPlaceholder.style.display = 'none';
        qrCanvas.classList.remove('qr-canvas--hidden');
        qrCanvas.innerHTML = '';

        // Baileys sends a base64 data URL (image), display directly as <img>
        if (qrString && qrString.indexOf('data:image') === 0) {
            var img = document.createElement('img');
            img.src = qrString;
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'contain';
            img.style.borderRadius = '8px';
            img.style.background = '#ffffff';
            qrCanvas.appendChild(img);
        } else if (qrString && window.QRCode) {
            // Fallback for raw QR text strings (legacy)
            new QRCode(qrCanvas, {
                text: qrString,
                width: 300,
                height: 300,
                colorDark: '#000000',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M
            });
        }
    }

    function setConnectionStatus(connected) {
        botConnected = connected;
        if (connDot) connDot.className = connected ? 'status-dot status-dot--on' : 'status-dot status-dot--off';
        if (connLabel) connLabel.textContent = connected ? 'Conectado' : 'Desconectado';
        if (statusIcon) statusIcon.className = connected ? 'card__icon card__icon--connected' : 'card__icon card__icon--disconnected';
        if (statusText) statusText.textContent = connected ? 'Conectado' : 'Desconectado';
        if (btnStartBot) btnStartBot.disabled = connected;
        if (btnStopBot) btnStopBot.disabled = !connected;
        if (connected && qrCanvas) {
            qrCanvas.classList.add('qr-canvas--hidden');
            qrPlaceholder.style.display = 'flex';
            qrPlaceholder.querySelector('p').textContent = 'Bot vinculado correctamente!';
        }
    }

    // --- Start / Stop Bot ---
    if (btnStartBot) {
        btnStartBot.addEventListener('click', function() {
            if (isPreview) {
                showToast('Inicia el servidor con: npm run dev', 'error');
                return;
            }
            btnStartBot.disabled = true;
            btnStartBot.textContent = 'Iniciando...';
            initSocket();
            apiCall('/bot/start', { method: 'POST' }).then(function() {
                showToast('Bot iniciado - esperando QR...');
            }).catch(function(err) {
                showToast(err.message || 'Error al iniciar', 'error');
                btnStartBot.disabled = false;
            }).finally(function() {
                btnStartBot.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<polygon points="5 3 19 12 5 21 5 3"/>' +
                    '</svg> Iniciar Bot';
            });
        });
    }

    if (btnStopBot) {
        btnStopBot.addEventListener('click', function() {
            btnStopBot.disabled = true;
            apiCall('/bot/stop', { method: 'POST' }).then(function() {
                setConnectionStatus(false);
                showToast('Bot detenido');
            }).catch(function(err) {
                showToast(err.message || 'Error al detener', 'error');
            }).finally(function() {
                btnStopBot.disabled = !botConnected;
            });
        });
    }

    // --- Reset Bot (format devices, new QR) ---
    var btnResetBot = $('#btn-reset-bot');
    if (btnResetBot) {
        btnResetBot.addEventListener('click', function() {
            if (!confirm('¿Estás seguro?\nEsto desvinculará todos los dispositivos de esta sesión y generará un nuevo código QR.')) return;
            if (isPreview) {
                showToast('Inicia el servidor para formatear dispositivos', 'error');
                return;
            }
            btnResetBot.disabled = true;
            btnResetBot.innerHTML = '<span class="spinner"></span> Formateando...';
            initSocket();
            apiCall('/bot/reset', { method: 'POST' }).then(function() {
                setConnectionStatus(false);
                // Reset QR area to "waiting" state
                if (qrPlaceholder) {
                    qrPlaceholder.style.display = 'flex';
                    qrPlaceholder.querySelector('p').textContent = 'Generando nuevo código QR…';
                }
                if (qrCanvas) qrCanvas.classList.add('qr-canvas--hidden');
                showToast('Sesión reseteada. Esperando nuevo QR…');
            }).catch(function(err) {
                showToast(err.message || 'Error al formatear', 'error');
            }).finally(function() {
                btnResetBot.disabled = false;
                btnResetBot.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>' +
                    '<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>' +
                    '</svg> Formatear dispositivos (nuevo QR)';
            });
        });
    }

    // --- Messages / Inbox Section ---
    var inboxView      = $('#inbox-view');
    var chatView       = $('#chat-view');
    var inboxEmpty     = $('#inbox-empty');
    var inboxList      = $('#inbox-list');
    var inboxSearch    = $('#inbox-search');
    var btnClearMsgs   = $('#btn-clear-messages');
    var btnBackInbox   = $('#btn-back-inbox');
    var chatMessages   = $('#chat-messages');
    var chatInput      = $('#chat-input');
    var btnSendMessage = $('#btn-send-message');
    var chatContactName  = $('#chat-contact-name');
    var chatContactPhone = $('#chat-contact-phone');
    var allMessages = [];
    var conversations = {}; // phone -> { phone, senderName, messages[], lastMessage, lastTimestamp }
    var currentChatPhone = null;

    // --- Response Mode & Pause ---
    var responseModeSwitch = $('#response-mode-switch');
    var responseModeLabel  = $('#response-mode-label');
    var responseModeLabelAlt = $('#response-mode-label-alt');
    var pendingAlert       = $('#pending-alert');
    var pendingAlertName   = $('#pending-alert-name');
    var pendingAlertText   = $('#pending-alert-text');
    var btnApproveReply    = $('#btn-approve-reply');
    var btnManualReply     = $('#btn-manual-reply');
    var btnDismissAlert    = $('#btn-dismiss-alert');
    var btnPauseChat       = $('#btn-pause-chat');
    var pauseBtnLabel      = $('#pause-btn-label');
    var chatBotDot         = $('#chat-bot-dot');
    var chatBotLabel       = $('#chat-bot-label');
    var currentResponseMode = 'auto';
    var pausedChats = [];
    var pendingMessages = []; // queue of pending messages in semi-auto

    function formatTime(iso) {
        var d = new Date(iso);
        var now = new Date();
        var isToday = d.toDateString() === now.toDateString();
        var time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
        if (isToday) return time;
        var yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Ayer ' + time;
        return d.toLocaleDateString('es', { day: '2-digit', month: 'short' }) + ' ' + time;
    }

    function escapeHtml(str) {
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getInitials(name) {
        return (name || '?').split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
    }

    // --- Build conversations from flat message array ---
    function buildConversations(msgs) {
        conversations = {};
        msgs.forEach(function(m) {
            var key = m.from;
            if (!conversations[key]) {
                conversations[key] = { phone: key, senderName: m.senderName || key, messages: [], lastMessage: null, lastTimestamp: null };
            }
            conversations[key].messages.push(m);
            conversations[key].lastMessage = m.body;
            conversations[key].lastTimestamp = m.timestamp;
            if (m.senderName && m.senderName !== 'Tú (manual)' && m.senderName !== 'Bot') {
                conversations[key].senderName = m.senderName;
            }
        });
    }

    function getSortedConversations() {
        return Object.values(conversations).sort(function(a, b) {
            return new Date(b.lastTimestamp) - new Date(a.lastTimestamp);
        });
    }

    // --- Render conversations list (inbox) ---
    function renderInbox(filter) {
        if (!inboxList) return;
        inboxList.innerHTML = '';
        var convos = getSortedConversations();
        if (filter) {
            var q = filter.toLowerCase();
            convos = convos.filter(function(c) {
                return c.senderName.toLowerCase().indexOf(q) !== -1 || c.phone.indexOf(q) !== -1;
            });
        }
        if (convos.length === 0) {
            if (inboxEmpty) inboxEmpty.style.display = 'flex';
            inboxList.style.display = 'none';
            return;
        }
        if (inboxEmpty) inboxEmpty.style.display = 'none';
        inboxList.style.display = 'flex';

        convos.forEach(function(c) {
            var lastDir = c.messages.length > 0 ? c.messages[c.messages.length - 1].direction : '';
            var preview = (lastDir === 'outgoing' ? 'Bot: ' : '') + (c.lastMessage || '').substring(0, 60);
            var incoming = c.messages.filter(function(m) { return m.direction === 'incoming'; }).length;
            var paused = isChatPaused(c.phone);

            var div = document.createElement('div');
            div.className = 'inbox-item' + (paused ? ' inbox-item--paused' : '');
            div.dataset.phone = c.phone;
            div.innerHTML =
                '<div class="inbox-item__avatar">' + getInitials(c.senderName) + '</div>' +
                '<div class="inbox-item__body">' +
                    '<div class="inbox-item__top">' +
                        '<span class="inbox-item__name">' + escapeHtml(c.senderName) +
                            (paused ? ' <span class="inbox-item__paused-badge">⏸</span>' : '') +
                        '</span>' +
                        '<span class="inbox-item__time">' + formatTime(c.lastTimestamp) + '</span>' +
                    '</div>' +
                    '<div class="inbox-item__bottom">' +
                        '<span class="inbox-item__preview">' + escapeHtml(preview) + '</span>' +
                        '<span class="inbox-item__count">' + c.messages.length + ' msgs</span>' +
                    '</div>' +
                '</div>';
            div.addEventListener('click', function() { openChat(c.phone); });
            inboxList.appendChild(div);
        });
    }

    // --- Update a single conversation in the list when a new message arrives ---
    function updateConversationInList(msg) {
        var key = msg.from;
        if (!conversations[key]) {
            conversations[key] = { phone: key, senderName: msg.senderName || key, messages: [], lastMessage: null, lastTimestamp: null };
        }
        conversations[key].messages.push(msg);
        conversations[key].lastMessage = msg.body;
        conversations[key].lastTimestamp = msg.timestamp;
        if (msg.senderName && msg.senderName !== 'Tú (manual)' && msg.senderName !== 'Bot') {
            conversations[key].senderName = msg.senderName;
        }
        // Re-render inbox if visible
        if (inboxView && !inboxView.classList.contains('chat-view--hidden')) {
            renderInbox(inboxSearch ? inboxSearch.value.trim() : '');
        }
    }

    // --- Open a chat ---
    function openChat(phone) {
        currentChatPhone = phone;
        var convo = conversations[phone];
        if (!convo) return;

        // Fill header
        if (chatContactName) chatContactName.textContent = convo.senderName;
        if (chatContactPhone) chatContactPhone.textContent = '+' + phone;

        // Update pause button state
        updatePauseUI(phone);

        // Switch views
        if (inboxView) inboxView.style.display = 'none';
        if (chatView) chatView.classList.remove('chat-view--hidden');

        // Render messages
        renderChatMessages(convo.messages);
        scrollChatToBottom();

        // Focus input
        if (chatInput) chatInput.focus();
    }

    function closeChat() {
        currentChatPhone = null;
        if (chatView) chatView.classList.add('chat-view--hidden');
        if (inboxView) inboxView.style.display = '';
        renderInbox(inboxSearch ? inboxSearch.value.trim() : '');
    }

    // --- Render chat bubbles ---
    function renderChatMessages(msgs) {
        if (!chatMessages) return;
        chatMessages.innerHTML = '';
        msgs.forEach(function(m) {
            appendChatBubble(m);
        });
    }

    function appendChatBubble(msg) {
        if (!chatMessages) return;
        var div = document.createElement('div');
        div.className = 'chat-bubble chat-bubble--' + msg.direction;
        div.innerHTML =
            '<p class="chat-bubble__text">' + escapeHtml(msg.body) + '</p>' +
            '<span class="chat-bubble__time">' + formatTime(msg.timestamp) +
                (msg.direction === 'outgoing' ? ' • Bot' : '') +
            '</span>';
        chatMessages.appendChild(div);
    }

    function scrollChatToBottom() {
        if (chatMessages) {
            setTimeout(function() { chatMessages.scrollTop = chatMessages.scrollHeight; }, 50);
        }
    }

    // --- Send manual message ---
    function sendManualMessage() {
        if (!currentChatPhone || !chatInput) return;
        var text = chatInput.value.trim();
        if (!text) return;
        chatInput.value = '';
        chatInput.style.height = 'auto';

        apiCall('/messages/send', {
            method: 'POST',
            body: JSON.stringify({ phone: currentChatPhone, message: text })
        }).then(function() {
            // Message will arrive via socket 'new_message'
        }).catch(function(err) {
            showToast(err.message || 'Error al enviar', 'error');
        });
    }

    if (btnSendMessage) {
        btnSendMessage.addEventListener('click', sendManualMessage);
    }
    if (chatInput) {
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendManualMessage();
            }
        });
        // Auto-resize textarea
        chatInput.addEventListener('input', function() {
            chatInput.style.height = 'auto';
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
        });
    }
    if (btnBackInbox) {
        btnBackInbox.addEventListener('click', closeChat);
    }

    // --- Load messages and build conversations ---
    function loadMessagesFromAPI() {
        apiCall('/messages').then(function(res) {
            if (res.data) {
                allMessages = res.data;
                buildConversations(allMessages);
                renderInbox();
            }
        }).catch(function() { /* ignore */ });
    }

    if (inboxSearch) {
        inboxSearch.addEventListener('input', debounce(function() {
            renderInbox(inboxSearch.value.trim());
        }, 250));
    }

    if (btnClearMsgs) {
        btnClearMsgs.addEventListener('click', function() {
            if (!confirm('¿Borrar todo el historial de mensajes?')) return;
            apiCall('/messages', { method: 'DELETE' }).then(function() {
                allMessages = [];
                conversations = {};
                renderInbox();
                closeChat();
                showToast('Historial borrado');
            }).catch(function(err) {
                showToast(err.message || 'Error al borrar', 'error');
            });
        });
    }

    // ═══════════════════════════════════════════════════
    //  RESPONSE MODE (auto / semiauto)
    // ═══════════════════════════════════════════════════

    function loadResponseMode() {
        apiCall('/config/response-mode').then(function(res) {
            currentResponseMode = res.mode || 'auto';
            updateModeUI();
        }).catch(function() {});
    }

    function updateModeUI() {
        if (!responseModeSwitch) return;
        responseModeSwitch.checked = (currentResponseMode === 'semiauto');
        if (responseModeLabel) {
            responseModeLabel.style.opacity = currentResponseMode === 'auto' ? '1' : '.45';
            responseModeLabel.style.fontWeight = currentResponseMode === 'auto' ? '600' : '400';
        }
        if (responseModeLabelAlt) {
            responseModeLabelAlt.style.opacity = currentResponseMode === 'semiauto' ? '1' : '.45';
            responseModeLabelAlt.style.fontWeight = currentResponseMode === 'semiauto' ? '600' : '400';
        }
    }

    if (responseModeSwitch) {
        responseModeSwitch.addEventListener('change', function() {
            var newMode = responseModeSwitch.checked ? 'semiauto' : 'auto';
            apiCall('/config/response-mode', {
                method: 'POST',
                body: JSON.stringify({ mode: newMode })
            }).then(function(res) {
                currentResponseMode = res.mode || newMode;
                updateModeUI();
                showToast(currentResponseMode === 'auto' ? 'Modo automático activado' : 'Modo semi-automático activado');
            }).catch(function(err) {
                // Revert
                responseModeSwitch.checked = !responseModeSwitch.checked;
                showToast(err.message || 'Error al cambiar modo', 'error');
            });
        });
    }

    // ═══════════════════════════════════════════════════
    //  PENDING MESSAGE ALERT (semi-auto)
    // ═══════════════════════════════════════════════════

    function showPendingAlert(msg) {
        if (!pendingAlert) return;
        pendingAlert.classList.remove('pending-alert--hidden');
        if (pendingAlertName) pendingAlertName.textContent = msg.senderName || msg.phone;
        if (pendingAlertText) pendingAlertText.textContent = (msg.body || '').substring(0, 100);
        pendingAlert.dataset.phone = msg.phone;
        pendingAlert.dataset.msgId = msg.msgId || '';
        // Play notification sound (subtle beep)
        try { new Audio('data:audio/wav;base64,UklGRl9vT19teleXhWYXYFBIEAABAAEARKwAAIhYA' +
            'QACABAAZGFAwAAAA==').play().catch(function(){}); } catch(e) {}
    }

    function hidePendingAlert() {
        if (!pendingAlert) return;
        pendingAlert.classList.add('pending-alert--hidden');
        // Show next pending if any
        pendingMessages.shift();
        if (pendingMessages.length > 0) {
            setTimeout(function() { showPendingAlert(pendingMessages[0]); }, 300);
        }
    }

    if (btnApproveReply) {
        btnApproveReply.addEventListener('click', function() {
            var phone = pendingAlert.dataset.phone;
            var msgId = pendingAlert.dataset.msgId;
            if (!phone) return;
            btnApproveReply.disabled = true;
            btnApproveReply.textContent = 'Enviando...';
            apiCall('/bot/approve-reply', {
                method: 'POST',
                body: JSON.stringify({ phone: phone, msgId: msgId })
            }).then(function() {
                showToast('Respuesta enviada con bot');
                hidePendingAlert();
            }).catch(function(err) {
                showToast(err.message || 'Error al responder', 'error');
            }).finally(function() {
                btnApproveReply.disabled = false;
                btnApproveReply.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">' +
                    '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z"/><path d="M12 8v4l3 3"/></svg> Responder con Bot';
            });
        });
    }

    if (btnManualReply) {
        btnManualReply.addEventListener('click', function() {
            var phone = pendingAlert.dataset.phone;
            if (!phone) return;
            hidePendingAlert();
            openChat(phone);
            if (chatInput) chatInput.focus();
        });
    }

    if (btnDismissAlert) {
        btnDismissAlert.addEventListener('click', function() {
            hidePendingAlert();
        });
    }

    // ═══════════════════════════════════════════════════
    //  PER-CHAT PAUSE / RESUME
    // ═══════════════════════════════════════════════════

    function loadPausedChats() {
        apiCall('/bot/paused-chats').then(function(res) {
            pausedChats = res.pausedChats || [];
        }).catch(function() {});
    }

    function isChatPaused(phone) {
        return pausedChats.indexOf(phone) !== -1;
    }

    function updatePauseUI(phone) {
        var paused = isChatPaused(phone);
        if (chatBotDot) chatBotDot.className = paused ? 'status-dot status-dot--off' : 'status-dot status-dot--on';
        if (chatBotLabel) chatBotLabel.textContent = paused ? 'Bot pausado' : 'Bot activo';
        if (btnPauseChat) {
            btnPauseChat.className = paused
                ? 'btn btn--primary btn--sm chat-pause-btn chat-pause-btn--paused'
                : 'btn btn--ghost btn--sm chat-pause-btn';
            btnPauseChat.title = paused ? 'Reanudar bot en este chat' : 'Pausar bot en este chat';
        }
        if (pauseBtnLabel) pauseBtnLabel.textContent = paused ? 'Reanudar' : 'Pausar';
        // Update pause icon
        if (btnPauseChat) {
            var svg = btnPauseChat.querySelector('svg');
            if (svg) {
                svg.innerHTML = paused
                    ? '<polygon points="5 3 19 12 5 21 5 3"/>'
                    : '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>';
            }
        }
    }

    if (btnPauseChat) {
        btnPauseChat.addEventListener('click', function() {
            if (!currentChatPhone) return;
            var paused = isChatPaused(currentChatPhone);
            var endpoint = paused ? '/bot/resume-chat' : '/bot/pause-chat';
            apiCall(endpoint, {
                method: 'POST',
                body: JSON.stringify({ phone: currentChatPhone })
            }).then(function(res) {
                pausedChats = res.pausedChats || [];
                updatePauseUI(currentChatPhone);
                showToast(isChatPaused(currentChatPhone) ? 'Bot pausado en este chat' : 'Bot reanudado en este chat');
            }).catch(function(err) {
                showToast(err.message || 'Error', 'error');
            });
        });
    }

    // --- Subscription / Plans ---
    var subStatus      = $('#sub-status');
    var subStatusPlan  = $('#sub-status-plan');
    var subStatusExpires = $('#sub-status-expires');
    var subStatusBadge = $('#sub-status-badge');

    // ── Deduplication + in-memory cache ──
    var _subInflight = null;   // pending promise (dedup)
    var _subCache    = null;   // last result
    var _subCacheTs  = 0;      // timestamp of cache
    var SUB_CACHE_TTL = 15000; // 15 s

    function loadSubscription(forceRefresh) {
        var now = Date.now();

        // 1) Return cached data if still fresh
        if (!forceRefresh && _subCache && (now - _subCacheTs < SUB_CACHE_TTL)) {
            if (_subCache.data) updateSubUI(_subCache.data);
            return Promise.resolve(_subCache);
        }

        // 2) If a request is already in-flight, piggyback on it
        if (_subInflight) return _subInflight;

        // 3) Fire ONE real request
        _subInflight = apiCall('/subscription').then(function(res) {
            _subCache   = res;
            _subCacheTs = Date.now();
            _subInflight = null;
            if (res.data) updateSubUI(res.data);
            return res;
        }).catch(function(err) {
            _subInflight = null;
            throw err;
        });
        return _subInflight;
    }

    function invalidateSubCache() { _subCache = null; _subCacheTs = 0; }

    function updateSubUI(sub) {
        if (!subStatus) return;

        // ── Trial banner ──
        var banner = document.getElementById('trial-banner');
        var hoursEl = document.getElementById('trial-hours-left');
        if (banner) {
            if (sub && sub.isTrial && sub.active && sub.trialHoursLeft != null) {
                banner.style.display = 'flex';
                if (hoursEl) hoursEl.textContent = sub.trialHoursLeft < 1
                    ? 'menos de 1'
                    : Math.ceil(sub.trialHoursLeft);
            } else {
                banner.style.display = 'none';
            }
        }

        // ── Blocking modal for expired trial / no subscription ──
        var modal = document.getElementById('trial-modal');
        var modalTitle = document.getElementById('trial-modal-title');
        var modalText  = document.getElementById('trial-modal-text');
        if (modal && sub) {
            if (sub.isAdmin) {
                modal.style.display = 'none';
            } else if (!sub.active && sub.reason === 'trial_expired') {
                modal.style.display = 'flex';
                if (modalTitle) modalTitle.textContent = 'Tu prueba gratuita ha expirado';
                if (modalText)  modalText.textContent  = 'Suscr\u00edbete a un plan para seguir usando Botly y mantener tu bot activo.';
            } else if (!sub.active && (sub.reason === 'expired' || sub.reason === 'no_subscription')) {
                modal.style.display = 'flex';
                if (modalTitle) modalTitle.textContent = 'Suscripci\u00f3n requerida';
                if (modalText)  modalText.textContent  = 'Tu suscripci\u00f3n ha expirado. Renueva tu plan para seguir usando Botly.';
            } else {
                modal.style.display = 'none';
            }
        }

        if (sub && sub.active) {
            subStatus.style.display = 'flex';
            subStatus.className = 'sub-status sub-status--active';
            if (sub.isAdmin) {
                if (subStatusPlan) subStatusPlan.textContent = 'Plan Administrador';
                if (subStatusExpires) subStatusExpires.textContent = 'Acceso permanente';
                if (subStatusBadge) {
                    subStatusBadge.textContent = 'Admin';
                    subStatusBadge.className = 'sub-status__badge sub-status__badge--active';
                }
            } else if (sub.isTrial) {
                if (subStatusPlan) subStatusPlan.textContent = 'Prueba gratuita';
                if (subStatusExpires) {
                    var h = sub.trialHoursLeft != null ? Math.ceil(sub.trialHoursLeft) : '?';
                    subStatusExpires.textContent = 'Expira en ' + h + ' hora' + (h !== 1 ? 's' : '');
                }
                if (subStatusBadge) {
                    subStatusBadge.textContent = 'Trial';
                    subStatusBadge.className = 'sub-status__badge sub-status__badge--trial';
                }
            } else {
                if (subStatusPlan) subStatusPlan.textContent = 'Plan ' + (sub.planName || sub.planId || 'Activo');
                if (subStatusExpires) {
                    var exp = new Date(sub.expiresAt);
                    subStatusExpires.textContent = 'Expira: ' + exp.toLocaleDateString('es', { day: '2-digit', month: 'long', year: 'numeric' });
                }
                if (subStatusBadge) {
                    subStatusBadge.textContent = 'Activo';
                    subStatusBadge.className = 'sub-status__badge sub-status__badge--active';
                }
            }
        } else {
            subStatus.style.display = 'flex';
            subStatus.className = 'sub-status sub-status--inactive';
            if (subStatusPlan) subStatusPlan.textContent = 'Sin suscripci\u00f3n activa';
            if (subStatusExpires) subStatusExpires.textContent = 'Elige un plan para comenzar';
            if (subStatusBadge) {
                subStatusBadge.textContent = 'Inactivo';
                subStatusBadge.className = 'sub-status__badge sub-status__badge--inactive';
            }
        }
    }

    // Subscribe buttons
    $$('.btn-subscribe').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var planId = btn.dataset.plan;
            if (!planId) return;
            if (isPreview) {
                showToast('Inicia el servidor para suscribirte', 'error');
                return;
            }
            btn.disabled = true;
            var origText = btn.textContent;
            btn.innerHTML = '<span class="spinner"></span> Redirigiendo...';

            apiCall('/stripe/checkout', {
                method: 'POST',
                body: JSON.stringify({ planId: planId })
            }).then(function(res) {
                if (res.freePass) {
                    // Owner/demo account — subscription activated instantly
                    showToast('✅ Plan ' + res.plan + ' activado (' + res.totalMonths + ' meses)', 'success');
                    invalidateSubCache();
                    loadSubscription(true);
                    btn.disabled = false;
                    btn.textContent = origText;
                } else if (res.url) {
                    window.location.href = res.url;
                } else {
                    showToast('Error: no se obtuvo URL de pago', 'error');
                }
            }).catch(function(err) {
                showToast(err.message || 'Error al iniciar pago', 'error');
            }).finally(function() {
                btn.disabled = false;
                btn.textContent = origText;
            });
        });
    });

    // Check URL for payment result
    function checkPaymentResult() {
        var params = new URLSearchParams(window.location.search);
        var payment = params.get('payment');
        var sessionId = params.get('session_id');
        if (payment === 'success') {
            navigateTo('plans');
            // Clean URL immediately so refresh doesn't re-trigger
            window.history.replaceState({}, '', '/');

            if (sessionId) {
                // Verify the session with backend (activates subscription if not already done by webhook)
                showToast('Verificando pago...', 'success');
                apiCall('/stripe/verify-session?session_id=' + encodeURIComponent(sessionId))
                    .then(function(res) {
                        if (res.ok) {
                            showToast('\u00a1Pago exitoso! Tu suscripci\u00f3n est\u00e1 activa.', 'success');
                        } else {
                            showToast('Pago pendiente de confirmaci\u00f3n.', 'error');
                        }
                        invalidateSubCache();
                        loadSubscription(true);
                    }).catch(function(err) {
                        showToast('Error verificando pago: ' + (err.message || ''), 'error');
                        invalidateSubCache();
                        loadSubscription(true);
                    });
            } else {
                showToast('\u00a1Pago exitoso! Tu suscripci\u00f3n est\u00e1 activa.', 'success');
                invalidateSubCache();
                loadSubscription(true);
            }
        } else if (payment === 'cancelled') {
            showToast('Pago cancelado.', 'error');
            navigateTo('plans');
            window.history.replaceState({}, '', '/');
        }
    }

    // --- Logout ---
    var btnLogout = $('#btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', function() {
            localStorage.removeItem('botsaas_token');
            localStorage.removeItem('botsaas_user');
            if (socket) socket.disconnect();

            // Sign out from Firebase — WAIT for it to finish before redirecting
            try {
                var fbConfig = {
                    apiKey: 'AIzaSyCcBN4HTgTdYLJR4VfCnAs7hlWWD-VnHb8',
                    authDomain: 'chatbot-1d169.firebaseapp.com',
                    projectId: 'chatbot-1d169'
                };
                if (!firebase.apps.length) firebase.initializeApp(fbConfig);
                firebase.auth().signOut().then(function() {
                    window.location.href = '/';
                }).catch(function() {
                    window.location.href = '/';
                });
            } catch (e) {
                console.warn('Firebase signOut error:', e);
                window.location.href = '/';
            }
        });
    }

    // --- Init ---
    function init() {
        var draft = loadDraft();
        if (draft) {
            hydrateForm(draft);
            showToast('Borrador local restaurado', 'success');
        }

        if (isPreview) {
            navigateTo('connection');
            showDemoQR();
            return;
        }

        apiCall('/config').then(function(res) {
            if (res.data) hydrateForm(res.data);
        }).catch(function() { /* use draft */ });

        apiCall('/bot/status').then(function(res) {
            if (res.status === 'connected') {
                initSocket();
                setConnectionStatus(true);
            } else if (res.status === 'qr') {
                initSocket();
                navigateTo('connection');
            }
        }).catch(function() { /* ignore */ });

        // Load messages history
        loadMessagesFromAPI();

        // Load response mode & paused chats
        loadResponseMode();
        loadPausedChats();

        // Load subscription status
        loadSubscription();

        // Check payment result from URL
        checkPaymentResult();
    }

    // --- Demo QR ---
    function showDemoQR() {
        if (!qrCanvas) return;
        qrPlaceholder.style.display = 'none';
        qrCanvas.classList.remove('qr-canvas--hidden');
        qrCanvas.innerHTML = '';
        var tryRender = function() {
            if (window.QRCode) {
                new QRCode(qrCanvas, {
                    text: 'https://botsaas.demo/preview-qr',
                    width: 256, height: 256,
                    colorDark: '#0f172a', colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.M
                });
                var label = document.createElement('p');
                label.textContent = 'QR de demo - Inicia el backend para el QR real';
                label.style.cssText = 'margin-top:.75rem;font-size:.78rem;color:#94a3b8;text-align:center;';
                qrCanvas.appendChild(label);
            } else {
                setTimeout(tryRender, 100);
            }
        };
        tryRender();
    }

    // ══════════════════════════════════════════════════════════
    //  VENTAS (BETA) — Sales Analysis
    // ══════════════════════════════════════════════════════════
    (function initVentas() {
        var btnAnalyze = $('#btn-analyze-ventas');
        var ventasStats = $('#ventas-stats');
        var ventasLoading = $('#ventas-loading');
        var ventasEmpty = $('#ventas-empty');
        var ventasResults = $('#ventas-results');
        var ventasList = $('#ventas-list');
        var filterBtns = $$('.ventas-filter');

        var analysisData = []; // store results for filtering

        if (!btnAnalyze) return;

        // Filter buttons
        filterBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                filterBtns.forEach(function(b) { b.classList.remove('ventas-filter--active'); });
                btn.classList.add('ventas-filter--active');
                var filter = btn.dataset.filter;
                renderVentasList(filter === 'all' ? analysisData : analysisData.filter(function(r) { return r.type === filter; }));
            });
        });

        // Analyze button
        btnAnalyze.addEventListener('click', function() {
            ventasEmpty.style.display = 'none';
            ventasResults.style.display = 'none';
            ventasStats.style.display = 'none';
            ventasLoading.style.display = 'flex';
            btnAnalyze.disabled = true;
            btnAnalyze.innerHTML =
                '<svg class="ventas-loading__spinner" style="width:16px;height:16px;border-width:2px;margin:0 .4rem 0 0;" viewBox="0 0 24 24"></svg>' +
                'Analizando...';

            fetch(API + '/ventas/analyze', {
                method: 'POST',
                headers: authHeaders()
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                ventasLoading.style.display = 'none';
                btnAnalyze.disabled = false;
                btnAnalyze.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                    'Analizar conversaciones';

                if (!data.ok || !data.data || data.data.length === 0) {
                    ventasEmpty.style.display = 'flex';
                    return;
                }

                analysisData = data.data;
                updateVentasStats(analysisData);
                ventasStats.style.display = 'grid';
                ventasResults.style.display = 'block';
                // Reset filter to 'all'
                filterBtns.forEach(function(b) { b.classList.remove('ventas-filter--active'); });
                var allBtn = document.querySelector('.ventas-filter[data-filter="all"]');
                if (allBtn) allBtn.classList.add('ventas-filter--active');
                renderVentasList(analysisData);
            })
            .catch(function(err) {
                console.error('[Ventas] Analysis error:', err);
                ventasLoading.style.display = 'none';
                ventasEmpty.style.display = 'flex';
                btnAnalyze.disabled = false;
                btnAnalyze.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                    'Analizar conversaciones';
                showToast('Error al analizar conversaciones', 'error');
            });
        });

        function updateVentasStats(results) {
            var sales = 0, appointments = 0, leads = 0;
            results.forEach(function(r) {
                if (r.type === 'sale') sales++;
                else if (r.type === 'appointment') appointments++;
                else if (r.type === 'lead') leads++;
            });
            var totalSalesEl = $('#ventas-total-sales');
            var totalAppEl = $('#ventas-total-appointments');
            var totalLeadsEl = $('#ventas-total-leads');
            var totalAnalyzedEl = $('#ventas-total-analyzed');
            if (totalSalesEl) totalSalesEl.textContent = sales;
            if (totalAppEl) totalAppEl.textContent = appointments;
            if (totalLeadsEl) totalLeadsEl.textContent = leads;
            if (totalAnalyzedEl) totalAnalyzedEl.textContent = results.length;
        }

        function renderVentasList(results) {
            if (!ventasList) return;
            ventasList.innerHTML = '';

            if (results.length === 0) {
                ventasList.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.9rem;">No se encontraron resultados con este filtro.</div>';
                return;
            }

            results.forEach(function(r, idx) {
                var typeLabels = {
                    sale: 'Venta',
                    appointment: 'Cita',
                    lead: 'Lead interesado',
                    no_result: 'Sin resultado'
                };
                var typeIcons = {
                    sale: '$',
                    appointment: '📅',
                    lead: '👤',
                    no_result: '—'
                };

                var initials = (r.contactName || r.phone || '??')
                    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '')
                    .split(' ')
                    .map(function(w) { return w[0]; })
                    .join('')
                    .toUpperCase()
                    .slice(0, 2) || '??';

                var card = document.createElement('div');
                card.className = 'ventas-item';
                card.dataset.type = r.type;

                var detailsHtml = '';
                if (r.product) {
                    detailsHtml += '<div class="ventas-detail"><span class="ventas-detail__label">Producto:</span><span class="ventas-detail__value">' + escHtml(r.product) + '</span></div>';
                }
                if (r.amount) {
                    detailsHtml += '<div class="ventas-detail"><span class="ventas-detail__label">Monto:</span><span class="ventas-detail__value">' + escHtml(r.amount) + '</span></div>';
                }
                if (r.date) {
                    detailsHtml += '<div class="ventas-detail"><span class="ventas-detail__label">Fecha:</span><span class="ventas-detail__value">' + escHtml(r.date) + '</span></div>';
                }
                if (r.confidence) {
                    detailsHtml += '<div class="ventas-detail"><span class="ventas-detail__label">Confianza:</span><span class="ventas-detail__value">' + r.confidence + '%</span></div>';
                }

                // Preview messages
                var previewHtml = '';
                if (r.relevantMessages && r.relevantMessages.length > 0) {
                    r.relevantMessages.forEach(function(m) {
                        var cls = m.direction === 'incoming' ? 'ventas-preview-msg--incoming' : 'ventas-preview-msg--outgoing';
                        var sender = m.direction === 'incoming' ? (r.contactName || r.phone) : 'Bot';
                        previewHtml += '<div class="ventas-preview-msg ' + cls + '">' +
                            '<span class="ventas-preview-msg__sender">' + escHtml(sender) + ':</span>' +
                            escHtml(m.body) +
                            '</div>';
                    });
                }

                card.innerHTML =
                    '<div class="ventas-item__top">' +
                        '<div class="ventas-item__contact">' +
                            '<div class="ventas-item__avatar ventas-item__avatar--' + r.type + '">' + initials + '</div>' +
                            '<div>' +
                                '<div class="ventas-item__name">' + escHtml(r.contactName || r.phone) + '</div>' +
                                '<div class="ventas-item__phone">' + escHtml(r.phone) + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<span class="ventas-badge ventas-badge--' + r.type + '">' + typeIcons[r.type] + ' ' + (typeLabels[r.type] || r.type) + '</span>' +
                    '</div>' +
                    '<p class="ventas-item__summary">' + escHtml(r.summary) + '</p>' +
                    (detailsHtml ? '<div class="ventas-item__details">' + detailsHtml + '</div>' : '') +
                    (previewHtml ?
                        '<button class="ventas-item__toggle" data-idx="' + idx + '">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                            'Ver conversación relevante' +
                        '</button>' +
                        '<div class="ventas-item__preview" id="ventas-preview-' + idx + '">' + previewHtml + '</div>'
                    : '');

                ventasList.appendChild(card);
            });

            // Toggle preview
            ventasList.querySelectorAll('.ventas-item__toggle').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var preview = document.getElementById('ventas-preview-' + btn.dataset.idx);
                    if (preview) {
                        var isOpen = preview.classList.contains('ventas-item__preview--open');
                        preview.classList.toggle('ventas-item__preview--open');
                        btn.classList.toggle('ventas-item__toggle--open');
                        btn.querySelector('svg').nextSibling.textContent = isOpen ? ' Ver conversación relevante' : ' Ocultar conversación';
                    }
                });
            });
        }

        function escHtml(text) {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    })();

    // ============================================================
    //  ADMIN PANEL — Users, Gift Time, Conversations Viewer
    // ============================================================
    (function () {
        var ADMIN_EMAILS = ['yoelskygold@gmail.com'];
        if (!user.email || ADMIN_EMAILS.indexOf(user.email) === -1) return;

        // --- DOM refs ---
        var kpiTotal   = document.getElementById('admin-kpi-total');
        var kpiActive  = document.getElementById('admin-kpi-active');
        var kpiExpired = document.getElementById('admin-kpi-expired');
        var kpiBots    = document.getElementById('admin-kpi-bots');
        var tbody      = document.getElementById('admin-users-tbody');
        var refreshBtn = document.getElementById('btn-admin-refresh');
        var modal      = document.getElementById('admin-user-modal');
        var modalClose = document.getElementById('admin-modal-close');
        var modalTitle = document.getElementById('admin-modal-title');
        var modalInfo  = document.getElementById('admin-modal-info');
        var giftResult = document.getElementById('admin-gift-result');
        var convosCount  = document.getElementById('admin-convos-count');
        var convosLoading = document.getElementById('admin-convos-loading');
        var convosList   = document.getElementById('admin-convos-list');

        var cachedUsers = [];
        var currentModalUid = null;

        // --- Load KPIs ---
        function loadMetrics() {
            apiCall('/admin/metrics').then(function (res) {
                if (!res.ok || !res.data) return;
                var d = res.data;
                if (kpiTotal) kpiTotal.textContent = d.totalUsers || 0;
                if (kpiActive) kpiActive.textContent = d.activeSubs || 0;
                if (kpiExpired) kpiExpired.textContent = d.cancelledSubs || 0;
                if (kpiBots) kpiBots.textContent = d.activeBots || 0;
            }).catch(function () {});
        }

        // --- Time remaining helper ---
        function timeRemaining(expiresAt) {
            if (!expiresAt) return { text: 'Sin plan', cls: '' };
            var now = Date.now();
            var exp = new Date(expiresAt).getTime();
            var diff = exp - now;
            if (diff <= 0) return { text: 'Expirado', cls: 'admin-time-remaining--expired' };
            var days = Math.floor(diff / 86400000);
            var hours = Math.floor((diff % 86400000) / 3600000);
            if (days > 7) return { text: days + ' días', cls: 'admin-time-remaining--ok' };
            if (days >= 1) return { text: days + 'd ' + hours + 'h', cls: 'admin-time-remaining--urgent' };
            return { text: hours + ' horas', cls: 'admin-time-remaining--urgent' };
        }

        // --- Render users table ---
        function renderUsers(users) {
            cachedUsers = users;
            if (!tbody) return;
            tbody.innerHTML = '';

            users.forEach(function (u) {
                var tr = document.createElement('tr');
                var time = timeRemaining(u.expiresAt);
                var statusBadge = u.status === 'active'
                    ? '<span class="admin-badge admin-badge--active">Activa</span>'
                    : u.status === 'expired'
                        ? '<span class="admin-badge admin-badge--expired">Expirada</span>'
                        : '<span class="admin-badge admin-badge--free">Gratis</span>';
                var botBadge = u.botStatus === 'connected'
                    ? '<span class="admin-badge admin-badge--bot-on">Conectado</span>'
                    : u.botStatus === 'qr'
                        ? '<span class="admin-badge admin-badge--bot-on">QR</span>'
                        : '<span class="admin-badge admin-badge--bot-off">Off</span>';

                tr.innerHTML =
                    '<td><div class="admin-user-cell"><strong>' + esc(u.name || u.email) + '</strong><small>' + esc(u.email) + '</small></div></td>' +
                    '<td>' + esc(u.planName || 'Gratis') + '</td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td><span class="admin-time-remaining ' + time.cls + '">' + time.text + '</span></td>' +
                    '<td>' + botBadge + '</td>' +
                    '<td><button class="admin-btn-detail" data-uid="' + u.uid + '">Ver detalles</button></td>';
                tbody.appendChild(tr);
            });

            // Bind detail buttons
            tbody.querySelectorAll('.admin-btn-detail').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    openModal(btn.dataset.uid);
                });
            });
        }

        function esc(s) { return s ? s.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''; }

        // --- Load users ---
        function loadUsers() {
            apiCall('/admin/users').then(function (res) {
                if (res.ok && res.data) renderUsers(res.data);
            }).catch(function () {});
        }

        // --- Open modal ---
        function openModal(uid) {
            currentModalUid = uid;
            var u = cachedUsers.filter(function (x) { return x.uid === uid; })[0];
            if (!u) return;

            if (modalTitle) modalTitle.textContent = u.name || u.email;
            if (giftResult) { giftResult.textContent = ''; giftResult.style.display = 'none'; }

            // Info grid
            if (modalInfo) {
                var time = timeRemaining(u.expiresAt);
                modalInfo.innerHTML =
                    '<div class="admin-info-item"><span class="admin-info-label">Email</span><span>' + esc(u.email) + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">Negocio</span><span>' + esc(u.businessName || '—') + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">Plan</span><span>' + esc(u.planName || 'Gratis') + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">Estado</span><span>' + esc(u.status) + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">Expira</span><span>' + (u.expiresAt ? new Date(u.expiresAt).toLocaleString('es-MX') : '—') + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">Tiempo restante</span><span class="admin-time-remaining ' + time.cls + '">' + time.text + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">Bot</span><span>' + esc(u.botStatus) + '</span></div>' +
                    '<div class="admin-info-item"><span class="admin-info-label">UID</span><span style="font-size:.75rem;opacity:.7">' + esc(u.uid) + '</span></div>';
            }

            // Load conversations
            if (convosList) convosList.innerHTML = '';
            if (convosCount) convosCount.textContent = '0';
            if (convosLoading) convosLoading.style.display = 'flex';
            loadConversations(uid);

            // Show modal
            if (modal) modal.style.display = 'flex';
        }

        // --- Close modal ---
        function closeModal() {
            if (modal) modal.style.display = 'none';
            currentModalUid = null;
        }
        if (modalClose) modalClose.addEventListener('click', closeModal);
        if (modal) {
            modal.addEventListener('click', function (e) {
                if (e.target === modal) closeModal();
            });
        }

        // --- Load conversations ---
        function loadConversations(uid) {
            apiCall('/admin/users/' + uid + '/conversations').then(function (res) {
                if (convosLoading) convosLoading.style.display = 'none';
                if (!res.ok || !res.data) return;
                if (convosCount) convosCount.textContent = res.data.length + ' (' + (res.totalMessages || 0) + ' msgs)';
                renderConversations(res.data);
            }).catch(function () {
                if (convosLoading) convosLoading.style.display = 'none';
            });
        }

        function renderConversations(convos) {
            if (!convosList) return;
            convosList.innerHTML = '';

            if (convos.length === 0) {
                convosList.innerHTML = '<p style="opacity:.5;text-align:center;padding:1rem;">Sin conversaciones</p>';
                return;
            }

            convos.forEach(function (c, idx) {
                var item = document.createElement('div');
                item.className = 'admin-convo-item';
                var lastTime = c.lastTimestamp ? new Date(c.lastTimestamp).toLocaleString('es-MX') : '';
                item.innerHTML =
                    '<div class="admin-convo-item__header">' +
                        '<div class="admin-convo-item__left">' +
                            '<strong>' + esc(c.senderName || c.phone) + '</strong>' +
                            '<small>' + esc(c.phone) + '</small>' +
                        '</div>' +
                        '<div class="admin-convo-item__right">' +
                            '<small>' + lastTime + '</small>' +
                            '<span class="admin-badge admin-badge--free">' + c.messages.length + ' msgs</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="admin-convo-messages" id="admin-convo-msgs-' + idx + '" style="display:none;"></div>';
                convosList.appendChild(item);

                // Click to expand
                var header = item.querySelector('.admin-convo-item__header');
                header.style.cursor = 'pointer';
                header.addEventListener('click', function () {
                    var msgsDiv = document.getElementById('admin-convo-msgs-' + idx);
                    if (!msgsDiv) return;
                    var isOpen = msgsDiv.style.display !== 'none';
                    msgsDiv.style.display = isOpen ? 'none' : 'block';
                    if (!isOpen && msgsDiv.innerHTML === '') {
                        // Render messages
                        c.messages.forEach(function (m) {
                            var bubble = document.createElement('div');
                            bubble.className = 'admin-msg ' + (m.direction === 'outgoing' ? 'admin-msg--outgoing' : 'admin-msg--incoming');
                            var time = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : '';
                            bubble.innerHTML = '<p>' + esc(m.body || '') + '</p><span class="admin-msg__time">' + time + '</span>';
                            msgsDiv.appendChild(bubble);
                        });
                    }
                });
            });
        }

        // --- Gift time buttons ---
        document.querySelectorAll('.admin-gift-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (!currentModalUid) return;
                var duration = btn.dataset.gift;
                btn.disabled = true;
                btn.textContent = '...';

                apiCall('/admin/users/' + currentModalUid + '/gift', {
                    method: 'POST',
                    body: JSON.stringify({ duration: duration })
                }).then(function (res) {
                    if (giftResult) {
                        giftResult.textContent = res.message || 'Tiempo regalado correctamente.';
                        giftResult.style.display = 'block';
                    }
                    // Refresh users list to update table
                    loadUsers();
                    // Refresh modal info after a brief delay
                    setTimeout(function () {
                        var u = cachedUsers.filter(function (x) { return x.uid === currentModalUid; })[0];
                        if (u && modalInfo) {
                            // Re-open info grid with fresh data
                            openModal(currentModalUid);
                        }
                    }, 1000);
                }).catch(function (err) {
                    if (giftResult) {
                        giftResult.textContent = 'Error: ' + (err.message || 'Fallo al regalar');
                        giftResult.style.display = 'block';
                        giftResult.style.color = '#ff6b6b';
                    }
                }).finally(function () {
                    // Restore buttons
                    var labels = { '1day': '+1 Día', '1week': '+1 Semana', '1month': '+1 Mes' };
                    btn.disabled = false;
                    btn.textContent = labels[duration] || duration;
                });
            });
        });

        // --- Refresh button ---
        if (refreshBtn) {
            refreshBtn.addEventListener('click', function () {
                loadUsers();
                loadMetrics();
                showToast('Datos actualizados', 'success');
            });
        }

        // --- Auto-load when admin section becomes visible ---
        var adminLoaded = false;
        var adminLink = document.querySelector('[data-section="admin"]');
        if (adminLink) {
            adminLink.addEventListener('click', function () {
                loadMetrics();
                loadUsers();
                adminLoaded = true;
            });
        }
    })();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
