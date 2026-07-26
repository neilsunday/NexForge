/* ============================================================
 * NexForge Guard v2 - Mobile-Aware Deterrent Layer
 * ------------------------------------------------------------
 * NOTE: This does NOT truly hide your JavaScript. Any determined
 * user with basic dev skills can bypass this. It is meant to
 * deter casual snoopers only.
 * For real security, keep sensitive logic on your server + RLS.
 * ============================================================ */

(function () {
    'use strict';

    // ---------- CONFIG ----------
    const CONFIG = {
        blockRightClick: true,
        blockLongPress: true,           // mobile long-press context menu
        blockShortcuts: true,           // F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S
        blockTextSelection: false,
        blockImageDrag: true,           // prevent easy image save on desktop
        detectDevTools: true,
        useSizeDetection: false,        // OFF by default (causes false triggers on mobile)
        useDebuggerTrap: true,          // catches undocked devtools on both
        useConsoleTrap: true,           // catches console access
        detectMobileDesktopMode: true,  // stricter check when mobile is in desktop mode
        onDevToolsOpen: 'redirect',     // 'redirect' | 'blank' | 'warn' | 'nothing'
        redirectUrl: '/',
        warnMessage: 'Developer tools are not allowed on this site.',
        checkIntervalMs: 1500,
        stripConsoleInProduction: false // set true to disable console.log in prod
    };

    // ---------- DETECT ENVIRONMENT ----------
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
        .test(navigator.userAgent);
    const isTouchDevice = ('ontouchstart' in window) ||
        (navigator.maxTouchPoints > 0);

    // ---------- 1. BLOCK RIGHT CLICK ----------
    if (CONFIG.blockRightClick) {
        document.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            return false;
        }, false);
    }

    // ---------- 2. BLOCK MOBILE LONG-PRESS ----------
    if (CONFIG.blockLongPress && isTouchDevice) {
        let longPressTimer = null;
        document.addEventListener('touchstart', function (e) {
            // Only block long-press on non-input elements
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;

            longPressTimer = setTimeout(function () {
                if (e.cancelable) e.preventDefault();
            }, 500);
        }, { passive: false });

        document.addEventListener('touchend', function () {
            if (longPressTimer) clearTimeout(longPressTimer);
        });

        document.addEventListener('touchmove', function () {
            if (longPressTimer) clearTimeout(longPressTimer);
        });

        // Block iOS Safari's callout menu
        const style = document.createElement('style');
        style.textContent = `
            img, a, canvas {
                -webkit-touch-callout: none !important;
                -webkit-user-drag: none !important;
            }
        `;
        document.head.appendChild(style);
    }

    // ---------- 3. BLOCK KEYBOARD SHORTCUTS ----------
    if (CONFIG.blockShortcuts) {
        document.addEventListener('keydown', function (e) {
            const key = (e.key || '').toLowerCase();

            if (e.keyCode === 123 || key === 'f12') { e.preventDefault(); return false; }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'i') { e.preventDefault(); return false; }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'j') { e.preventDefault(); return false; }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'c') { e.preventDefault(); return false; }
            if ((e.ctrlKey || e.metaKey) && key === 'u') { e.preventDefault(); return false; }
            if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); return false; }
        }, false);
    }

    // ---------- 4. BLOCK IMAGE DRAG (desktop image save) ----------
    if (CONFIG.blockImageDrag) {
        document.addEventListener('dragstart', function (e) {
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                return false;
            }
        });
    }

    // ---------- 5. BLOCK TEXT SELECTION (optional) ----------
    if (CONFIG.blockTextSelection) {
        document.addEventListener('selectstart', function (e) {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            e.preventDefault();
            return false;
        });
        document.addEventListener('copy', function (e) {
            const tag = (e.target.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea') return;
            e.preventDefault();
            return false;
        });

        const style = document.createElement('style');
        style.textContent = `
            body { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }
            input, textarea { -webkit-user-select: text !important; user-select: text !important; }
        `;
        document.head.appendChild(style);
    }

    // ---------- 6. DEV TOOLS DETECTION ----------
    if (CONFIG.detectDevTools) {
        let triggered = false;

        function triggerAction() {
            if (triggered) return;
            triggered = true;

            switch (CONFIG.onDevToolsOpen) {
                case 'redirect':
                    window.location.href = CONFIG.redirectUrl;
                    break;
                case 'blank':
                    document.documentElement.innerHTML =
                        '<div style="font-family:sans-serif;text-align:center;padding:50px;background:#0f0f11;color:#fff;min-height:100vh;">' +
                        '<h1>Access Denied</h1><p>' + CONFIG.warnMessage + '</p></div>';
                    break;
                case 'warn':
                    alert(CONFIG.warnMessage);
                    triggered = false;
                    break;
                case 'nothing':
                default:
                    break;
            }
        }

        // Method A: window size heuristic
        // DISABLED by default on mobile (false triggers on rotate/scroll/keyboard)
        // Only enabled if useSizeDetection is true AND not on mobile
        if (CONFIG.useSizeDetection && !isMobile) {
            setInterval(function () {
                const widthDiff = window.outerWidth - window.innerWidth;
                const heightDiff = window.outerHeight - window.innerHeight;
                if (widthDiff > 160 || heightDiff > 160) {
                    triggerAction();
                }
            }, CONFIG.checkIntervalMs);
        }

        // Method B: debugger timing trick â€” works on both desktop and mobile
        if (CONFIG.useDebuggerTrap) {
            setInterval(function () {
                const start = performance.now();
                // eslint-disable-next-line no-debugger
                debugger;
                const elapsed = performance.now() - start;
                if (elapsed > 100) {
                    triggerAction();
                }
            }, CONFIG.checkIntervalMs);
        }

        // Method C: console getter trap â€” fires when devtools tries to render
        if (CONFIG.useConsoleTrap) {
            const trap = /./;
            trap.toString = function () {
                triggerAction();
                return '';
            };
            setInterval(function () {
                console.log(trap);
                console.clear();
            }, CONFIG.checkIntervalMs * 2);
        }

        // Method D: detect mobile browsers in "desktop mode"
        // Users flip mobile browsers to desktop mode specifically to inspect
        if (CONFIG.detectMobileDesktopMode && isTouchDevice) {
            // Touch device claiming to be desktop = suspicious
            const claimsDesktop = !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
            if (claimsDesktop && navigator.maxTouchPoints > 0) {
                // Extra scrutiny: enable size detection for this session
                setInterval(function () {
                    const widthDiff = window.outerWidth - window.innerWidth;
                    const heightDiff = window.outerHeight - window.innerHeight;
                    if (widthDiff > 160 || heightDiff > 160) {
                        triggerAction();
                    }
                }, CONFIG.checkIntervalMs);
            }
        }
    }

    // ---------- 7. STRIP CONSOLE OUTPUT IN PRODUCTION ----------
    if (CONFIG.stripConsoleInProduction && typeof console !== 'undefined') {
        const noop = function () {};
        ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir']
            .forEach(function (m) { console[m] = noop; });
    }
})();
