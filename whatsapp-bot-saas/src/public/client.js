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
    var sidebarOverlay = $('#sidebar-overlay');
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
    var bottomNavTabs = $$('.bottom-nav__tab');

    function navigateTo(name) {
        sections.forEach(function(s) { s.classList.add('section--hidden'); });
        var target = $('#section-' + name);
        if (target) target.classList.remove('section--hidden');
        sidebarLinks.forEach(function(l) { l.classList.remove('sidebar__link--active'); });
        var link = $('[data-section="' + name + '"]');
        if (link) link.classList.add('sidebar__link--active');
        sidebar.classList.remove('sidebar--open');
        document.body.classList.remove('sidebar-open');
        if (sidebarOverlay) sidebarOverlay.classList.remove('sidebar-overlay--visible');

        // Update bottom nav active tab
        bottomNavTabs.forEach(function(tab) {
            if (tab.dataset.section === name) {
                tab.classList.add('bottom-nav__tab--active');
            } else {
                tab.classList.remove('bottom-nav__tab--active');
            }
        });

        // Scroll to top of section on mobile
        if (window.innerWidth <= 768) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    // Sidebar links
    sidebarLinks.forEach(function(l) {
        l.addEventListener('click', function(e) {
            if (!l.dataset.section) return;   // let normal <a> navigation happen (e.g. /admin)
            e.preventDefault();
            navigateTo(l.dataset.section);
        });
    });

    // Bottom nav tabs
    bottomNavTabs.forEach(function(tab) {
        tab.addEventListener('click', function() {
            if (tab.dataset.section) {
                navigateTo(tab.dataset.section);
            }
        });
    });

    $$('[data-goto]').forEach(function(b) {
        b.addEventListener('click', function() { navigateTo(b.dataset.goto); });
    });
    if (hamburger) {
        hamburger.addEventListener('click', function() {
            var isOpen = sidebar.classList.toggle('sidebar--open');
            document.body.classList.toggle('sidebar-open', isOpen);
            if (sidebarOverlay) sidebarOverlay.classList.toggle('sidebar-overlay--visible', isOpen);
        });
    }
    // Close sidebar when clicking overlay
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', function() {
            sidebar.classList.remove('sidebar--open');
            document.body.classList.remove('sidebar-open');
            sidebarOverlay.classList.remove('sidebar-overlay--visible');
        });
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

    // --- Socket.io (lazy — only connect when needed) ---
    function initSocket() {
        if (socket || isPreview) return;
        if (typeof io === 'undefined') {
            // Socket.io not loaded yet — retry in 500ms
            setTimeout(initSocket, 500);
            return;
        }

        socket = io({
            auth: { token: localStorage.getItem('botsaas_token') },
            reconnectionAttempts: 10,
            reconnectionDelay: 2000,
            reconnectionDelayMax: 10000,
            timeout: 10000,
            transports: ['websocket', 'polling'] // prefer WebSocket for lower overhead
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

        // Update count badge
        var inboxCount = $('#inbox-count');
        if (inboxCount) inboxCount.textContent = convos.length + (convos.length === 1 ? ' chat' : ' chats');

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
        document.body.classList.add('chat-open');

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
        document.body.classList.remove('chat-open');
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

    // --- Init (prioritizes critical path, defers secondary loads) ---
    var rIC = window.requestIdleCallback || function(cb) { return setTimeout(cb, 1); };

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

        // Critical: load config + bot status first
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

        // Secondary: load messages (deferred)
        rIC(function() {
            loadMessagesFromAPI();
            loadResponseMode();
            loadPausedChats();
        });

        // Low priority: subscription, payment, filters
        rIC(function() {
            loadSubscription();
            checkPaymentResult();
            loadMessageFilters();
            loadScheduledMessages();
            loadGroupsForSelectors();
        });
    }

    // ═══════════════════════════════════════════════════
    //  MESSAGE TABS NAVIGATION
    // ═══════════════════════════════════════════════════
    (function initMsgTabs() {
        var tabs = document.querySelectorAll('.msg-tab');
        tabs.forEach(function(tab) {
            tab.addEventListener('click', function() {
                var target = tab.dataset.msgTab;
                tabs.forEach(function(t) { t.classList.remove('msg-tab--active'); });
                tab.classList.add('msg-tab--active');
                document.querySelectorAll('.msg-tab-content').forEach(function(c) {
                    c.classList.remove('msg-tab-content--active');
                });
                var panel = document.getElementById('msg-tab-' + target);
                if (panel) panel.classList.add('msg-tab-content--active');
            });
        });
    })();

    // ═══════════════════════════════════════════════════
    //  MESSAGE RESPONSE FILTERS
    // ═══════════════════════════════════════════════════
    var filterSavedContacts   = $('#filter-saved-contacts');
    var filterUnsavedContacts = $('#filter-unsaved-contacts');
    var filterGroups          = $('#filter-groups');
    var groupSelectorPanel    = $('#group-selector');
    var groupList             = $('#group-list');
    var btnSaveFilters        = $('#btn-save-filters');
    var selectedGroups        = [];

    function loadMessageFilters() {
        apiCall('/config/message-filters').then(function(res) {
            if (!res.ok) return;
            var f = res.data || {};
            if (filterSavedContacts)   filterSavedContacts.checked   = f.replySavedContacts !== false;
            if (filterUnsavedContacts) filterUnsavedContacts.checked = f.replyUnsavedContacts !== false;
            if (filterGroups)          filterGroups.checked          = !!f.replyGroups;
            selectedGroups = f.selectedGroups || [];
            toggleGroupSelector();
            renderGroupSelections();
        }).catch(function() {});
    }

    function toggleGroupSelector() {
        if (!groupSelectorPanel) return;
        groupSelectorPanel.style.display = (filterGroups && filterGroups.checked) ? 'block' : 'none';
    }

    if (filterGroups) {
        filterGroups.addEventListener('change', toggleGroupSelector);
    }

    function renderGroupSelections() {
        if (!groupList) return;
        var items = groupList.querySelectorAll('.group-selector__item');
        items.forEach(function(item) {
            var gid = item.dataset.groupId;
            if (selectedGroups.indexOf(gid) !== -1) {
                item.classList.add('group-selector__item--selected');
            } else {
                item.classList.remove('group-selector__item--selected');
            }
        });
    }

    function loadGroupsForSelectors() {
        apiCall('/bot/groups').then(function(res) {
            if (!res.ok || !res.data) return;
            var groups = res.data;
            renderGroupList(groups);
            renderScheduleGroupOptions(groups);
        }).catch(function() {});
    }

    function renderGroupList(groups) {
        if (!groupList) return;
        if (groups.length === 0) {
            groupList.innerHTML =
                '<div class="group-selector__empty">' +
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
                    '<p>No se encontraron grupos. Asegúrate de que el bot esté conectado.</p>' +
                '</div>';
            return;
        }
        groupList.innerHTML = '';
        groups.forEach(function(g) {
            var initials = (g.name || '??').split(' ').map(function(w) { return w[0]; }).join('').toUpperCase().slice(0, 2);
            var selected = selectedGroups.indexOf(g.id) !== -1;
            var div = document.createElement('div');
            div.className = 'group-selector__item' + (selected ? ' group-selector__item--selected' : '');
            div.dataset.groupId = g.id;
            div.innerHTML =
                '<div class="group-selector__item-icon">' + escapeHtml(initials) + '</div>' +
                '<span class="group-selector__item-name">' + escapeHtml(g.name) + '</span>' +
                '<div class="group-selector__item-check"></div>';
            div.addEventListener('click', function() {
                var idx = selectedGroups.indexOf(g.id);
                if (idx !== -1) {
                    selectedGroups.splice(idx, 1);
                    div.classList.remove('group-selector__item--selected');
                } else {
                    selectedGroups.push(g.id);
                    div.classList.add('group-selector__item--selected');
                }
            });
            groupList.appendChild(div);
        });
    }

    if (btnSaveFilters) {
        btnSaveFilters.addEventListener('click', function() {
            var data = {
                replySavedContacts:   filterSavedContacts   ? filterSavedContacts.checked   : true,
                replyUnsavedContacts: filterUnsavedContacts ? filterUnsavedContacts.checked : true,
                replyGroups:          filterGroups          ? filterGroups.checked          : false,
                selectedGroups:       selectedGroups
            };
            btnSaveFilters.disabled = true;
            btnSaveFilters.innerHTML = '<span class="spinner"></span> Guardando...';
            apiCall('/config/message-filters', {
                method: 'POST',
                body: JSON.stringify(data)
            }).then(function() {
                showToast('Filtros guardados correctamente');
            }).catch(function(err) {
                showToast(err.message || 'Error al guardar filtros', 'error');
            }).finally(function() {
                btnSaveFilters.disabled = false;
                btnSaveFilters.innerHTML =
                    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>' +
                    ' Guardar filtros';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    //  SCHEDULED / RECURRING MESSAGES
    // ═══════════════════════════════════════════════════
    var schedGroupSelect  = $('#sched-group-select');
    var schedIntervalVal  = $('#sched-interval-value');
    var schedIntervalUnit = $('#sched-interval-unit');
    var schedMessage      = $('#sched-message');
    var btnAddScheduled   = $('#btn-add-scheduled');
    var scheduledList     = $('#scheduled-list');
    var scheduledEmpty    = $('#scheduled-empty');
    var scheduledItems    = [];

    function renderScheduleGroupOptions(groups) {
        if (!schedGroupSelect) return;
        // Keep the default option
        schedGroupSelect.innerHTML = '<option value="">— Selecciona un grupo —</option>';
        groups.forEach(function(g) {
            var opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.name;
            schedGroupSelect.appendChild(opt);
        });
    }

    function loadScheduledMessages() {
        apiCall('/config/scheduled-messages').then(function(res) {
            if (!res.ok) return;
            scheduledItems = res.data || [];
            renderScheduledList();
        }).catch(function() {});
    }

    function renderScheduledList() {
        if (!scheduledList) return;

        // Remove old items (keep the empty placeholder)
        var oldItems = scheduledList.querySelectorAll('.scheduled-item');
        oldItems.forEach(function(el) { el.remove(); });

        if (scheduledItems.length === 0) {
            if (scheduledEmpty) scheduledEmpty.style.display = 'flex';
            return;
        }
        if (scheduledEmpty) scheduledEmpty.style.display = 'none';

        var unitLabels = { minutes: 'min', hours: 'hrs', days: 'días' };

        scheduledItems.forEach(function(item, idx) {
            var div = document.createElement('div');
            div.className = 'scheduled-item';
            div.innerHTML =
                '<div class="scheduled-item__icon">🔄</div>' +
                '<div class="scheduled-item__body">' +
                    '<div class="scheduled-item__top">' +
                        '<span class="scheduled-item__group">' + escapeHtml(item.groupName || item.groupId) + '</span>' +
                        '<span class="scheduled-item__interval">Cada ' + item.intervalValue + ' ' + (unitLabels[item.intervalUnit] || item.intervalUnit) + '</span>' +
                    '</div>' +
                    '<p class="scheduled-item__message">' + escapeHtml(item.message) + '</p>' +
                    '<span class="scheduled-item__meta">' +
                        (item.enabled ? '✅ Activo' : '⏸ Pausado') +
                        (item.lastSent ? ' · Último envío: ' + formatTime(item.lastSent) : ' · Aún no enviado') +
                    '</span>' +
                '</div>' +
                '<div class="scheduled-item__actions">' +
                    '<label class="toggle scheduled-item__toggle">' +
                        '<input type="checkbox" data-sched-idx="' + idx + '" class="sched-toggle" ' + (item.enabled ? 'checked' : '') + '>' +
                        '<span class="toggle__slider"></span>' +
                    '</label>' +
                    '<button class="btn btn--ghost btn--sm scheduled-item__delete" data-sched-idx="' + idx + '">Eliminar</button>' +
                '</div>';
            scheduledList.appendChild(div);
        });

        // Bind toggle events
        scheduledList.querySelectorAll('.sched-toggle').forEach(function(toggle) {
            toggle.addEventListener('change', function() {
                var idx = parseInt(toggle.dataset.schedIdx);
                scheduledItems[idx].enabled = toggle.checked;
                saveScheduledMessages();
            });
        });

        // Bind delete events
        scheduledList.querySelectorAll('.scheduled-item__delete').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var idx = parseInt(btn.dataset.schedIdx);
                if (!confirm('¿Eliminar este mensaje programado?')) return;
                scheduledItems.splice(idx, 1);
                saveScheduledMessages();
                renderScheduledList();
            });
        });
    }

    function saveScheduledMessages() {
        apiCall('/config/scheduled-messages', {
            method: 'POST',
            body: JSON.stringify({ messages: scheduledItems })
        }).then(function() {
            showToast('Mensajes programados actualizados');
        }).catch(function(err) {
            showToast(err.message || 'Error al guardar', 'error');
        });
    }

    if (btnAddScheduled) {
        btnAddScheduled.addEventListener('click', function() {
            var groupId = schedGroupSelect ? schedGroupSelect.value : '';
            var groupName = schedGroupSelect ? schedGroupSelect.options[schedGroupSelect.selectedIndex].text : '';
            var intervalValue = schedIntervalVal ? parseInt(schedIntervalVal.value) : 1;
            var intervalUnit = schedIntervalUnit ? schedIntervalUnit.value : 'hours';
            var message = schedMessage ? schedMessage.value.trim() : '';

            if (!groupId) { showToast('Selecciona un grupo', 'error'); return; }
            if (!message) { showToast('Escribe un mensaje', 'error'); return; }
            if (intervalValue < 1) { showToast('El intervalo debe ser al menos 1', 'error'); return; }

            scheduledItems.push({
                id: 'sched_' + Date.now(),
                groupId: groupId,
                groupName: groupName,
                intervalValue: intervalValue,
                intervalUnit: intervalUnit,
                message: message,
                enabled: true,
                lastSent: null,
                createdAt: new Date().toISOString()
            });

            saveScheduledMessages();
            renderScheduledList();

            // Clear form
            if (schedGroupSelect) schedGroupSelect.value = '';
            if (schedIntervalVal) schedIntervalVal.value = '1';
            if (schedIntervalUnit) schedIntervalUnit.value = 'hours';
            if (schedMessage) schedMessage.value = '';

            showToast('Mensaje programado agregado');
        });
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
    //  VENTAS (V2) — Sales Analysis, Abandoned Detection, Follow-ups
    // ══════════════════════════════════════════════════════════
    (function initVentas() {
        var btnAnalyze = $('#btn-analyze-ventas');
        var btnLoadHistory = $('#btn-load-ventas');
        var ventasStats = $('#ventas-stats');
        var ventasLoading = $('#ventas-loading');
        var ventasEmpty = $('#ventas-empty');
        var ventasResults = $('#ventas-results');
        var ventasList = $('#ventas-list');
        var ventasFunnel = $('#ventas-funnel');
        var filterBtns = $$('.ventas-filter');

        // Follow-up modal refs
        var followupModal = $('#ventas-followup-modal');
        var followupText = $('#ventas-followup-text');
        var followupContact = $('#ventas-modal-contact');
        var followupSendBtn = $('#ventas-modal-send');
        var followupCancelBtn = $('#ventas-modal-cancel');
        var followupCloseBtn = $('#ventas-modal-close');

        var analysisData = [];
        var currentFollowUpPhone = null;

        if (!btnAnalyze) return;

        // ── Filter buttons ──
        filterBtns.forEach(function(btn) {
            btn.addEventListener('click', function() {
                filterBtns.forEach(function(b) { b.classList.remove('ventas-filter--active'); });
                btn.classList.add('ventas-filter--active');
                var filter = btn.dataset.filter;
                renderVentasList(filter === 'all' ? analysisData : analysisData.filter(function(r) { return r.type === filter; }));
            });
        });

        // ── Load history button ──
        if (btnLoadHistory) {
            btnLoadHistory.addEventListener('click', function() {
                btnLoadHistory.disabled = true;
                fetch(API + '/ventas/results', { headers: authHeaders() })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    btnLoadHistory.disabled = false;
                    if (data.ok && data.data && data.data.length > 0) {
                        analysisData = data.data;
                        showResults(analysisData);
                        showToast('Último análisis cargado', 'success');
                    } else {
                        showToast('No hay análisis guardado', 'info');
                    }
                })
                .catch(function() {
                    btnLoadHistory.disabled = false;
                    showToast('Error al cargar historial', 'error');
                });
            });
        }

        // ── Analyze button ──
        btnAnalyze.addEventListener('click', function() {
            ventasEmpty.style.display = 'none';
            ventasResults.style.display = 'none';
            ventasStats.style.display = 'none';
            ventasFunnel.style.display = 'none';
            ventasLoading.style.display = 'flex';
            btnAnalyze.disabled = true;
            btnAnalyze.innerHTML =
                '<div class="ventas-loading__spinner" style="width:16px;height:16px;border-width:2px;margin:0 .4rem 0 0;display:inline-block;"></div>' +
                'Analizando...';

            fetch(API + '/ventas/analyze', {
                method: 'POST',
                headers: authHeaders()
            })
            .then(function(r) { return r.json(); })
            .then(function(data) {
                ventasLoading.style.display = 'none';
                resetAnalyzeBtn();

                if (!data.ok || !data.data || data.data.length === 0) {
                    ventasEmpty.style.display = 'flex';
                    return;
                }

                analysisData = data.data;
                showResults(analysisData);
            })
            .catch(function(err) {
                console.error('[Ventas] Analysis error:', err);
                ventasLoading.style.display = 'none';
                ventasEmpty.style.display = 'flex';
                resetAnalyzeBtn();
                showToast('Error al analizar conversaciones', 'error');
            });
        });

        function resetAnalyzeBtn() {
            btnAnalyze.disabled = false;
            btnAnalyze.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>' +
                'Analizar conversaciones';
        }

        function showResults(results) {
            updateVentasStats(results);
            updateFunnel(results);
            ventasStats.style.display = 'grid';
            ventasFunnel.style.display = 'block';
            ventasResults.style.display = 'block';
            ventasEmpty.style.display = 'none';
            // Reset filter to 'all'
            filterBtns.forEach(function(b) { b.classList.remove('ventas-filter--active'); });
            var allBtn = document.querySelector('.ventas-filter[data-filter="all"]');
            if (allBtn) allBtn.classList.add('ventas-filter--active');
            renderVentasList(results);
        }

        function updateVentasStats(results) {
            var sales = 0, abandoned = 0, appointments = 0, leads = 0;
            results.forEach(function(r) {
                if (r.type === 'sale') sales++;
                else if (r.type === 'abandoned') abandoned++;
                else if (r.type === 'appointment') appointments++;
                else if (r.type === 'lead') leads++;
            });
            setText('#ventas-total-sales', sales);
            setText('#ventas-total-abandoned', abandoned);
            setText('#ventas-total-appointments', appointments);
            setText('#ventas-total-leads', leads);
            setText('#ventas-total-analyzed', results.length);
        }

        function setText(sel, val) {
            var el = document.querySelector(sel);
            if (el) el.textContent = val;
        }

        function updateFunnel(results) {
            var sales = 0, abandoned = 0, appointments = 0, leads = 0;
            results.forEach(function(r) {
                if (r.type === 'sale') sales++;
                else if (r.type === 'abandoned') abandoned++;
                else if (r.type === 'appointment') appointments++;
                else if (r.type === 'lead') leads++;
            });
            var total = sales + abandoned + appointments + leads;
            if (total === 0) { ventasFunnel.style.display = 'none'; return; }

            setFunnelWidth('#funnel-leads', leads, total);
            setFunnelWidth('#funnel-abandoned', abandoned, total);
            setFunnelWidth('#funnel-appointments', appointments, total);
            setFunnelWidth('#funnel-sales', sales, total);
        }

        function setFunnelWidth(sel, count, total) {
            var el = document.querySelector(sel);
            if (!el) return;
            var pct = total > 0 ? Math.max(count > 0 ? 8 : 0, (count / total) * 100) : 0;
            el.style.width = pct + '%';
            el.style.display = count > 0 ? 'flex' : 'none';
            el.querySelector('.ventas-funnel__segment-label').textContent =
                count > 0 ? (el.title + ' ' + count) : '';
        }

        // ── Follow-up modal ──
        function openFollowUpModal(phone, contactName, suggestedMsg) {
            currentFollowUpPhone = phone;
            followupContact.textContent = 'Para: ' + (contactName || phone);
            followupText.value = suggestedMsg || '';
            followupModal.style.display = 'flex';
        }

        function closeFollowUpModal() {
            followupModal.style.display = 'none';
            currentFollowUpPhone = null;
        }

        if (followupCloseBtn) followupCloseBtn.addEventListener('click', closeFollowUpModal);
        if (followupCancelBtn) followupCancelBtn.addEventListener('click', closeFollowUpModal);
        if (followupModal) followupModal.addEventListener('click', function(e) {
            if (e.target === followupModal) closeFollowUpModal();
        });

        if (followupSendBtn) {
            followupSendBtn.addEventListener('click', function() {
                var msg = followupText.value.trim();
                if (!msg || !currentFollowUpPhone) return;

                followupSendBtn.disabled = true;
                followupSendBtn.textContent = 'Enviando...';

                fetch(API + '/ventas/followup', {
                    method: 'POST',
                    headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
                    body: JSON.stringify({ phone: currentFollowUpPhone, message: msg })
                })
                .then(function(r) { return r.json(); })
                .then(function(data) {
                    followupSendBtn.disabled = false;
                    followupSendBtn.innerHTML =
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar por WhatsApp';
                    if (data.ok) {
                        showToast('Mensaje de seguimiento enviado', 'success');
                        // Update status in local data
                        var item = analysisData.find(function(r) { return r.phone === currentFollowUpPhone; });
                        if (item) item.salesStatus = 'contacted';
                        closeFollowUpModal();
                        // Re-render
                        var activeFilter = document.querySelector('.ventas-filter--active');
                        var filter = activeFilter ? activeFilter.dataset.filter : 'all';
                        renderVentasList(filter === 'all' ? analysisData : analysisData.filter(function(r) { return r.type === filter; }));
                    } else {
                        showToast(data.error || 'Error al enviar', 'error');
                    }
                })
                .catch(function() {
                    followupSendBtn.disabled = false;
                    followupSendBtn.innerHTML =
                        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar por WhatsApp';
                    showToast('Error al enviar seguimiento', 'error');
                });
            });
        }

        // ── Render results list ──
        function renderVentasList(results) {
            if (!ventasList) return;
            ventasList.innerHTML = '';

            if (results.length === 0) {
                ventasList.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.9rem;">No se encontraron resultados con este filtro.</div>';
                return;
            }

            results.forEach(function(r, idx) {
                var typeLabels = {
                    sale: 'Venta confirmada',
                    abandoned: 'Casi compró',
                    appointment: 'Cita agendada',
                    lead: 'Lead interesado',
                    no_result: 'Sin resultado'
                };
                var typeIcons = {
                    sale: '💰',
                    abandoned: '🔥',
                    appointment: '📅',
                    lead: '👤',
                    no_result: '—'
                };
                var urgencyLabels = {
                    high: '🔴 Urgente',
                    medium: '🟡 Media',
                    low: ''
                };

                var initials = (r.contactName || r.phone || '??')
                    .replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, '')
                    .split(' ')
                    .map(function(w) { return w[0]; })
                    .join('')
                    .toUpperCase()
                    .slice(0, 2) || '??';

                var card = document.createElement('div');
                card.className = 'ventas-item' + (r.type === 'abandoned' ? ' ventas-item--abandoned' : '');
                card.dataset.type = r.type;

                // Details chips
                var detailsHtml = '';
                if (r.product) {
                    detailsHtml += '<div class="ventas-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> ' + escHtml(r.product) + '</div>';
                }
                if (r.amount) {
                    detailsHtml += '<div class="ventas-chip ventas-chip--money"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg> ' + escHtml(r.amount) + '</div>';
                }
                if (r.date) {
                    detailsHtml += '<div class="ventas-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg> ' + escHtml(r.date) + '</div>';
                }
                if (r.confidence) {
                    detailsHtml += '<div class="ventas-chip ventas-chip--conf">' + r.confidence + '% confianza</div>';
                }
                if (r.urgency && urgencyLabels[r.urgency]) {
                    detailsHtml += '<div class="ventas-chip ventas-chip--urgency-' + r.urgency + '">' + urgencyLabels[r.urgency] + '</div>';
                }

                // Status badge
                var statusHtml = '';
                if (r.salesStatus === 'contacted') {
                    statusHtml = '<span class="ventas-status-tag ventas-status-tag--contacted">✓ Contactado</span>';
                } else if (r.salesStatus === 'won') {
                    statusHtml = '<span class="ventas-status-tag ventas-status-tag--won">🏆 Ganado</span>';
                } else if (r.salesStatus === 'lost') {
                    statusHtml = '<span class="ventas-status-tag ventas-status-tag--lost">✗ Perdido</span>';
                }

                // Last activity info
                var lastActivityHtml = '';
                if (r.lastActivity) {
                    lastActivityHtml = '<div class="ventas-item__last-activity"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ' + escHtml(r.lastActivity) + '</div>';
                }

                // Action buttons
                var actionsHtml = '';
                if (r.type === 'abandoned' || r.type === 'lead') {
                    actionsHtml = '<div class="ventas-item__actions">';
                    actionsHtml += '<button class="btn btn--accent btn--xs ventas-followup-btn" data-phone="' + escHtml(r.phone) + '" data-name="' + escHtml(r.contactName || r.phone) + '" data-msg="' + escHtml(r.followUp || '') + '">';
                    actionsHtml += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Enviar seguimiento';
                    actionsHtml += '</button>';
                    actionsHtml += '</div>';
                }

                // Preview
                var previewHtml = '';
                if (r.relevantMessages && r.relevantMessages.length > 0) {
                    r.relevantMessages.forEach(function(m) {
                        var cls = m.direction === 'incoming' ? 'ventas-preview-msg--incoming' : 'ventas-preview-msg--outgoing';
                        var sender = m.direction === 'incoming' ? (r.contactName || r.phone) : 'Bot';
                        previewHtml += '<div class="ventas-preview-msg ' + cls + '">' +
                            '<span class="ventas-preview-msg__sender">' + escHtml(sender) + ':</span> ' +
                            escHtml(m.body) +
                            '</div>';
                    });
                }

                // Follow-up suggestion preview
                var followUpHtml = '';
                if (r.followUp && (r.type === 'abandoned' || r.type === 'lead')) {
                    followUpHtml = '<div class="ventas-item__followup-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg> IA sugiere: <em>"' + escHtml(r.followUp.substring(0, 80)) + (r.followUp.length > 80 ? '...' : '') + '"</em></div>';
                }

                card.innerHTML =
                    '<div class="ventas-item__top">' +
                        '<div class="ventas-item__contact">' +
                            '<div class="ventas-item__avatar ventas-item__avatar--' + r.type + '">' + initials + '</div>' +
                            '<div>' +
                                '<div class="ventas-item__name">' + escHtml(r.contactName || r.phone) + ' ' + statusHtml + '</div>' +
                                '<div class="ventas-item__phone">' + escHtml(r.phone) + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<span class="ventas-badge ventas-badge--' + r.type + '">' + typeIcons[r.type] + ' ' + (typeLabels[r.type] || r.type) + '</span>' +
                    '</div>' +
                    '<p class="ventas-item__summary">' + escHtml(r.summary) + '</p>' +
                    lastActivityHtml +
                    (detailsHtml ? '<div class="ventas-item__chips">' + detailsHtml + '</div>' : '') +
                    followUpHtml +
                    actionsHtml +
                    (previewHtml ?
                        '<button class="ventas-item__toggle" data-idx="' + idx + '">' +
                            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>' +
                            ' Ver conversación relevante' +
                        '</button>' +
                        '<div class="ventas-item__preview" id="ventas-preview-' + idx + '">' + previewHtml + '</div>'
                    : '');

                ventasList.appendChild(card);
            });

            // ── Event delegation for follow-up buttons ──
            ventasList.querySelectorAll('.ventas-followup-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    openFollowUpModal(btn.dataset.phone, btn.dataset.name, btn.dataset.msg);
                });
            });

            // ── Toggle preview ──
            ventasList.querySelectorAll('.ventas-item__toggle').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var preview = document.getElementById('ventas-preview-' + btn.dataset.idx);
                    if (preview) {
                        var isOpen = preview.classList.contains('ventas-item__preview--open');
                        preview.classList.toggle('ventas-item__preview--open');
                        btn.classList.toggle('ventas-item__toggle--open');
                        var textNode = btn.lastChild;
                        if (textNode) textNode.textContent = isOpen ? ' Ver conversación relevante' : ' Ocultar conversación';
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
