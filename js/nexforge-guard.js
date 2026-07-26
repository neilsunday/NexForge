/* ============================================================
 * NexForge Guard - Client-side Deterrent Layer
 * ------------------------------------------------------------
 * NOTE: This does NOT truly hide your JavaScript. Any determined
 * user with basic dev skills can bypass this. It is meant to
 * deter casual snoopers and non-technical users only.
 * For real security, keep sensitive logic on your server.
 * ============================================================ */

(function () {
    'use strict';

    const CONFIG = {
        blockRightClick: true,
        blockShortcuts: true,      // F12, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S
        blockTextSelection: false, // set true if you also want to block copy/select
        detectDevTools: true,
        onDevToolsOpen: 'redirect', // 'redirect' | 'blank' | 'warn' | 'nothing'
        redirectUrl: '/',
        warnMessage: 'Developer tools are not allowed on this site.',
        checkIntervalMs: 1000,
        sizeThreshold: 160          // px difference that suggests devtools panel
    };

    if (CONFIG.blockRightClick) {
        document.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            return false;
        }, false);
    }

    if (CONFIG.blockShortcuts) {
        document.addEventListener('keydown', function (e) {
            const key = (e.key || '').toLowerCase();

            if (e.keyCode === 123 || key === 'f12') {
                e.preventDefault();
                return false;
            }


            if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'i') {
                e.preventDefault();
                return false;
            }

            if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'j') {
                e.preventDefault();
                return false;
            }

            if ((e.ctrlKey || e.metaKey) && e.shiftKey && key === 'c') {
                e.preventDefault();
                return false;
            }


            if ((e.ctrlKey || e.metaKey) && key === 'u') {
                e.preventDefault();
                return false;
            }


            if ((e.ctrlKey || e.metaKey) && key === 's') {
                e.preventDefault();
                return false;
            }
        }, false);
    }

    if (CONFIG.blockTextSelection) {
        document.addEventListener('selectstart', function (e) {
            e.preventDefault();
            return false;
        });
        document.addEventListener('copy', function (e) {
            e.preventDefault();
            return false;
        });

        const style = document.createElement('style');
        style.textContent = `
            * {
                -webkit-user-select: none !important;
                -moz-user-select: none !important;
                -ms-user-select: none !important;
                user-select: none !important;
            }
            input, textarea { -webkit-user-select: text !important; user-select: text !important; }
        `;
        document.head.appendChild(style);
    }


    if (CONFIG.detectDevTools) {
        let devtoolsOpen = false;

        function triggerAction() {
            if (devtoolsOpen) return;
            devtoolsOpen = true;

            switch (CONFIG.onDevToolsOpen) {
                case 'redirect':
                    window.location.href = CONFIG.redirectUrl;
                    break;
                case 'blank':
                    document.body.innerHTML = '';
                    document.documentElement.innerHTML =
                        '<div style="font-family:sans-serif;text-align:center;padding:50px;">' +
                        '<h1>Access Denied</h1><p>' + CONFIG.warnMessage + '</p></div>';
                    break;
                case 'warn':
                    alert(CONFIG.warnMessage);
                    devtoolsOpen = false;
                    break;
                case 'nothing':
                default:
                    break;
            }
        }


        setInterval(function () {
            const widthDiff = window.outerWidth - window.innerWidth;
            const heightDiff = window.outerHeight - window.innerHeight;
            if (widthDiff > CONFIG.sizeThreshold || heightDiff > CONFIG.sizeThreshold) {
                triggerAction();
            }
        }, CONFIG.checkIntervalMs);

        setInterval(function () {
            const start = performance.now();

            debugger;
            const elapsed = performance.now() - start;
            if (elapsed > 100) {
                triggerAction();
            }
        }, CONFIG.checkIntervalMs);


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
  
    /*
    if (typeof console !== 'undefined') {
        const noop = function () {};
        ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table', 'dir']
            .forEach(function (m) { console[m] = noop; });
    }
    */
})();
