// ==UserScript==
// @name         终极弹窗广告拦截器 (底层冻结+透明层粉碎)
// @namespace    http://tampermonkey.net/
// @version      0.1.7
// @description  暴力拦截流氓弹窗、粉碎全屏透明广告层、冻结 window.open。支持分站独立开启（默认关闭）。
// @author       Tampermonkey Script Expert
// @match        *://*/*
// @match        <all_urls>
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function() {
    'use strict';

    // 智能提取主域名（处理子域名，使其对整个网站及其所有分站生效）
    function getBaseDomain(hostname) {
        const parts = hostname.split('.');
        if (parts.length <= 2) return hostname;
        const secondLevel = parts[parts.length - 2];
        // 兼容处理常见的双后缀域名，如 .com.cn, .co.uk 等
        if (['com', 'net', 'org', 'edu', 'gov', 'co', 'ac'].includes(secondLevel)) {
            return parts.slice(-3).join('.');
        }
        return parts.slice(-2).join('.');
    }

    // 获取当前网站的主域名
    const currentHostname = location.hostname || "local_environment";
    const baseDomain = getBaseDomain(currentHostname);
    const storageKey = `defense_enabled_${baseDomain}`;

    // 获取当前站点的开启状态，默认值设为 false（全局默认关闭）
    const isEnabled = GM_getValue(storageKey, false);

    // 注册油猴原生菜单命令，允许用户在插件面板中快速手动切换
    GM_registerMenuCommand(isEnabled ? `🔴 停用 [${baseDomain}] 全站拦截` : `🟢 启用 [${baseDomain}] 全站拦截`, () => {
        GM_setValue(storageKey, !isEnabled);
        const statusStr = !isEnabled ? "启用" : "停用";
        if (confirm(`已${statusStr}对主站 ${baseDomain} 及其所有分站的广告拦截功能。\n需要刷新页面以应用更改，是否立即刷新？`)) {
            location.reload();
        }
    });

    // 如果该站点未启用，则完全静默退出，不作任何干预
    if (!isEnabled) {
        console.log(`[终极防御系统] 主站 (${baseDomain}) 拦截默认关闭。如遇流氓弹窗，请手动通过油猴菜单开启。`);
        return;
    }

    // ==========================================
    // 核心注入函数：将所有拦截代码放入此处
    // 目的：突破油猴沙盒，直接在页面的原生 Window 对象中挂载防御逻辑
    // ==========================================
    function injectCoreLogic() {
        console.log("[终极防御系统] 核心引擎已在 document-start 阶段原生注入，已开启最高权限");

        // --- 核心辅助：原生环境内的跨站识别系统 ---
        function getDomain(hostname) {
            const parts = hostname.split('.');
            if (parts.length <= 2) return hostname;
            const secondLevel = parts[parts.length - 2];
            if (['com', 'net', 'org', 'edu', 'gov', 'co', 'ac'].includes(secondLevel)) {
                return parts.slice(-3).join('.');
            }
            return parts.slice(-2).join('.');
        }

        const currentBaseDomain = getDomain(location.hostname || "local_environment");

        function isCrossDomain(urlStr) {
            if (!urlStr) return false;
            try {
                const targetUrl = new URL(urlStr, location.href);
                // 仅校验 http/https 协议，放行 javascript:, mailto: 等
                if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') return false;
                return getDomain(targetUrl.hostname) !== currentBaseDomain;
            } catch(e) {
                return false; // 解析失败的畸形 URL 暂不当做跨域处理
            }
        }

        // --- 1. 底层 API 绝对冻结 ---
        const originalWindowOpen = window.open;
        const hijackedOpen = function(url, target, features) {
            const targetUrl = url || 'about:blank';

            // 无论目标窗口是什么(_blank 或 _self)，只要跳转到第三方主域名，一律掐死！
            if (isCrossDomain(targetUrl)) {
                console.warn(`[终极防御系统] 成功物理隔离跨站重定向/弹窗 -> ${targetUrl}`);
                return new Proxy({}, {
                    get: function(t, prop) {
                        if (prop === 'closed') return true;
                        return function() {};
                    }
                });
            }

            // 若属于同站内跳转，则允许当前页面的正常加载
            if (target === '_self' || target === '_top' || target === '_parent') {
                return originalWindowOpen.apply(this, arguments);
            }

            // 同站新窗口也提示并接管
            console.warn(`[终极防御系统] 成功拦截同站未知的 window.open 弹窗 -> ${targetUrl}`);
            return new Proxy({}, {
                get: function(t, prop) {
                    if (prop === 'closed') return true;
                    return function() {};
                }
            });
        };

        try {
            Object.defineProperty(window, 'open', {
                value: hijackedOpen,
                configurable: false,
                writable: false
            });
        } catch (e) {
            window.open = hijackedOpen;
        }

        // --- 2. 动态生成的 a.click() 拦截 ---
        const originalAnchorClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function() {
            const target = this.getAttribute('target');
            const href = this.href;

            if ((target === '_blank' || !target) && !document.contains(this)) {
                console.warn(`[终极防御系统] 成功拦截幽灵节点 a.click() -> ${href}`);
                return; // 掐断动作
            }
            return originalAnchorClick.apply(this, arguments);
        };

        // --- 3. 透明遮罩层粉碎机 (MutationObserver) ---
        function isSuspiciousOverlay(node) {
            if (node.nodeType !== Node.ELEMENT_NODE) return false;

            const style = window.getComputedStyle(node);
            const zIndex = parseInt(style.zIndex, 10);

            // 绝对/固定定位，层级极高
            if ((style.position === 'absolute' || style.position === 'fixed') &&
                !isNaN(zIndex) && zIndex > 9999) {

                const rect = node.getBoundingClientRect();
                const coversWidth = rect.width >= window.innerWidth * 0.8;
                const coversHeight = rect.height >= window.innerHeight * 0.8;

                if (coversWidth && coversHeight) {
                    if (style.opacity < 0.1 || style.backgroundColor === 'rgba(0, 0, 0, 0)' || style.backgroundColor === 'transparent') {
                        return true;
                    }
                }
            }
            return false;
        }

        const observer = new MutationObserver((mutations) => {
            for (let mutation of mutations) {
                for (let node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (isSuspiciousOverlay(node)) {
                            console.warn('[终极防御系统] 发现并粉碎全屏透明点击陷阱(Overlay)!', node);
                            node.remove(); // 直接抹杀
                            continue;
                        }

                        if (node.tagName === 'IFRAME') {
                            try {
                                Object.defineProperty(node.contentWindow, 'open', {
                                    value: hijackedOpen,
                                    configurable: false,
                                    writable: false
                                });
                            } catch(e) {}
                        }
                    }
                }
            }
        });

        const startObserver = () => {
            if (document.documentElement) {
                observer.observe(document.documentElement, {
                    childList: true,
                    subtree: true
                });
            } else {
                requestAnimationFrame(startObserver);
            }
        };
        startObserver();

        // --- 4. 全局点击事件极度净化 ---
        document.addEventListener('click', function(event) {
            let target = event.target;

            while (target && target.tagName !== 'A' && target !== document.body) {
                target = target.parentElement;
            }

            if (target && target.tagName === 'A') {
                const href = target.href;
                // 不管是不是 _blank，只要它的跳转目标是第三方主域名，统统拦截！
                if (isCrossDomain(href)) {
                    event.preventDefault();
                    event.stopPropagation();
                    console.warn(`[终极防御系统] 拦截到跨站点击重定向 -> ${href}`);
                }
            }
        }, true);

        // --- 5. 全局表单提交重定向净化 ---
        document.addEventListener('submit', function(event) {
            let target = event.target;
            if (target && target.tagName === 'FORM') {
                const action = target.action || location.href;
                // 如果广告试图通过提交隐藏表单来跳转到第三方网页
                if (isCrossDomain(action)) {
                    event.preventDefault();
                    event.stopPropagation();
                    console.warn(`[终极防御系统] 拦截到跨站表单提交重定向 -> ${action}`);
                }
            }
        }, true);
    }

    // ==========================================
    // 执行代码注入
    // ==========================================
    const scriptNode = document.createElement('script');
    // 使用 toString() 将函数转换为字符串，完美保留原生执行环境
    scriptNode.textContent = '(' + injectCoreLogic.toString() + ')();';

    const appendScript = () => {
        // 由于我们在 document-start 阶段，需要确保即使 html 标签刚生成也能注入
        if (document.documentElement) {
            document.documentElement.appendChild(scriptNode);
            scriptNode.remove(); // 执行完毕后不留痕迹地抹除自身
        } else {
            requestAnimationFrame(appendScript);
        }
    };
    appendScript();

})();
