/* ============================================================
   Botly — Admin Panel Logic  (admin.js)
   Pure ES5 IIFE — mirrors client.js patterns
   ============================================================ */
(function () {
    'use strict';

    // ─── Firebase ────────────────────────────────────────────
    var firebaseConfig = {
        apiKey: "AIzaSyCcBN4HTgTdYLJR4VfCnAs7hlWWD-VnHb8",
        authDomain: "chatbot-1d169.firebaseapp.com",
        projectId: "chatbot-1d169",
        storageBucket: "chatbot-1d169.firebasestorage.app",
        messagingSenderId: "376839837560",
        appId: "1:376839837560:web:0af7208dc4f81b487f9a8d"
    };
    firebase.initializeApp(firebaseConfig);
    var auth = firebase.auth();

    // ─── Constants ───────────────────────────────────────────
    var API = '';
    var PAGE_SIZE = 12;
    var AVATAR_COLORS = [
        '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
        '#10b981', '#3b82f6', '#ef4444', '#14b8a6'
    ];
    var PLAN_PRICES = { monthly: 7900, quarterly: 23700, yearly: 94800 };

    // ─── State ───────────────────────────────────────────────
    var allUsers     = [];
    var filtered     = [];
    var currentPage  = 1;
    var currentSort  = { key: 'createdAt', dir: 'desc' };
    var activeFilter = 'all';
    var searchQuery  = '';
    var dataLoaded   = false;

    // ─── DOM refs ────────────────────────────────────────────
    var $loading     = document.getElementById('admin-loading');
    var $denied      = document.getElementById('admin-denied');
    var $content     = document.getElementById('admin-content');
    var $refresh     = document.getElementById('btn-refresh');
    var $search      = document.getElementById('user-search');
    var $tbody       = document.getElementById('users-tbody');
    var $pagination  = document.getElementById('pagination');
    var $usersCount  = document.getElementById('users-count');
    var $modalOvl    = document.getElementById('modal-overlay');
    var $modalBody   = document.getElementById('modal-body');
    var $modalTitle  = document.getElementById('modal-title');
    var $modalClose  = document.getElementById('modal-close');

    // Sections (cached at init)
    var $sectionOverview = document.getElementById('section-overview');
    var $sectionUsers    = document.getElementById('section-users');
    var $sectionRevenue  = document.getElementById('section-revenue');
    var allSections      = [$sectionOverview, $sectionUsers, $sectionRevenue];
    var sectionMap       = { overview: $sectionOverview, users: $sectionUsers, revenue: $sectionRevenue };

    // KPI elements
    var $kpiMrr        = document.getElementById('kpi-mrr');
    var $kpiUsers      = document.getElementById('kpi-users');
    var $kpiNewUsers   = document.getElementById('kpi-new-users');
    var $kpiActiveSubs = document.getElementById('kpi-active-subs');
    var $kpiChurn      = document.getElementById('kpi-churn');
    var $kpiBots       = document.getElementById('kpi-bots');
    var $kpiRevenue    = document.getElementById('kpi-total-revenue');
    var $revenueBar    = document.getElementById('revenue-bar-fill');
    var $planBreakdown = document.getElementById('plan-breakdown');

    // ─── API helpers ─────────────────────────────────────────
    function authHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (localStorage.getItem('botsaas_token') || '')
        };
    }

    function apiCall(path, options) {
        options = options || {};
        console.log('[Admin] API →', path);
        return fetch(API + path, Object.assign({ headers: authHeaders() }, options))
            .then(function (res) {
                console.log('[Admin] API ←', path, res.status);
                if (res.status === 401) {
                    localStorage.removeItem('botsaas_token');
                    localStorage.removeItem('botsaas_user');
                    window.location.href = './auth.html';
                    return Promise.reject(new Error('AUTH'));
                }
                if (res.status === 403) {
                    return Promise.reject(new Error('FORBIDDEN'));
                }
                var ct = res.headers.get('content-type') || '';
                if (ct.indexOf('application/json') === -1) return Promise.reject(new Error('NOT_JSON'));
                return res.json().then(function (json) {
                    if (!res.ok) return Promise.reject(new Error(json.error || 'Error ' + res.status));
                    return json;
                });
            });
    }

    // ─── Show / Hide Section ─────────────────────────────────
    function showSection(name) {
        console.log('[Admin] showSection:', name);
        for (var i = 0; i < allSections.length; i++) {
            allSections[i].style.display = 'none';
        }
        var target = sectionMap[name];
        if (target) {
            target.style.display = 'block';
        }
    }

    // ─── Auth gate ───────────────────────────────────────────
    var ADMIN_EMAILS = ['yoelskygold@gmail.com'];

    auth.onAuthStateChanged(function (user) {
        if (!user) {
            window.location.href = './auth.html';
            return;
        }
        // Block non-admin users immediately
        if (!user.email || ADMIN_EMAILS.indexOf(user.email) === -1) {
            window.location.href = '/';
            return;
        }
        user.getIdToken().then(function (token) {
            localStorage.setItem('botsaas_token', token);
            boot();
        });
    });

    function boot() {
        console.log('[Admin] Booting…');

        // Load metrics and users in PARALLEL (not chained)
        var metricsOk = false;
        var metricsPromise = apiCall('/api/admin/metrics')
            .then(function (res) {
                console.log('[Admin] Metrics loaded:', res.data);
                metricsOk = true;
                $loading.style.display = 'none';
                $content.style.display = 'block';
                showSection('overview');
                renderMetrics(res.data);
            })
            .catch(function (err) {
                console.error('[Admin] Metrics error:', err);
                $loading.style.display = 'none';
                if (err.message === 'FORBIDDEN') {
                    $denied.style.display = 'flex';
                } else {
                    $content.style.display = 'block';
                    showSection('overview');
                    toast('Error cargando métricas: ' + err.message, 'error');
                }
            });

        var usersPromise = apiCall('/api/admin/users')
            .then(function (res) {
                console.log('[Admin] Users loaded:', res.data.length, 'users');
                allUsers = res.data || [];
                dataLoaded = true;
                applyFilters();
                renderRevenue();
            })
            .catch(function (err) {
                console.error('[Admin] Users load error:', err);
                toast('Error cargando usuarios: ' + err.message, 'error');
            });

        // Make sure content is shown even if metrics takes long
        Promise.all([metricsPromise, usersPromise]).then(function () {
            if (!metricsOk) {
                $loading.style.display = 'none';
                $content.style.display = 'block';
                showSection('overview');
            }
            console.log('[Admin] Boot complete. Users:', allUsers.length);
        });
    }

    // ─── Render Metrics ──────────────────────────────────────
    function renderMetrics(d) {
        $kpiMrr.textContent        = '$' + fmtMoney(d.mrrCentavos) + ' MXN';
        $kpiUsers.textContent      = d.totalUsers;
        $kpiNewUsers.textContent   = '+' + d.newUsersThisMonth + ' este mes';
        $kpiActiveSubs.textContent = d.activeSubs;
        $kpiChurn.textContent      = 'Churn: ' + d.churnRate + '%';
        $kpiBots.textContent       = d.activeBots;
        $kpiRevenue.textContent    = '$' + fmtMoney(d.totalRevenueCentavos) + ' MXN';

        // Revenue bar (target $50k MXN/mo for visual reference)
        var pct = Math.min(100, (d.mrrCentavos / 5000000) * 100);
        $revenueBar.style.width = Math.max(2, pct) + '%';
    }

    // ─── Render Users Table ──────────────────────────────────
    function applyFilters() {
        var q = searchQuery.toLowerCase();
        filtered = allUsers.filter(function (u) {
            if (activeFilter !== 'all' && u.status !== activeFilter) return false;
            if (q) {
                var hay = ((u.email || '') + ' ' + (u.name || '') + ' ' + (u.businessName || '')).toLowerCase();
                return hay.indexOf(q) !== -1;
            }
            return true;
        });
        sortUsers();
        currentPage = 1;
        renderTable();
    }

    function sortUsers() {
        var key = currentSort.key;
        var dir = currentSort.dir === 'asc' ? 1 : -1;
        filtered.sort(function (a, b) {
            var va = a[key] || '';
            var vb = b[key] || '';
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
            return String(va).localeCompare(String(vb)) * dir;
        });
    }

    function renderTable() {
        var start = (currentPage - 1) * PAGE_SIZE;
        var page  = filtered.slice(start, start + PAGE_SIZE);

        $usersCount.textContent = filtered.length + ' usuario' + (filtered.length !== 1 ? 's' : '');

        if (page.length === 0) {
            $tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:2.5rem;color:#9494a8;font-size:.9rem;">Sin resultados</td></tr>';
            $pagination.innerHTML = '';
            return;
        }

        var html = '';
        for (var i = 0; i < page.length; i++) {
            try {
                html += userRow(page[i]);
            } catch (err) {
                console.error('[Admin] Row render error for user', page[i], err);
            }
        }
        $tbody.innerHTML = html;
        renderPagination();

        // Bind action buttons
        var btns = $tbody.querySelectorAll('.admin-action-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', (function (uid) {
                return function () { openModal(uid); };
            })(btns[j].getAttribute('data-uid')));
        }
    }

    function parseDate(val) {
        if (!val) return null;
        // Handle Firestore Timestamp objects serialized as {_seconds, _nanoseconds}
        if (typeof val === 'object' && val._seconds) {
            return new Date(val._seconds * 1000);
        }
        var d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }

    function userRow(u) {
        var color    = AVATAR_COLORS[hashCode(u.email || '') % AVATAR_COLORS.length];
        var initials = (u.name || u.email || '?').charAt(0);
        var date     = parseDate(u.createdAt);
        var dateStr  = date ? date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

        var statusCls = 'admin-pill--' + u.status;
        var statusTxt = u.status === 'active' ? 'Activo' : (u.status === 'expired' ? 'Expirado' : 'Gratis');

        var planCls = 'admin-plan-badge--' + (u.planId || 'free');
        var planTxt = u.planName || 'Gratis';

        var botCls = 'admin-bot-badge--' + (u.botStatus || 'off');
        var botTxt = u.botStatus === 'connected' ? 'Conectado'
                   : u.botStatus === 'qr' ? 'Escaneando'
                   : 'Apagado';

        return '<tr>'
            + '<td>'
            +   '<div class="admin-user-cell">'
            +     '<div class="admin-avatar" style="background:' + color + '">' + esc(initials.toUpperCase()) + '</div>'
            +     '<div class="admin-user-cell__info">'
            +       '<span class="admin-user-cell__name">' + esc(u.name || (u.email || '').split('@')[0] || '?') + '</span>'
            +       '<span class="admin-user-cell__email">' + esc(u.email || '') + '</span>'
            +     '</div>'
            +   '</div>'
            + '</td>'
            + '<td><span class="admin-plan-badge ' + planCls + '">' + esc(planTxt) + '</span></td>'
            + '<td>'
            +   '<span class="admin-pill ' + statusCls + '">'
            +     '<span class="admin-pill__dot"></span>' + statusTxt
            +   '</span>'
            + '</td>'
            + '<td style="font-size:.8rem;color:#9494a8;white-space:nowrap">' + dateStr + '</td>'
            + '<td>'
            +   '<span class="admin-bot-badge ' + botCls + '">'
            +     '<span class="admin-bot-badge__dot"></span>' + botTxt
            +   '</span>'
            + '</td>'
            + '<td class="admin-ltv" style="color:#34d399">$' + fmtMoney(u.ltvCentavos || 0) + '</td>'
            + '<td><button class="admin-action-btn" data-uid="' + u.uid + '" title="Acciones">⋯</button></td>'
            + '</tr>';
    }

    // ─── Pagination ──────────────────────────────────────────
    function renderPagination() {
        var totalPages = Math.ceil(filtered.length / PAGE_SIZE);
        if (totalPages <= 1) { $pagination.innerHTML = ''; return; }

        var html = '';
        for (var p = 1; p <= totalPages; p++) {
            html += '<button class="admin-page-btn' + (p === currentPage ? ' admin-page-btn--active' : '')
                  + '" data-page="' + p + '">' + p + '</button>';
        }
        $pagination.innerHTML = html;

        var btns = $pagination.querySelectorAll('.admin-page-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].addEventListener('click', function () {
                currentPage = parseInt(this.getAttribute('data-page'));
                renderTable();
            });
        }
    }

    // ─── Revenue Breakdown ───────────────────────────────────
    function renderRevenue() {
        var counts = { monthly: 0, quarterly: 0, yearly: 0 };
        for (var i = 0; i < allUsers.length; i++) {
            var u = allUsers[i];
            if (u.status === 'active' && u.planId && counts.hasOwnProperty(u.planId)) {
                counts[u.planId]++;
            }
        }

        var plans = [
            { id: 'monthly',   label: 'Mensual',    price: PLAN_PRICES.monthly },
            { id: 'quarterly', label: 'Trimestral', price: PLAN_PRICES.quarterly },
            { id: 'yearly',    label: 'Anual',      price: PLAN_PRICES.yearly }
        ];

        var html = '';
        for (var j = 0; j < plans.length; j++) {
            var p = plans[j];
            var c = counts[p.id];
            var rev = c * p.price;
            html += '<div class="admin-plan-card">'
                  +   '<span class="admin-plan-card__label">' + p.label + '</span>'
                  +   '<span class="admin-plan-card__count">' + c + '</span>'
                  +   '<span class="admin-plan-card__revenue">$' + fmtMoney(rev) + ' MXN</span>'
                  + '</div>';
        }
        $planBreakdown.innerHTML = html;
    }

    // ─── Modal ───────────────────────────────────────────────
    function openModal(uid) {
        var user = null;
        for (var i = 0; i < allUsers.length; i++) {
            if (allUsers[i].uid === uid) { user = allUsers[i]; break; }
        }
        if (!user) return;

        $modalTitle.textContent = 'Acciones — ' + (user.name || (user.email || '').split('@')[0]);
        var html = '<div class="modal-user-info">'
                 + '<strong>' + esc(user.name || (user.email || '').split('@')[0]) + '</strong>'
                 + '<span>' + esc(user.email || '') + '</span>'
                 + '</div>'
                 + '<div class="admin-modal-actions">';

        // Activate buttons per plan
        html += '<button class="modal-btn modal-btn--success" data-action="activate" data-plan="monthly" data-uid="' + uid + '">'
              + '✅ Activar Mensual (1 mes)</button>';
        html += '<button class="modal-btn modal-btn--success" data-action="activate" data-plan="quarterly" data-uid="' + uid + '">'
              + '✅ Activar Trimestral (4 meses)</button>';
        html += '<button class="modal-btn modal-btn--success" data-action="activate" data-plan="yearly" data-uid="' + uid + '">'
              + '✅ Activar Anual (18 meses)</button>';

        // Revoke
        html += '<button class="modal-btn modal-btn--danger" data-action="revoke" data-uid="' + uid + '">'
              + '🚫 Revocar Suscripción</button>';

        // Kill bot
        if (user.botStatus && user.botStatus !== 'off') {
            html += '<button class="modal-btn modal-btn--danger" data-action="kill-bot" data-uid="' + uid + '">'
                  + '💀 Matar Bot</button>';
        }

        html += '</div>';
        $modalBody.innerHTML = html;
        $modalOvl.style.display = '';

        // Bind modal action buttons
        var btns = $modalBody.querySelectorAll('.modal-btn');
        for (var j = 0; j < btns.length; j++) {
            btns[j].addEventListener('click', handleModalAction);
        }
    }

    function closeModal() {
        $modalOvl.style.display = 'none';
        $modalBody.innerHTML = '';
    }

    function handleModalAction(e) {
        var btn    = e.currentTarget;
        var action = btn.getAttribute('data-action');
        var uid    = btn.getAttribute('data-uid');
        var plan   = btn.getAttribute('data-plan');

        btn.disabled = true;
        btn.textContent = 'Procesando...';

        var endpoint, body;
        if (action === 'activate') {
            endpoint = '/api/admin/users/' + uid + '/activate';
            body = JSON.stringify({ planId: plan });
        } else if (action === 'revoke') {
            endpoint = '/api/admin/users/' + uid + '/revoke';
            body = undefined;
        } else if (action === 'kill-bot') {
            endpoint = '/api/admin/users/' + uid + '/kill-bot';
            body = undefined;
        }

        apiCall(endpoint, { method: 'POST', body: body })
            .then(function (res) {
                toast(res.message || 'Listo', 'success');
                closeModal();
                refreshAll();
            })
            .catch(function (err) {
                toast('Error: ' + err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Reintentar';
            });
    }

    $modalClose.addEventListener('click', closeModal);
    $modalOvl.addEventListener('click', function (e) {
        if (e.target === $modalOvl) closeModal();
    });

    // ─── Search & Filter ─────────────────────────────────────
    var searchTimer = null;
    $search.addEventListener('input', function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
            searchQuery = $search.value;
            applyFilters();
        }, 250);
    });

    // Filter buttons
    var filterBtns = document.querySelectorAll('.admin-filter-btn');
    for (var fb = 0; fb < filterBtns.length; fb++) {
        filterBtns[fb].addEventListener('click', function () {
            for (var k = 0; k < filterBtns.length; k++) filterBtns[k].classList.remove('admin-filter-btn--active');
            this.classList.add('admin-filter-btn--active');
            activeFilter = this.getAttribute('data-filter');
            applyFilters();
        });
    }

    // Sort headers
    var sortHeaders = document.querySelectorAll('.admin-table__th--sortable');
    for (var sh = 0; sh < sortHeaders.length; sh++) {
        sortHeaders[sh].addEventListener('click', function () {
            var key = this.getAttribute('data-sort');
            if (currentSort.key === key) {
                currentSort.dir = currentSort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                currentSort = { key: key, dir: 'asc' };
            }
            sortUsers();
            renderTable();
        });
    }

    // ─── Sidebar Navigation (using inline style for reliability) ──
    var navLinks = document.querySelectorAll('.sidebar__link[data-section]');
    for (var nl = 0; nl < navLinks.length; nl++) {
        navLinks[nl].addEventListener('click', function (e) {
            e.preventDefault();
            var sec = this.getAttribute('data-section');

            // Update active link
            for (var x = 0; x < navLinks.length; x++) navLinks[x].classList.remove('sidebar__link--active');
            this.classList.add('sidebar__link--active');

            // Toggle sections using inline style (more reliable than class toggle)
            showSection(sec);
        });
    }

    // ─── Refresh ─────────────────────────────────────────────
    function refreshAll() {
        $refresh.classList.add('refreshing');

        var p1 = apiCall('/api/admin/metrics')
            .then(function (res) { renderMetrics(res.data); })
            .catch(function (err) { console.error('[Admin] Metrics refresh error:', err); });

        var p2 = apiCall('/api/admin/users')
            .then(function (res) {
                allUsers = res.data || [];
                dataLoaded = true;
                applyFilters();
                renderRevenue();
            })
            .catch(function (err) { console.error('[Admin] Users refresh error:', err); });

        Promise.all([p1, p2]).then(function () {
            $refresh.classList.remove('refreshing');
        });
    }

    $refresh.addEventListener('click', refreshAll);

    // Auto-refresh every 60s
    setInterval(refreshAll, 60000);

    // ─── Logout ──────────────────────────────────────────────
    document.getElementById('btn-logout').addEventListener('click', function () {
        auth.signOut().then(function () {
            localStorage.removeItem('botsaas_token');
            localStorage.removeItem('botsaas_user');
            window.location.href = './auth.html';
        });
    });

    // ─── Toast ───────────────────────────────────────────────
    function toast(msg, type) {
        var el = document.createElement('div');
        el.className = 'admin-toast admin-toast--' + (type || 'success');
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, 3500);
    }

    // ─── Utilities ───────────────────────────────────────────
    function fmtMoney(centavos) {
        centavos = centavos || 0;
        var val = (centavos / 100).toFixed(2);
        return val.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function esc(s) {
        if (!s) return '';
        var d = document.createElement('div');
        d.appendChild(document.createTextNode(s));
        return d.innerHTML;
    }

    function hashCode(str) {
        str = str || '';
        var h = 0;
        for (var i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h |= 0;
        }
        return Math.abs(h);
    }

})();
