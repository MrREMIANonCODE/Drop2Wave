(function () {
    "use strict";

    var storageKey = "drop2wave_admin_sidebar_collapsed";
    var loadingState = {
        count: 0,
        timer: null,
        visible: false,
        noteTimer: null,
        noteIndex: 0,
        notes: []
    };
    var defaultLoadingNotes = [
        "Arranging your dashboard widgets...",
        "Syncing latest admin data from cloud...",
        "Preparing orders and product controls...",
        "Loading secure admin workspace...",
        "Almost ready, finishing the setup...",
        "Checking latest activity for this panel..."
    ];

    function getCurrentAdminPageKey(pathHint) {
        var path = String(pathHint || window.location.pathname || "").toLowerCase();
        if (path.indexOf("/orders") !== -1 || path.indexOf("/order/") !== -1) return "orders";
        if (path.indexOf("/products") !== -1 || path.indexOf("products.html") !== -1) return "products";
        if (path.indexOf("/reviews") !== -1 || path.indexOf("/review/") !== -1) return "reviews";
        if (path.indexOf("/categories") !== -1 || path.indexOf("categories.html") !== -1) return "categories";
        if (path.indexOf("/incomplete") !== -1) return "incomplete";
        if (path.indexOf("/index.html") !== -1 || path.endsWith("/admin/") || path.endsWith("/admin")) return "dashboard";
        return "general";
    }

    function getLoadingConfigByPage(pageKey) {
        var map = {
            dashboard: {
                title: "Loading dashboard...",
                subtitle: "Preparing your admin workspace",
                notes: [
                    "Arranging dashboard cards and KPIs...",
                    "Collecting latest business summary...",
                    "Refreshing quick navigation tools..."
                ]
            },
            orders: {
                title: "Loading orders...",
                subtitle: "Preparing order controls",
                notes: [
                    "Collecting latest order records...",
                    "Syncing status timeline and counts...",
                    "Preparing invoice and customer data..."
                ]
            },
            products: {
                title: "Loading products...",
                subtitle: "Preparing product management",
                notes: [
                    "Pulling latest product catalog...",
                    "Syncing prices, stock, and media...",
                    "Building product table and filters..."
                ]
            },
            reviews: {
                title: "Loading reviews...",
                subtitle: "Preparing moderation tools",
                notes: [
                    "Collecting latest review activity...",
                    "Syncing approvals and pending queue...",
                    "Preparing reviewer content panel..."
                ]
            },
            categories: {
                title: "Loading categories...",
                subtitle: "Preparing category management",
                notes: [
                    "Syncing category hierarchy and status...",
                    "Preparing sorting and update controls...",
                    "Loading latest category records..."
                ]
            },
            incomplete: {
                title: "Loading incomplete attempts...",
                subtitle: "Preparing recovery records",
                notes: [
                    "Collecting latest checkout attempts...",
                    "Syncing incomplete customer entries...",
                    "Preparing quick recovery actions..."
                ]
            },
            general: {
                title: "Loading page...",
                subtitle: "Preparing your admin workspace",
                notes: defaultLoadingNotes
            }
        };

        return map[pageKey] || map.general;
    }

    function applyLoadingTheme(message, pathHint) {
        var cfg = getLoadingConfigByPage(getCurrentAdminPageKey(pathHint));
        var titleEl = document.getElementById("d2wPageLoadingText");
        var subEl = document.getElementById("d2wPageLoadingSub");

        loadingState.notes = Array.isArray(cfg.notes) && cfg.notes.length ? cfg.notes : defaultLoadingNotes;

        if (titleEl) {
            titleEl.textContent = String(message || cfg.title || "Loading...");
        }
        if (subEl) {
            subEl.textContent = String(cfg.subtitle || "Please wait a moment");
        }
    }

    function setLoadingNote(index) {
        var noteEl = document.getElementById("d2wPageLoadingNote");
        if (!noteEl) return;
        var safeList = loadingState.notes && loadingState.notes.length ? loadingState.notes : defaultLoadingNotes;
        var i = Math.max(0, Number(index || 0) % safeList.length);
        noteEl.textContent = safeList[i];
    }

    function stopLoadingNotes() {
        if (loadingState.noteTimer) {
            clearInterval(loadingState.noteTimer);
            loadingState.noteTimer = null;
        }
    }

    function startLoadingNotes() {
        stopLoadingNotes();
        setLoadingNote(loadingState.noteIndex);
        loadingState.noteTimer = setInterval(function () {
            loadingState.noteIndex = (loadingState.noteIndex + 1) % Math.max(1, loadingState.notes.length || defaultLoadingNotes.length);
            setLoadingNote(loadingState.noteIndex);
        }, 2600);
    }

    function ensureGlobalLoadingOverlay() {
        if (document.getElementById("d2wPageLoadingOverlay")) return;

        var style = document.createElement("style");
        style.id = "d2wPageLoadingStyle";
        style.textContent = [
            "#d2wPageLoadingOverlay{position:fixed;inset:0;background:radial-gradient(circle at 22% 18%,rgba(34,197,94,.18),transparent 44%),radial-gradient(circle at 80% 82%,rgba(37,99,235,.2),transparent 44%),rgba(2,6,23,.5);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;z-index:999999;}",
            "#d2wPageLoadingOverlay.show{display:flex;}",
            ".d2w-loading-box{width:220px;height:220px;max-width:86vw;max-height:86vw;background:linear-gradient(160deg,rgba(255,255,255,.95),rgba(255,255,255,.86));border:1px solid rgba(255,255,255,.55);border-radius:18px;padding:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;box-shadow:0 24px 56px rgba(0,0,0,.22);font-size:14px;font-weight:600;color:#0f172a;position:relative;overflow:hidden;text-align:center;}",
            ".d2w-loading-box:before{content:'';position:absolute;inset:0;transform:translateX(-110%);background:linear-gradient(115deg,transparent,rgba(255,255,255,.45),transparent);animation:d2wShimmer 1.6s ease-in-out infinite;}",
            ".d2w-loading-spinner{width:22px;height:22px;border:2.5px solid rgba(34,197,94,.25);border-top-color:#22c55e;border-right-color:#2563eb;border-radius:999px;animation:d2wSpin .72s linear infinite;flex:0 0 auto;}",
            ".d2w-loading-meta{display:flex;flex-direction:column;line-height:1.2;gap:4px;}",
            ".d2w-loading-sub{font-size:11px;font-weight:500;color:#64748b;letter-spacing:.2px;}",
            "#d2wPageLoadingText{font-size:15px;font-weight:700;}",
            "#d2wPageLoadingNote{font-size:12px;color:#334155;line-height:1.35;min-height:34px;max-width:180px;display:flex;align-items:center;justify-content:center;}",
            "@keyframes d2wSpin{to{transform:rotate(360deg);}}",
            "@keyframes d2wShimmer{100%{transform:translateX(110%);}}"
        ].join("");
        document.head.appendChild(style);

        var overlay = document.createElement("div");
        overlay.id = "d2wPageLoadingOverlay";
        overlay.setAttribute("aria-live", "polite");
        overlay.innerHTML = '<div class="d2w-loading-box"><span class="d2w-loading-spinner" aria-hidden="true"></span><div class="d2w-loading-meta"><span id="d2wPageLoadingText">Loading...</span><span class="d2w-loading-sub" id="d2wPageLoadingSub">Preparing your admin workspace</span><span id="d2wPageLoadingNote">Arranging your dashboard widgets...</span></div></div>';
        document.body.appendChild(overlay);

        applyLoadingTheme("", window.location.pathname || "");
    }

    function openGlobalLoading(message, delayMs) {
        ensureGlobalLoadingOverlay();
        var delay = Number(delayMs || 180);
        var overlay = document.getElementById("d2wPageLoadingOverlay");
        applyLoadingTheme(message, window.location.pathname || "");

        loadingState.count += 1;

        if (loadingState.count === 1) {
            loadingState.noteIndex = Math.floor(Math.random() * Math.max(1, loadingState.notes.length || defaultLoadingNotes.length));
            setLoadingNote(loadingState.noteIndex);
        }

        if (!loadingState.visible && !loadingState.timer) {
            loadingState.timer = setTimeout(function () {
                loadingState.timer = null;
                if (loadingState.count > 0 && overlay) {
                    overlay.classList.add("show");
                    loadingState.visible = true;
                    startLoadingNotes();
                }
            }, Math.max(0, delay));
        }

        return function closeGlobalLoading() {
            loadingState.count = Math.max(0, loadingState.count - 1);
            if (loadingState.count > 0) return;

            if (loadingState.timer) {
                clearTimeout(loadingState.timer);
                loadingState.timer = null;
            }

            if (overlay) overlay.classList.remove("show");
            loadingState.visible = false;
            stopLoadingNotes();
        };
    }

    function setupNavigationLoading() {
        document.addEventListener("click", function (e) {
            var link = e.target && e.target.closest ? e.target.closest("a[href]") : null;
            if (!link) return;
            if (e.defaultPrevented) return;
            if (e.button && e.button !== 0) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

            var href = String(link.getAttribute("href") || "").trim();
            if (!href || href.charAt(0) === "#") return;
            if (/^(javascript:|mailto:|tel:)/i.test(href)) return;
            if (String(link.getAttribute("target") || "").toLowerCase() === "_blank") return;
            if (link.hasAttribute("download")) return;

            var closeNavLoading = openGlobalLoading("", 110);
            applyLoadingTheme("", href);
            setTimeout(function () {
                closeNavLoading();
            }, 1400);
        });
    }

    function restoreSidebarState(layout) {
        try {
            if (localStorage.getItem(storageKey) === "1") {
                layout.classList.add("sidebar-collapsed");
            }
        } catch (err) {
            // Ignore storage issues and keep the default expanded layout.
        }
    }

    function setupSidebarToggle(layout, toggle) {
        if (!layout || !toggle) return;

        toggle.addEventListener("click", function () {
            layout.classList.toggle("sidebar-collapsed");
            try {
                localStorage.setItem(storageKey, layout.classList.contains("sidebar-collapsed") ? "1" : "0");
            } catch (err) {
                // Ignore storage issues.
            }
        });
    }

    function getAdminRootPath() {
        var path = window.location.pathname || "";
        var lower = path.toLowerCase();
        var marker = "/admin/";
        var idx = lower.lastIndexOf(marker);
        if (idx === -1) return "/admin/";
        return path.slice(0, idx + marker.length);
    }

    function getVisitSiteHref() {
        return getAdminRootPath() + "../index.html";
    }

    function ensureUnifiedTopHeader() {
        var panelList = document.querySelectorAll(".main-panel");
        if (!panelList || !panelList.length) return;

        var profileName = ((document.querySelector(".profile-name") || {}).textContent || "Admin Super Admin").trim();
        var profileRole = ((document.querySelector(".profile-role") || {}).textContent || "super-admin").trim();
        var avatarLetter = profileName ? profileName.charAt(0).toUpperCase() : "A";
        var visitHref = getVisitSiteHref();

        panelList.forEach(function(panel) {
            var wrapper = panel.parentElement;
            if (!wrapper || !wrapper.classList || !wrapper.classList.contains("admin-content-wrap")) {
                wrapper = document.createElement("div");
                wrapper.className = "admin-content-wrap";
                panel.parentNode.insertBefore(wrapper, panel);
                wrapper.appendChild(panel);
            }

            if (wrapper.querySelector(".admin-global-topbar")) return;

            var html = [
                '<div class="admin-global-topbar">',
                '  <div class="admin-topbar-left">',
                '    <a class="admin-visit-btn" href="' + visitHref + '"><i class="fas fa-globe"></i><span>Visit Site</span></a>',
                '  </div>',
                '  <div class="admin-topbar-right">',
                '    <button type="button" class="admin-topbar-btn admin-topbar-fullscreen-btn" title="Toggle fullscreen"><i class="fas fa-expand"></i></button>',
                '    <button type="button" class="admin-topbar-btn admin-topbar-bell-btn" title="Notifications"><i class="far fa-bell"></i></button>',
                '    <div class="admin-topbar-user-wrap">',
                '    <button type="button" class="admin-topbar-user" aria-haspopup="true" aria-expanded="false">',
                '      <div class="admin-topbar-user-text">',
                '        <div class="admin-topbar-user-name">' + profileName + '</div>',
                '        <div class="admin-topbar-user-role">' + profileRole + '</div>',
                '      </div>',
                '      <div class="admin-topbar-avatar">' + avatarLetter + '</div>',
                '    </button>',
                '    <div class="admin-topbar-user-menu" aria-hidden="true">',
                '      <a class="admin-topbar-user-menu-item" href="#" data-admin-user-action="profile"><i class="far fa-user"></i><span>Profile</span></a>',
                '      <a class="admin-topbar-user-menu-item" href="#" data-admin-user-action="settings"><i class="fas fa-cog"></i><span>Settings</span></a>',
                '      <button type="button" class="admin-topbar-user-menu-item logout" data-admin-user-action="logout"><i class="fas fa-sign-out-alt"></i><span>Logout</span></button>',
                '    </div>',
                '    </div>',
                '  </div>',
                '</div>'
            ].join("");

            wrapper.insertAdjacentHTML("afterbegin", html);
        });
    }

    function setupTopbarActions() {
        document.addEventListener("click", function(e) {
            var userToggle = e.target && e.target.closest ? e.target.closest(".admin-topbar-user") : null;
            if (userToggle) {
                var userWrap = userToggle.closest(".admin-topbar-user-wrap");
                var wasOpen = userWrap && userWrap.classList.contains("is-open");

                document.querySelectorAll(".admin-topbar-user-wrap.is-open").forEach(function (openWrap) {
                    openWrap.classList.remove("is-open");
                    var openBtn = openWrap.querySelector(".admin-topbar-user");
                    var openMenu = openWrap.querySelector(".admin-topbar-user-menu");
                    if (openBtn) openBtn.setAttribute("aria-expanded", "false");
                    if (openMenu) openMenu.setAttribute("aria-hidden", "true");
                });

                if (userWrap && !wasOpen) {
                    userWrap.classList.add("is-open");
                    var btn = userWrap.querySelector(".admin-topbar-user");
                    var menu = userWrap.querySelector(".admin-topbar-user-menu");
                    if (btn) btn.setAttribute("aria-expanded", "true");
                    if (menu) menu.setAttribute("aria-hidden", "false");
                }
                return;
            }

            var userAction = e.target && e.target.closest ? e.target.closest("[data-admin-user-action]") : null;
            if (userAction) {
                var action = String(userAction.getAttribute("data-admin-user-action") || "");
                e.preventDefault();

                var closeWrap = userAction.closest(".admin-topbar-user-wrap");
                if (closeWrap) {
                    closeWrap.classList.remove("is-open");
                    var closeBtn = closeWrap.querySelector(".admin-topbar-user");
                    var closeMenu = closeWrap.querySelector(".admin-topbar-user-menu");
                    if (closeBtn) closeBtn.setAttribute("aria-expanded", "false");
                    if (closeMenu) closeMenu.setAttribute("aria-hidden", "true");
                }

                if (action === "logout") {
                    if (confirm("Logout from admin panel?")) {
                        if (window.AdminStore && typeof window.AdminStore.clearSession === "function") {
                            window.AdminStore.clearSession();
                        }

                        var loginPath = getAdminRootPath() + "login.html?logout=1";
                        window.location.href = loginPath;
                    }
                    return;
                }

                if (action === "profile" || action === "settings") {
                    var label = action === "profile" ? "Profile" : "Settings";
                    alert(label + " page will be added soon.");
                    return;
                }
            }

            if (e.target && e.target.closest && !e.target.closest(".admin-topbar-user-wrap")) {
                document.querySelectorAll(".admin-topbar-user-wrap.is-open").forEach(function (openWrap) {
                    openWrap.classList.remove("is-open");
                    var openBtn = openWrap.querySelector(".admin-topbar-user");
                    var openMenu = openWrap.querySelector(".admin-topbar-user-menu");
                    if (openBtn) openBtn.setAttribute("aria-expanded", "false");
                    if (openMenu) openMenu.setAttribute("aria-hidden", "true");
                });
            }

            var fullscreenBtn = e.target && e.target.closest ? e.target.closest(".admin-topbar-fullscreen-btn") : null;
            if (fullscreenBtn) {
                if (document.fullscreenElement) {
                    if (document.exitFullscreen) document.exitFullscreen();
                } else {
                    if (document.documentElement.requestFullscreen) {
                        document.documentElement.requestFullscreen().catch(function () {});
                    }
                }
                return;
            }

            var bellBtn = e.target && e.target.closest ? e.target.closest(".admin-topbar-bell-btn") : null;
            if (bellBtn) {
                /* Loading window disabled in admin panel.
                var closeNote = openGlobalLoading("Checking notifications...", 0);
                setTimeout(function () {
                    closeNote();
                }, 420);
                */
            }
        });
    }

    function buildProductsLinks() {
        var adminRoot = getAdminRootPath();
        return {
            manage: adminRoot + "products/manage.html",
            add: adminRoot + "products/add.html",
            categories: adminRoot + "products/categories.html"
        };
    }

    function buildOrdersLinks() {
        var adminRoot = getAdminRootPath();
        return {
            create: adminRoot + "order/create.html",
            all: adminRoot + "order/all.html",
            newOrders: adminRoot + "order/new.html",
            complete: adminRoot + "order/complete.html",
            noResponse: adminRoot + "order/no-response.html",
            hold: adminRoot + "order/hold.html",
            cancelled: adminRoot + "order/cancel.html",
            inCourier: adminRoot + "order/in-courier.html"
        };
    }

    function buildReviewsLinks() {
        var adminRoot = getAdminRootPath();
        return {
            all: adminRoot + "review/all.html",
            create: adminRoot + "review/create.html",
            pending: adminRoot + "review/pending.html"
        };
    }

    function isManagePage() {
        var path = window.location.pathname.toLowerCase();
        return path.endsWith("/admin/products/manage.html") || path.endsWith("/admin/products.html");
    }

    function isCategoriesPage() {
        var path = window.location.pathname.toLowerCase();
        return path.endsWith("/admin/products/categories.html") || path.endsWith("/admin/categories.html");
    }

    function getOrderViewFromUrl() {
        try {
            var params = new URLSearchParams(window.location.search || "");
            return String(params.get("view") || "all").toLowerCase();
        } catch (err) {
            return "all";
        }
    }

    function isOrdersPage() {
        var path = window.location.pathname.toLowerCase();
        return path.endsWith("/admin/orders.html");
    }

    function isReviewsPage() {
        var path = window.location.pathname.toLowerCase();
        return path.endsWith("/admin/reviews.html");
    }

    function isIncompletePage() {
        var path = window.location.pathname.toLowerCase();
        return path.endsWith("/admin/incomplete.html");
    }

    function getReviewViewFromUrl() {
        try {
            var params = new URLSearchParams(window.location.search || "");
            return String(params.get("view") || "all").toLowerCase();
        } catch (err) {
            return "all";
        }
    }

    function setupProductsDropdown(layout) {
        var nav = document.querySelector(".side-scroll .nav.flex-column");
        if (!nav || nav.querySelector(".nav-group.products-group")) return;

        var categoriesItem = nav.querySelector('a[href="categories.html"]');
        var productsItem = nav.querySelector('a[href="products.html"]');
        if (!categoriesItem || !productsItem) return;

        var categoriesLi = categoriesItem.closest("li");
        var productsLi = productsItem.closest("li");
        if (!categoriesLi || !productsLi) return;

        var links = buildProductsLinks();
        var groupLi = document.createElement("li");
        groupLi.className = "nav-item nav-group products-group";
        groupLi.innerHTML =
            '<button type="button" class="nav-link nav-group-toggle" aria-expanded="false">' +
                '<i class="fas fa-box-open nav-icon"></i>' +
                '<span class="nav-label">Products</span>' +
                '<i class="fas fa-angle-down nav-caret"></i>' +
            "</button>" +
            '<ul class="nav flex-column nav-submenu">' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-product-sub="manage" href="' + links.manage + '"><i class="fas fa-cube nav-icon"></i><span class="nav-label">Product Manage</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-product-sub="add" href="' + links.add + '"><i class="fas fa-plus-circle nav-icon"></i><span class="nav-label">Add Product</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-product-sub="categories" href="' + links.categories + '"><i class="fas fa-th-large nav-icon"></i><span class="nav-label">Categories</span></a></li>' +
            "</ul>";

        var insertAfter = categoriesLi;
        insertAfter.insertAdjacentElement("afterend", groupLi);
        categoriesLi.remove();
        productsLi.remove();

        var toggle = groupLi.querySelector(".nav-group-toggle");
        toggle.addEventListener("click", function () {
            groupLi.classList.toggle("open");
            toggle.setAttribute("aria-expanded", groupLi.classList.contains("open") ? "true" : "false");
        });

        var manageLink = groupLi.querySelector('[data-product-sub="manage"]');
        var categoriesLink = groupLi.querySelector('[data-product-sub="categories"]');
        if (isManagePage()) {
            groupLi.classList.add("open");
            manageLink.classList.add("active");
            toggle.setAttribute("aria-expanded", "true");
        } else if (window.location.pathname.toLowerCase().endsWith("/admin/products/add.html")) {
            groupLi.classList.add("open");
            var addLink = groupLi.querySelector('[data-product-sub="add"]');
            if (addLink) addLink.classList.add("active");
            toggle.setAttribute("aria-expanded", "true");
        } else if (isCategoriesPage()) {
            groupLi.classList.add("open");
            categoriesLink.classList.add("active");
            toggle.setAttribute("aria-expanded", "true");
        }

        if (layout.classList.contains("sidebar-collapsed")) {
            groupLi.classList.remove("open");
            toggle.setAttribute("aria-expanded", "false");
        }
    }

    function setupOrdersDropdown(layout) {
        var nav = document.querySelector(".side-scroll .nav.flex-column");
        if (!nav || nav.querySelector(".nav-group.orders-group")) return;

        var ordersItem = nav.querySelector('a[href="orders.html"]');
        if (!ordersItem) return;

        var ordersLi = ordersItem.closest("li");
        if (!ordersLi) return;

        var links = buildOrdersLinks();
        var groupLi = document.createElement("li");
        groupLi.className = "nav-item nav-group orders-group";
        groupLi.innerHTML =
            '<button type="button" class="nav-link nav-group-toggle" aria-expanded="false">' +
                '<i class="fas fa-shopping-bag nav-icon"></i>' +
                '<span class="nav-label">Orders</span>' +
                '<i class="fas fa-angle-down nav-caret"></i>' +
            "</button>" +
            '<ul class="nav flex-column nav-submenu">' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="create" href="' + links.create + '"><i class="fas fa-plus-circle nav-icon"></i><span class="nav-label">Create Order</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="all" href="' + links.all + '"><i class="fas fa-list nav-icon"></i><span class="nav-label">All Orders</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="new" href="' + links.newOrders + '"><i class="fas fa-bell nav-icon"></i><span class="nav-label">New Order</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="complete" href="' + links.complete + '"><i class="fas fa-check-circle nav-icon"></i><span class="nav-label">Complete Orders</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="no_response" href="' + links.noResponse + '"><i class="fas fa-phone-slash nav-icon"></i><span class="nav-label">No Response</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="hold" href="' + links.hold + '"><i class="fas fa-pause-circle nav-icon"></i><span class="nav-label">Hold Orders</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="cancelled" href="' + links.cancelled + '"><i class="fas fa-times-circle nav-icon"></i><span class="nav-label">Cancel Orders</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-order-sub="in_courier" href="' + links.inCourier + '"><i class="fas fa-shipping-fast nav-icon"></i><span class="nav-label">In Courier</span></a></li>' +
            "</ul>";

        ordersLi.insertAdjacentElement("afterend", groupLi);
        ordersLi.remove();

        var toggle = groupLi.querySelector(".nav-group-toggle");
        toggle.addEventListener("click", function () {
            groupLi.classList.toggle("open");
            toggle.setAttribute("aria-expanded", groupLi.classList.contains("open") ? "true" : "false");
        });

        if (isOrdersPage()) {
            var currentView = getOrderViewFromUrl();
            var activeItem = groupLi.querySelector('[data-order-sub="' + currentView + '"]') || groupLi.querySelector('[data-order-sub="all"]');
            if (activeItem) activeItem.classList.add("active");
            groupLi.classList.add("open");
            toggle.setAttribute("aria-expanded", "true");
        }

        if (layout.classList.contains("sidebar-collapsed")) {
            groupLi.classList.remove("open");
            toggle.setAttribute("aria-expanded", "false");
        }
    }

    function setupReviewsDropdown(layout) {
        var nav = document.querySelector(".side-scroll .nav.flex-column");
        if (!nav || nav.querySelector(".nav-group.reviews-group")) return;

        var reviewsItem = nav.querySelector('a[href="reviews.html"]');
        if (!reviewsItem) return;

        var reviewsLi = reviewsItem.closest("li");
        if (!reviewsLi) return;

        var links = buildReviewsLinks();
        var groupLi = document.createElement("li");
        groupLi.className = "nav-item nav-group reviews-group";
        groupLi.innerHTML =
            '<button type="button" class="nav-link nav-group-toggle" aria-expanded="false">' +
                '<i class="fas fa-star nav-icon"></i>' +
                '<span class="nav-label">Reviews</span>' +
                '<i class="fas fa-angle-down nav-caret"></i>' +
            "</button>" +
            '<ul class="nav flex-column nav-submenu">' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-review-sub="all" href="' + links.all + '"><i class="fas fa-list nav-icon"></i><span class="nav-label">All Reviews</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-review-sub="create" href="' + links.create + '"><i class="fas fa-plus-circle nav-icon"></i><span class="nav-label">Create Review</span></a></li>' +
                '<li class="nav-item"><a class="nav-link nav-sublink" data-review-sub="pending" href="' + links.pending + '"><i class="fas fa-hourglass-half nav-icon"></i><span class="nav-label">Pending Reviews</span></a></li>' +
            "</ul>";

        reviewsLi.insertAdjacentElement("afterend", groupLi);
        reviewsLi.remove();

        var toggle = groupLi.querySelector(".nav-group-toggle");
        toggle.addEventListener("click", function () {
            groupLi.classList.toggle("open");
            toggle.setAttribute("aria-expanded", groupLi.classList.contains("open") ? "true" : "false");
        });

        if (isReviewsPage()) {
            var currentView = getReviewViewFromUrl();
            var activeItem = groupLi.querySelector('[data-review-sub="' + currentView + '"]') || groupLi.querySelector('[data-review-sub="all"]');
            if (activeItem) activeItem.classList.add("active");
            groupLi.classList.add("open");
            toggle.setAttribute("aria-expanded", "true");
        }

        if (layout.classList.contains("sidebar-collapsed")) {
            groupLi.classList.remove("open");
            toggle.setAttribute("aria-expanded", "false");
        }
    }

    function setupIncompleteLink() {
        var nav = document.querySelector('.side-scroll .nav.flex-column');
        if (!nav || nav.querySelector('.nav-link[data-nav="incomplete"]')) return;

        var adminRoot = getAdminRootPath();
        var incompleteLi = document.createElement('li');
        incompleteLi.className = 'nav-item';
        incompleteLi.innerHTML =
            '<a class="nav-link' + (isIncompletePage() ? ' active' : '') + '" data-nav="incomplete" href="' + adminRoot + 'incomplete.html">' +
                '<i class="fas fa-clipboard-list nav-icon"></i>' +
                '<span class="nav-label">Incomplete</span>' +
            '</a>';

        var ordersGroup = nav.querySelector('.orders-group');
        if (ordersGroup) {
            ordersGroup.insertAdjacentElement('beforebegin', incompleteLi);
            return;
        }

        nav.appendChild(incompleteLi);
    }

    function reorderSidebarNav() {
        var nav = document.querySelector('.side-scroll .nav.flex-column');
        if (!nav) return;

        function getLi(selector) {
            var node = nav.querySelector(selector);
            if (!node) return null;
            if (node.tagName && node.tagName.toLowerCase() === 'li') return node;
            return node.closest('li');
        }

        var dashboardLi = getLi('a[href="index.html"]');
        var ordersLi = getLi('li.orders-group') || getLi('a[href="orders.html"]');
        var productsLi = getLi('li.products-group') || getLi('a[href="products.html"]');
        var reviewsLi = getLi('li.reviews-group') || getLi('a[href="reviews.html"]');
        var incompleteLi = getLi('a[data-nav="incomplete"]') || getLi('a[href$="/incomplete.html"]') || getLi('a[href="incomplete.html"]');

        [dashboardLi, ordersLi, productsLi, reviewsLi, incompleteLi].forEach(function(li) {
            if (li && li.parentNode === nav) {
                nav.appendChild(li);
            }
        });
    }

    document.addEventListener("DOMContentLoaded", function () {
        /* Loading window disabled in admin panel.
        ensureGlobalLoadingOverlay();
        var closeBootLoading = openGlobalLoading("", 210);
        */
        var closeBootLoading = function () {};

        var layout = document.querySelector(".admin-layout");
        var toggle = document.getElementById("sidebarToggle");
        if (!layout) {
            closeBootLoading();
            return;
        }

        setupProductsDropdown(layout);
        setupOrdersDropdown(layout);
        setupReviewsDropdown(layout);
        setupIncompleteLink();
        reorderSidebarNav();
        restoreSidebarState(layout);
        setupSidebarToggle(layout, toggle);
        ensureUnifiedTopHeader();
        setupTopbarActions();
        /* setupNavigationLoading(); */
        closeBootLoading();
    });
})();
