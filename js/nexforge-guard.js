/* ============================================================
 * NexForge Guard v3 - Safe Mobile Version (No False Triggers)
 * ------------------------------------------------------------
 * Prioritizes usability. Removes aggressive detection methods
 * that cause refresh loops on mobile.
 * ============================================================ */

(function () {
    'use strict';

    // ---------- CONFIG ----------
    const CONFIG = {
        blockRightClick: true,
        blockLongPress: true,
        blockShortcuts: true,
        blockImageDrag: true,
        blockTextSelection: false,

        // Detection - all SAFE methods only (no false triggers)
        detectDevToolsSafe: true,
        onDevToolsOpen: 'blank',        // 'blank' | 'warn' | 'nothing' (NOT 'redirect')

        warnMessage: 'Developer tools detected. Please close them to continue.',
        stripConsoleInProduction: true  // hides all console.log output from users
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
        const style = document.createElement('style');
        style.textContent = `
            img, a, canvas, video {
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

    // ---------- 4. BLOCK IMAGE DRAG ----------
    if (CONFIG.blockImageDrag) {
        document.addEventListener('dragstart', function (e) {
            if (e.target.tagName === 'IMG') {
                e.preventDefault();
                return false;
            }
        });
    }

    // ---------- 5. SAFE DEV TOOLS DETECTION ----------
    // Uses ONLY the console getter trap - the only method that
    // doesn't cause false triggers on mobile.
    if (CONFIG.detectDevToolsSafe) {
        let triggered = false;

        function triggerAction() {
            if (triggered) return;
            triggered = true;

            switch (CONFIG.onDevToolsOpen) {
                case 'blank':
                    try {
                        document.documentElement.innerHTML =
                            '<div style="font-family:sans-serif;text-align:center;padding:50px;background:#0f0f11;color:#fff;min-height:100vh;">' +
                            '<h1>Access Denied</h1><p>' + CONFIG.warnMessage + '</p></div>';
                    } catch (_) {}
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

        // Console getter trap - only fires when devtools ACTUALLY tries to render
        // Safe on both desktop and mobile - no CPU/timing dependency
        const trap = /./;
        trap.toString = function () {
            triggerAction();
            return '';
        };

        // Run once every 3 seconds - low overhead
        setInterval(function () {
            try {
                console.log(trap);
                console.clear();
            } catch (_) {}
        }, 3000);
    }

    // ---------- 6. STRIP CONSOLE OUTPUT IN PRODUCTION ----------
    if (CONFIG.stripConsoleInProduction && typeof console !== 'undefined') {
        const noop = function () {};
        ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir']
            .forEach(function (m) {
                try { console[m] = noop; } catch (_) {}
            });
    }
})();
