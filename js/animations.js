/* ================================================================
   KEYORA — Animations Controller (PERFORMANCE-OPTIMIZED)
   - Throttled scroll/mousemove via requestAnimationFrame
   - Auto low-perf detection (device memory, connection, CPU cores)
   - Removed 3D card tilt (biggest FPS killer on mid-range mobiles)
   - IntersectionObserver everywhere, no scroll listeners on cards
   ================================================================ */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  /* ============================================================
     LOW-PERF DETECTION — adds .low-perf class to <html>
     ============================================================ */
  function detectLowPerf() {
    let lowPerf = false;

    // Device memory (Chrome/Android)
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) lowPerf = true;

    // Hardware concurrency (CPU cores)
    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) lowPerf = true;

    // Network connection
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
      if (conn.saveData) lowPerf = true;
      if (conn.effectiveType && /2g|3g/.test(conn.effectiveType)) lowPerf = true;
    }

    // Small screen = probably mobile = trim
    if (window.innerWidth < 768) lowPerf = true;

    if (lowPerf || prefersReducedMotion) {
      document.documentElement.classList.add('low-perf');
    }
    return lowPerf;
  }

  const isLowPerf = detectLowPerf();

  /* ============================================================
     1. PAGE LOADER
     ============================================================ */
  function initPageLoader() {
    const loader = document.querySelector('.page-loader');
    if (!loader) return;
    const hide = () => setTimeout(() => loader.classList.add('hidden'), 300);
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide);
  }

  /* ============================================================
     2. UNIFIED SCROLL HANDLER — one rAF loop for progress + navbar + scroll-top
     ============================================================ */
  function initScrollHandlers() {
    const bar = document.querySelector('.scroll-progress');
    const nav = document.querySelector('.navbar');
    const topBtn = document.querySelector('.scroll-top');
    let ticking = false;
    let lastY = 0;

    const update = () => {
      const y = lastY;
      // Progress bar
      if (bar) {
        const h = document.documentElement;
        const scrolled = y / (h.scrollHeight - h.clientHeight);
        bar.style.width = (scrolled * 100) + '%';
      }
      // Navbar
      if (nav) {
        if (y > 40) nav.classList.add('scrolled');
        else nav.classList.remove('scrolled');
      }
      // Scroll top button
      if (topBtn) {
        if (y > 600) topBtn.classList.add('visible');
        else topBtn.classList.remove('visible');
      }
      ticking = false;
    };

    window.addEventListener('scroll', () => {
      lastY = window.scrollY;
      if (!ticking) {
        requestAnimationFrame(update);
        ticking = true;
      }
    }, { passive: true });

    if (topBtn) {
      topBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    update();
  }

  /* ============================================================
     3. MOUSE SPOTLIGHT — throttled, skipped on low-perf/touch
     ============================================================ */
  function initMouseSpotlight() {
    if (isLowPerf || prefersReducedMotion) return;
    if ('ontouchstart' in window) return;   // skip on touch devices entirely

    const spotlight = document.querySelector('.mouse-spotlight');
    if (!spotlight) return;

    let raf = null;
    let tx = 0, ty = 0;

    const apply = () => {
      spotlight.style.setProperty('--mx', tx + 'px');
      spotlight.style.setProperty('--my', ty + 'px');
      raf = null;
    };

    // Throttle mousemove to ~30fps via rAF
    window.addEventListener('mousemove', (e) => {
      tx = e.clientX; ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
  }

  /* ============================================================
     4. PARTICLES — skip on low-perf/mobile entirely
     ============================================================ */
  function initParticles() {
    if (isLowPerf || prefersReducedMotion) return;

    const container = document.querySelector('.particles');
    if (!container) return;

    const count = 20;  // was 35 — halved
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      const size = 3 + Math.random() * 4;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = (Math.random() * 100) + '%';
      p.style.animationDuration = (14 + Math.random() * 16) + 's';
      p.style.animationDelay = (Math.random() * 15) + 's';
      p.style.setProperty('--drift', (Math.random() * 160 - 80) + 'px');
      frag.appendChild(p);
    }
    container.appendChild(frag);
  }

  /* ============================================================
     5. SCROLL REVEAL — batched IntersectionObserver
     ============================================================ */
  function initScrollReveal() {
    const targets = document.querySelectorAll(
      '[data-animate], .section-header, .steps, .feature-card, .pricing-card, .step, .code-preview, .cta-box'
    );
    if (!('IntersectionObserver' in window)) {
      targets.forEach(el => el.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    targets.forEach(el => io.observe(el));
  }

  /* ============================================================
     6. ANIMATED COUNTERS
     ============================================================ */
  function initCounters() {
    const items = document.querySelectorAll('.trust-value');
    if (!items.length) return;

    const animate = (el) => {
      const raw = el.textContent.trim();
      const match = raw.match(/^([<>]?)([\d.]+)(.*)$/);
      if (!match) return;
      const prefix = match[1] || '';
      const target = parseFloat(match[2]);
      const suffix = match[3] || '';
      const decimals = (match[2].split('.')[1] || '').length;
      const duration = isLowPerf ? 900 : 1400;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = (target * eased).toFixed(decimals);
        el.textContent = prefix + val + suffix;
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = raw;
      };
      requestAnimationFrame(tick);
    };

    if (!('IntersectionObserver' in window)) {
      items.forEach(animate);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animate(entry.target);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });
    items.forEach(el => io.observe(el));
  }

  /* ============================================================
     7. MAGNETIC BUTTONS — desktop only, throttled
     ============================================================ */
  function initMagneticButtons() {
    if (isLowPerf || prefersReducedMotion) return;
    if ('ontouchstart' in window) return;

    const buttons = document.querySelectorAll('.btn-primary');
    buttons.forEach(btn => {
      let raf = null;
      let tx = 0, ty = 0;
      const apply = () => {
        btn.style.transform =
          `translate3d(${tx}px, ${ty}px, 0) translateY(-2px)`;
        raf = null;
      };
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        tx = (e.clientX - rect.left - rect.width / 2) * 0.12;
        ty = (e.clientY - rect.top - rect.height / 2) * 0.2;
        if (!raf) raf = requestAnimationFrame(apply);
      });
      btn.addEventListener('mouseleave', () => {
        tx = 0; ty = 0;
        btn.style.transform = '';
      });
    });
  }

  /* ============================================================
     8. RIPPLE EFFECT
     ============================================================ */
  function initRipple() {
    const buttons = document.querySelectorAll('.btn, button[class*="btn"]');
    buttons.forEach(btn => {
      btn.addEventListener('click', function (e) {
        if (btn.classList.contains('adminkey-close')) return;
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
        const cs = getComputedStyle(btn);
        if (cs.position === 'static') btn.style.position = 'relative';
        if (cs.overflow !== 'hidden') btn.style.overflow = 'hidden';
        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
      });
    });
  }

  /* ============================================================
     9. SMOOTH ANCHOR SCROLL
     ============================================================ */
  function initSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(link => {
      link.addEventListener('click', (e) => {
        const href = link.getAttribute('href');
        if (!href || href === '#') return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        const y = target.getBoundingClientRect().top + window.scrollY - 70;
        window.scrollTo({ top: y, behavior: 'smooth' });
      });
    });
  }

  /* ============================================================
     10. RUNTIME FPS MONITOR — kill effects if FPS drops below 30
     ============================================================ */
  function initFpsWatchdog() {
    if (isLowPerf) return;   // already lite
    let frames = 0;
    let lastCheck = performance.now();
    let lowStreak = 0;

    const check = (now) => {
      frames++;
      if (now - lastCheck >= 1000) {
        const fps = frames * 1000 / (now - lastCheck);
        if (fps < 30) lowStreak++;
        else lowStreak = 0;

        if (lowStreak >= 3) {
          // Sustained low FPS — downgrade to low-perf mode
          document.documentElement.classList.add('low-perf');
          console.info('[KEYORA] Low FPS detected, switching to lite mode');
          return;   // stop monitoring
        }
        frames = 0;
        lastCheck = now;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    initPageLoader();
    initScrollHandlers();
    initMouseSpotlight();
    initParticles();
    initScrollReveal();
    initCounters();
    initMagneticButtons();
    initRipple();
    initSmoothAnchors();
    initFpsWatchdog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
