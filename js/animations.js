/* ================================================================
   KEYORA — High-Level Animations Controller
   Handles: scroll reveals, particles, magnetic buttons, counters,
   3D card tilt, mouse spotlight, scroll progress, page loader.
   ================================================================ */

(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  ).matches;

  /* ============================================================
     1. PAGE LOADER — hide after full load
     ============================================================ */
  function initPageLoader() {
    const loader = document.querySelector('.page-loader');
    if (!loader) return;
    const hide = () => {
      setTimeout(() => loader.classList.add('hidden'), 400);
    };
    if (document.readyState === 'complete') hide();
    else window.addEventListener('load', hide);
  }

  /* ============================================================
     2. SCROLL PROGRESS BAR
     ============================================================ */
  function initScrollProgress() {
    const bar = document.querySelector('.scroll-progress');
    if (!bar) return;
    const update = () => {
      const h = document.documentElement;
      const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight);
      bar.style.width = (scrolled * 100) + '%';
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ============================================================
     3. NAVBAR SCROLL STATE
     ============================================================ */
  function initNavbarScroll() {
    const nav = document.querySelector('.navbar');
    if (!nav) return;
    const update = () => {
      if (window.scrollY > 40) nav.classList.add('scrolled');
      else nav.classList.remove('scrolled');
    };
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ============================================================
     4. MOUSE SPOTLIGHT — follows cursor globally
     ============================================================ */
  function initMouseSpotlight() {
    if (prefersReducedMotion) return;
    const spotlight = document.querySelector('.mouse-spotlight');
    if (!spotlight) return;
    let raf = null;
    let tx = window.innerWidth / 2, ty = window.innerHeight / 2;
    const apply = () => {
      spotlight.style.setProperty('--mx', tx + 'px');
      spotlight.style.setProperty('--my', ty + 'px');
      raf = null;
    };
    window.addEventListener('mousemove', (e) => {
      tx = e.clientX; ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    }, { passive: true });
  }

  /* ============================================================
     5. FLOATING PARTICLES — spawn in hero
     ============================================================ */
  function initParticles() {
    if (prefersReducedMotion) return;
    const container = document.querySelector('.particles');
    if (!container) return;
    const count = window.innerWidth < 768 ? 15 : 35;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      p.className = 'particle';
      const size = 3 + Math.random() * 5;
      p.style.width = size + 'px';
      p.style.height = size + 'px';
      p.style.left = (Math.random() * 100) + '%';
      p.style.animationDuration = (12 + Math.random() * 18) + 's';
      p.style.animationDelay = (Math.random() * 15) + 's';
      p.style.setProperty('--drift', (Math.random() * 200 - 100) + 'px');
      p.style.opacity = 0.3 + Math.random() * 0.5;
      container.appendChild(p);
    }
  }

  /* ============================================================
     6. SCROLL REVEAL — IntersectionObserver
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
    }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });
    targets.forEach(el => io.observe(el));
  }

  /* ============================================================
     7. ANIMATED COUNTERS — trust bar metrics
     ============================================================ */
  function initCounters() {
    const items = document.querySelectorAll('.trust-value');
    if (!items.length) return;

    const animate = (el) => {
      const raw = el.textContent.trim();
      // Parse: number + optional prefix/suffix
      const match = raw.match(/^([<>]?)([\d.]+)(.*)$/);
      if (!match) return;
      const prefix = match[1] || '';
      const target = parseFloat(match[2]);
      const suffix = match[3] || '';
      const decimals = (match[2].split('.')[1] || '').length;
      const duration = 1600;
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        const val = (target * eased).toFixed(decimals);
        el.textContent = prefix + val + suffix;
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = raw; // restore exact original
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
     8. 3D CARD TILT — mouse parallax on feature cards
     ============================================================ */
  function initCardTilt() {
    if (prefersReducedMotion) return;
    const cards = document.querySelectorAll('.feature-card');
    cards.forEach(card => {
      let raf = null;
      let mx = 50, my = 50, rx = 0, ry = 0;

      const apply = () => {
        card.style.setProperty('--card-mx', mx + '%');
        card.style.setProperty('--card-my', my + '%');
        card.style.transform =
          `translateY(-6px) perspective(1000px) rotateX(${rx}deg) rotateY(${ry}deg)`;
        raf = null;
      };

      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        mx = px * 100; my = py * 100;
        ry = (px - 0.5) * 10;
        rx = -(py - 0.5) * 10;
        if (!raf) raf = requestAnimationFrame(apply);
      });

      card.addEventListener('mouseleave', () => {
        rx = 0; ry = 0; mx = 50; my = 50;
        card.style.transform = '';
      });
    });
  }

  /* ============================================================
     9. MAGNETIC BUTTONS — subtle attraction on hover
     ============================================================ */
  function initMagneticButtons() {
    if (prefersReducedMotion) return;
    const buttons = document.querySelectorAll('.btn-primary, .btn-lg');
    buttons.forEach(btn => {
      btn.addEventListener('mousemove', (e) => {
        const rect = btn.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        btn.style.transform =
          `translate(${x * 0.15}px, ${y * 0.25}px) translateY(-3px) scale(1.03)`;
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.transform = '';
      });
    });
  }

  /* ============================================================
     10. BUTTON RIPPLE EFFECT
     ============================================================ */
  function initRipple() {
    const buttons = document.querySelectorAll('.btn, button[class*="btn"]');
    buttons.forEach(btn => {
      btn.addEventListener('click', function (e) {
        // Don't ripple modal / admin key buttons
        if (btn.classList.contains('adminkey-close')) return;
        const rect = btn.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement('span');
        ripple.className = 'btn-ripple';
        ripple.style.width = ripple.style.height = size + 'px';
        ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
        ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';

        // Ensure the button can host absolutely positioned children
        const cs = getComputedStyle(btn);
        if (cs.position === 'static') btn.style.position = 'relative';
        if (cs.overflow !== 'hidden') btn.style.overflow = 'hidden';

        btn.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);
      });
    });
  }

  /* ============================================================
     11. SCROLL-TO-TOP BUTTON
     ============================================================ */
  function initScrollTop() {
    const btn = document.querySelector('.scroll-top');
    if (!btn) return;
    const update = () => {
      if (window.scrollY > 600) btn.classList.add('visible');
      else btn.classList.remove('visible');
    };
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  /* ============================================================
     12. SMOOTH ANCHOR SCROLL
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
     13. TYPEWRITER — for optional [data-typewriter] elements
     ============================================================ */
  function initTypewriter() {
    if (prefersReducedMotion) return;
    const targets = document.querySelectorAll('[data-typewriter]');
    targets.forEach(el => {
      const text = el.textContent;
      el.textContent = '';
      el.style.borderRight = '2px solid #ec4899';
      let i = 0;
      const speed = 45;
      const step = () => {
        if (i < text.length) {
          el.textContent += text.charAt(i++);
          setTimeout(step, speed);
        } else {
          setTimeout(() => { el.style.borderRight = 'none'; }, 800);
        }
      };
      setTimeout(step, 400);
    });
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function boot() {
    initPageLoader();
    initScrollProgress();
    initNavbarScroll();
    initMouseSpotlight();
    initParticles();
    initScrollReveal();
    initCounters();
    initCardTilt();
    initMagneticButtons();
    initRipple();
    initScrollTop();
    initSmoothAnchors();
    initTypewriter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
