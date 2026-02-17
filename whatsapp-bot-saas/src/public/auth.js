/* ============================================================
   WhatsApp Bot SaaS — Firebase Auth (auth.js)
   Handles: login, register, Google sign-in, redirect to dashboard
   ============================================================ */
(function () {
    'use strict';

    // ─── Firebase Config ─────────────────────────────────────
    const firebaseConfig = {
        apiKey: "AIzaSyCcBN4HTgTdYLJR4VfCnAs7hlWWD-VnHb8",
        authDomain: "chatbot-1d169.firebaseapp.com",
        projectId: "chatbot-1d169",
        storageBucket: "chatbot-1d169.firebasestorage.app",
        messagingSenderId: "376839837560",
        appId: "1:376839837560:web:0af7208dc4f81b487f9a8d",
        measurementId: "G-84E2CGRD78"
    };

    firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const googleProvider = new firebase.auth.GoogleAuthProvider();

    // ─── If already logged in → dashboard ────────────────────
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            const token = await user.getIdToken();
            localStorage.setItem('botsaas_token', token);
            localStorage.setItem('botsaas_user', JSON.stringify({
                uid: user.uid,
                name: user.displayName || '',
                email: user.email,
                photo: user.photoURL || ''
            }));
            window.location.href = './index.html';
        }
    });

    // ─── DOM ─────────────────────────────────────────────────
    const loginCard      = document.getElementById('login-card');
    const registerCard   = document.getElementById('register-card');
    const loginForm      = document.getElementById('login-form');
    const registerForm   = document.getElementById('register-form');
    const loginError     = document.getElementById('login-error');
    const registerError  = document.getElementById('register-error');

    // ─── Toggle cards ────────────────────────────────────────
    document.getElementById('show-register').addEventListener('click', (e) => {
        e.preventDefault();
        loginCard.classList.add('auth-card--hidden');
        registerCard.classList.remove('auth-card--hidden');
        registerCard.style.animation = 'none';
        void registerCard.offsetHeight;
        registerCard.style.animation = 'authSlideUp .4s ease';
        loginError.textContent = '';
    });

    document.getElementById('show-login').addEventListener('click', (e) => {
        e.preventDefault();
        registerCard.classList.add('auth-card--hidden');
        loginCard.classList.remove('auth-card--hidden');
        loginCard.style.animation = 'none';
        void loginCard.offsetHeight;
        loginCard.style.animation = 'authSlideUp .4s ease';
        registerError.textContent = '';
    });

    // ─── Toggle password visibility ──────────────────────────
    document.querySelectorAll('.auth-form__eye').forEach((btn) => {
        btn.addEventListener('click', () => {
            const input = document.getElementById(btn.dataset.target);
            const isPass = input.type === 'password';
            input.type = isPass ? 'text' : 'password';
            btn.innerHTML = isPass
                ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
                : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
        });
    });

    // ─── Firebase Error Translation ──────────────────────────
    function translateError(code) {
        const map = {
            'auth/email-already-in-use':  'Ya existe una cuenta con este correo.',
            'auth/invalid-email':         'Correo electrónico inválido.',
            'auth/weak-password':         'La contraseña debe tener al menos 6 caracteres.',
            'auth/user-not-found':        'No existe una cuenta con este correo.',
            'auth/wrong-password':         'Contraseña incorrecta.',
            'auth/invalid-credential':    'Credenciales incorrectas.',
            'auth/too-many-requests':     'Demasiados intentos. Espera unos minutos.',
            'auth/popup-closed-by-user':  'Se cerró la ventana de Google.',
            'auth/network-request-failed':'Error de red. Verifica tu conexión.'
        };
        return map[code] || 'Error inesperado. Inténtalo de nuevo.';
    }

    // ─── Set loading state on button ─────────────────────────
    function setLoading(btn, loading) {
        btn.disabled = loading;
        if (loading) {
            btn.dataset.originalText = btn.textContent;
            btn.classList.add('btn--loading');
        } else {
            btn.classList.remove('btn--loading');
        }
    }

    // ─── Register: save profile to server after Firebase ─────
    async function saveProfileToServer(user, extraData = {}) {
        try {
            const token = await user.getIdToken();
            await fetch('/api/auth/profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: extraData.name || user.displayName || '',
                    businessName: extraData.businessName || '',
                    email: user.email
                })
            });
        } catch {
            // Server might not be running yet — profile will be created on next request
        }
    }

    // ─── Login with Email/Password ───────────────────────────
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';

        const email    = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const btn      = document.getElementById('btn-login');

        setLoading(btn, true);

        try {
            await auth.signInWithEmailAndPassword(email, password);
            // onAuthStateChanged will redirect
        } catch (err) {
            loginError.textContent = translateError(err.code);
            setLoading(btn, false);
        }
    });

    // ─── Register with Email/Password ────────────────────────
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerError.textContent = '';

        const name         = document.getElementById('reg-name').value.trim();
        const businessName = document.getElementById('reg-business').value.trim();
        const email        = document.getElementById('reg-email').value.trim();
        const password     = document.getElementById('reg-password').value;
        const password2    = document.getElementById('reg-password2').value;
        const btn          = document.getElementById('btn-register');

        if (password !== password2) {
            registerError.textContent = 'Las contraseñas no coinciden.';
            return;
        }

        setLoading(btn, true);

        try {
            const cred = await auth.createUserWithEmailAndPassword(email, password);

            // Update Firebase profile
            await cred.user.updateProfile({ displayName: name });

            // Save extra data to our server
            await saveProfileToServer(cred.user, { name, businessName });

            // Store locally
            localStorage.setItem('botsaas_user', JSON.stringify({
                uid: cred.user.uid,
                name,
                email,
                businessName,
                photo: ''
            }));

            // onAuthStateChanged will redirect
        } catch (err) {
            registerError.textContent = translateError(err.code);
            setLoading(btn, false);
        }
    });

    // ─── Google Sign-In ──────────────────────────────────────
    async function signInWithGoogle() {
        try {
            const result = await auth.signInWithPopup(googleProvider);
            const user = result.user;
            const isNew = result.additionalUserInfo?.isNewUser;

            if (isNew) {
                await saveProfileToServer(user, {
                    name: user.displayName,
                    businessName: ''
                });
            }
            // onAuthStateChanged will redirect
        } catch (err) {
            // Show error on whichever card is visible
            const visibleError = loginCard.classList.contains('auth-card--hidden')
                ? registerError : loginError;
            visibleError.textContent = translateError(err.code);
        }
    }

    document.getElementById('btn-google-login').addEventListener('click', signInWithGoogle);
    document.getElementById('btn-google-register').addEventListener('click', signInWithGoogle);

})();
