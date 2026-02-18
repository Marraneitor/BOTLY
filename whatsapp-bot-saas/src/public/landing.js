/**
 * Botly — Landing Page JavaScript
 * Preloader, navbar scroll, mobile menu, chat animation, scroll reveal
 */
(function() {
    'use strict';

    // ─── Page Preloader ──────────────────────────────────
    var preloader = document.getElementById('preloader');
    if (preloader) {
        window.addEventListener('load', function() {
            setTimeout(function() {
                preloader.classList.add('preloader--hidden');
            }, 300);
        });
        // Safety net — hide after 3s even if load event fires late
        setTimeout(function() {
            if (preloader) preloader.classList.add('preloader--hidden');
        }, 3000);
    }

    // ─── Navbar scroll effect ────────────────────────────
    var nav = document.getElementById('nav');
    var lastScroll = 0;

    function handleScroll() {
        var scrollY = window.pageYOffset || document.documentElement.scrollTop;
        if (scrollY > 40) {
            nav.classList.add('nav--scrolled');
        } else {
            nav.classList.remove('nav--scrolled');
        }
        lastScroll = scrollY;
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // initial check

    // ─── Mobile hamburger menu ───────────────────────────
    var hamburger = document.getElementById('nav-hamburger');
    var navLinks = document.getElementById('nav-links');

    if (hamburger && navLinks) {
        hamburger.addEventListener('click', function() {
            navLinks.classList.toggle('nav__links--open');
            hamburger.classList.toggle('nav__hamburger--open');
        });

        // Close menu when a link is clicked
        var links = navLinks.querySelectorAll('.nav__link, .nav__cta');
        for (var i = 0; i < links.length; i++) {
            links[i].addEventListener('click', function() {
                navLinks.classList.remove('nav__links--open');
                hamburger.classList.remove('nav__hamburger--open');
            });
        }

        // Close on outside click
        document.addEventListener('click', function(e) {
            if (navLinks.classList.contains('nav__links--open') &&
                !navLinks.contains(e.target) && !hamburger.contains(e.target)) {
                navLinks.classList.remove('nav__links--open');
                hamburger.classList.remove('nav__hamburger--open');
            }
        });
    }

    // ─── Chat message animation (hero mockup) ────────────
    var chatMsgs = document.querySelectorAll('.hero__msg');
    if (chatMsgs.length > 0) {
        chatMsgs.forEach(function(msg, idx) {
            var delay = parseFloat(msg.getAttribute('data-delay') || idx) * 0.6 + 0.8;
            msg.style.animationDelay = delay + 's';
        });
    }

    // ─── Scroll Reveal ───────────────────────────────────
    // Add .reveal class to all sections and cards for staggered entrance
    var revealSelectors = [
        '.problem-card', '.step-card', '.testimonial-card',
        '.pricing-card', '.faq-item', '.video-container',
        '.section__header', '.cta-section__inner',
        '.stats-bar__item'
    ];

    var revealElements = [];
    revealSelectors.forEach(function(selector) {
        var els = document.querySelectorAll(selector);
        for (var i = 0; i < els.length; i++) {
            els[i].classList.add('reveal');
            revealElements.push(els[i]);
        }
    });

    function checkReveal() {
        var windowHeight = window.innerHeight;
        revealElements.forEach(function(el) {
            if (el.classList.contains('revealed')) return;
            var rect = el.getBoundingClientRect();
            if (rect.top < windowHeight - 80) {
                el.classList.add('revealed');
            }
        });
    }

    window.addEventListener('scroll', checkReveal, { passive: true });
    // Check on load (elements might already be in view)
    setTimeout(checkReveal, 100);
    setTimeout(checkReveal, 500);

    // ─── Smooth scroll for anchor links ──────────────────

    // ─── Counter animation ───────────────────────────────
    var counterElements = document.querySelectorAll('.stats-bar__number[data-target]');
    var countersAnimated = false;

    function animateCounters() {
        if (countersAnimated) return;
        var statsBar = document.querySelector('.stats-bar');
        if (!statsBar) return;
        var rect = statsBar.getBoundingClientRect();
        if (rect.top < window.innerHeight - 60) {
            countersAnimated = true;
            counterElements.forEach(function(el) {
                var target = parseInt(el.getAttribute('data-target'), 10);
                var duration = 1800;
                var start = 0;
                var startTime = null;

                function step(timestamp) {
                    if (!startTime) startTime = timestamp;
                    var progress = Math.min((timestamp - startTime) / duration, 1);
                    // easeOutQuart for natural deceleration
                    var ease = 1 - Math.pow(1 - progress, 4);
                    var current = Math.floor(ease * target);
                    el.textContent = current.toLocaleString('es-MX');
                    if (progress < 1) {
                        requestAnimationFrame(step);
                    } else {
                        el.textContent = target.toLocaleString('es-MX');
                    }
                }
                requestAnimationFrame(step);
            });
        }
    }

    window.addEventListener('scroll', animateCounters, { passive: true });
    setTimeout(animateCounters, 600);

    // ─── Smooth scroll for anchor links ──────────────────
    var anchorLinks = document.querySelectorAll('a[href^="#"]');
    for (var j = 0; j < anchorLinks.length; j++) {
        anchorLinks[j].addEventListener('click', function(e) {
            var href = this.getAttribute('href');
            if (href === '#') return;
            var target = document.querySelector(href);
            if (target) {
                e.preventDefault();
                var offsetTop = target.getBoundingClientRect().top + window.pageYOffset - 80;
                window.scrollTo({ top: offsetTop, behavior: 'smooth' });
            }
        });
    }

    // ─── Redirect logged-in users to dashboard ───────────
    // If user already has a token, offer them to go to dashboard
    var token = localStorage.getItem('botsaas_token');
    if (token) {
        var loginLink = document.querySelector('.nav__link--login');
        if (loginLink) {
            loginLink.textContent = 'Ir al Dashboard';
            loginLink.href = '/dashboard';
        }
        // Hide the register CTA and show dashboard
        var ctaLink = document.querySelector('.nav__cta');
        if (ctaLink) {
            ctaLink.textContent = 'Dashboard';
            ctaLink.href = '/dashboard';
        }
    }

})();
