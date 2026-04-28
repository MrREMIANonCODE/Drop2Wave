(function ($) {
    "use strict";

    var CART_KEY = "drop2wave_cart_v1";
    var STORE_KEY = "drop2wave_store_v1";
    var CLOUD_COLLECTION = "drop2wave";
    var CLOUD_DOCUMENT = "store";
    var FIREBASE_CONFIG = {
        apiKey: "AIzaSyBkOvOhYO1o1fUW0DtRns5VLirbRO5EsWA",
        authDomain: "drop2wavefirebase.firebaseapp.com",
        projectId: "drop2wavefirebase",
        storageBucket: "drop2wavefirebase.firebasestorage.app",
        messagingSenderId: "296193741264"
    };
    var NEW_PRODUCTS_SLIDE_INTERVAL_MS = 3000;
    var lastStoreSnapshot = "";
    var cloudInitPromise = null;
    var activeCategorySlugs = [];
    var categoryNameBySlug = {};
    var loadingState = {
        count: 0,
        timer: null,
        visible: false,
        noteTimer: null,
        noteIndex: 0
    };
    var loadingNotes = [
        "Bringing the freshest products for you...",
        "Checking latest stock and prices...",
        "Preparing a smoother shopping experience...",
        "Almost there, polishing your storefront...",
        "Loading new arrivals and hot deals...",
        "Syncing everything for this session..."
    ];

    function setLoadingNote(index) {
        var noteEl = document.getElementById("d2wPageLoadingNote");
        if (!noteEl) return;
        var safeList = loadingNotes.length ? loadingNotes : ["Loading..."];
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
            loadingState.noteIndex = (loadingState.noteIndex + 1) % Math.max(1, loadingNotes.length);
            setLoadingNote(loadingState.noteIndex);
        }, 2600);
    }

    function ensureGlobalLoadingOverlay() {
        if (document.getElementById("d2wPageLoadingOverlay")) return;

        var style = document.createElement("style");
        style.id = "d2wPageLoadingStyle";
        style.textContent = [
            "#d2wPageLoadingOverlay{position:fixed;inset:0;background:radial-gradient(circle at 20% 20%,rgba(37,99,235,.23),transparent 42%),radial-gradient(circle at 80% 80%,rgba(248,86,6,.2),transparent 44%),rgba(2,6,23,.5);backdrop-filter:blur(3px);display:none;align-items:center;justify-content:center;z-index:999999;}",
            "#d2wPageLoadingOverlay.show{display:flex;}",
            ".d2w-loading-box{width:220px;height:220px;max-width:86vw;max-height:86vw;background:linear-gradient(160deg,rgba(255,255,255,.92),rgba(255,255,255,.84));border:1px solid rgba(255,255,255,.55);border-radius:18px;padding:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;box-shadow:0 24px 56px rgba(0,0,0,.22);font-size:14px;font-weight:600;color:#0f172a;position:relative;overflow:hidden;text-align:center;}",
            ".d2w-loading-box:before{content:'';position:absolute;inset:0;transform:translateX(-110%);background:linear-gradient(115deg,transparent,rgba(255,255,255,.45),transparent);animation:d2wShimmer 1.6s ease-in-out infinite;}",
            ".d2w-loading-spinner{width:22px;height:22px;border:2.5px solid rgba(37,99,235,.22);border-top-color:#2563eb;border-right-color:#f85606;border-radius:999px;animation:d2wSpin .72s linear infinite;flex:0 0 auto;}",
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
        overlay.innerHTML = '<div class="d2w-loading-box"><span class="d2w-loading-spinner" aria-hidden="true"></span><div class="d2w-loading-meta"><span id="d2wPageLoadingText">Loading...</span><span class="d2w-loading-sub">Please wait a moment</span><span id="d2wPageLoadingNote">Bringing the freshest products for you...</span></div></div>';
        document.body.appendChild(overlay);
    }

    function openGlobalLoading(message, delayMs) {
        ensureGlobalLoadingOverlay();
        var delay = Number(delayMs || 180);
        var overlay = document.getElementById("d2wPageLoadingOverlay");
        var textEl = document.getElementById("d2wPageLoadingText");

        loadingState.count += 1;
        if (textEl && message) {
            textEl.textContent = String(message);
        }

        if (loadingState.count === 1) {
            loadingState.noteIndex = Math.floor(Math.random() * Math.max(1, loadingNotes.length));
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

    function withTimeout(promise, timeoutMs, fallbackValue) {
        var timeout = Number(timeoutMs || 0);
        if (!timeout || timeout < 1) return promise;

        return Promise.race([
            promise,
            new Promise(function (resolve) {
                setTimeout(function () { resolve(fallbackValue); }, timeout);
            })
        ]);
    }

    window.D2WLoading = {
        open: openGlobalLoading
    };

    function getCategoryBrowsePath() {
        var path = (window.location.pathname || "").toLowerCase();
        if (path.indexOf("category-products") !== -1 && path.indexOf(".html") === -1) {
            return "category-products";
        }
        return "category-products.html";
    }

    function parseMoney(raw) {
        var cleaned = String(raw || "").replace(/[^\d.]/g, "");
        var n = parseFloat(cleaned);
        return isNaN(n) ? 0 : n;
    }

    function formatMoney(value) {
        var n = Number(value || 0);
        if (!isFinite(n)) n = 0;
        if (Math.round(n) === n) return String(n);
        return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
    }

    function escapeHtml(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function slugifyCategoryName(name) {
        return String(name || "category")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, "-");
    }

    function getCategoryFiltersFromUrl() {
        try {
            var params = new URLSearchParams(window.location.search);
            var raw = String(params.get("category") || "").trim().toLowerCase();
            if (!raw) return [];
            var seen = {};
            return raw.split(",")
                .map(function (x) { return x.trim(); })
                .filter(function (x) {
                    if (!x || seen[x]) return false;
                    seen[x] = true;
                    return true;
                });
        } catch (e) {
            return [];
        }
    }

    function buildCategoryFilterUrl(slugOrSlugs) {
        var list = Array.isArray(slugOrSlugs) ? slugOrSlugs : [slugOrSlugs];
        var clean = list
            .map(function (x) { return String(x || "").trim().toLowerCase(); })
            .filter(Boolean);

        var basePath = getCategoryBrowsePath();

        if (!clean.length) {
            return basePath + "#allProductsGrid";
        }

        return basePath + "?category=" + encodeURIComponent(clean.join(",")) + "#allProductsGrid";
    }

    function isCategoryBrowsePage() {
        var path = (window.location.pathname || "").toLowerCase();
        return /category-products(\.html)?$/.test(path);
    }

    function ensureCategoryFilterBar() {
        if ($("#d2wCategoryFilterBar").length) return;

        var html = [
            '<div class="row px-xl-5 pb-2 d-none" id="d2wCategoryFilterBar">',
            '  <div class="col-12">',
            '    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#fff3e8;border:1px solid #ffd3b4;border-radius:10px;padding:10px 12px;">',
            '      <div style="font-weight:600;color:#7c2d12;">Showing categories: <span id="d2wActiveCategoryName"></span></div>',
            '      <button type="button" id="d2wClearCategoryFilter" class="btn btn-sm btn-outline-dark">Show All Products</button>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join("");

        $("#allProductsGrid").before(html);
    }

    function updateCategoryFilterBar() {
        ensureCategoryFilterBar();
        var $bar = $("#d2wCategoryFilterBar");
        if (activeCategorySlugs.length) {
            var labels = activeCategorySlugs.map(function (slug) {
                return categoryNameBySlug[slug] || slug;
            });
            $("#d2wActiveCategoryName").text(labels.join(", "));
            $bar.removeClass("d-none");
        } else {
            $bar.addClass("d-none");
        }
    }

    function applyCategoryFromUrl(categories) {
        categoryNameBySlug = {};
        (categories || []).forEach(function (cat) {
            var slug = (cat.slug || slugifyCategoryName(cat.name || "")).toLowerCase();
            categoryNameBySlug[slug] = cat.name || slug;
        });

        var fromUrl = getCategoryFiltersFromUrl();
        activeCategorySlugs = fromUrl.filter(function (slug) {
            return !!categoryNameBySlug[slug];
        });
    }

    function filterProductsByActiveCategory(products, categories) {
        if (!activeCategorySlugs.length) return products;

        var activeSet = {};
        activeCategorySlugs.forEach(function (slug) { activeSet[slug] = true; });

        var categoryIds = (categories || [])
            .filter(function (cat) {
                var slug = (cat.slug || slugifyCategoryName(cat.name || "")).toLowerCase();
                return !!activeSet[slug];
            })
            .map(function (cat) { return String(cat.id); });

        if (!categoryIds.length) return [];
        return products.filter(function (p) {
            return categoryIds.indexOf(String(p.categoryId)) !== -1;
        });
    }

    function renderCategoryMultiFilter(categories) {
        var $host = $("#d2wCategoryMultiFilter");
        if (!isCategoryBrowsePage() || !$host.length) return;

        var activeCategories = (categories || []).filter(function (c) { return c.isActive !== false; });
        if (!activeCategories.length) {
            $host.html("");
            return;
        }

        var selected = {};
        activeCategorySlugs.forEach(function (slug) { selected[slug] = true; });

        var chips = activeCategories.map(function (cat) {
            var slug = (cat.slug || slugifyCategoryName(cat.name || "")).toLowerCase();
            var activeClass = selected[slug] ? " active" : "";
            return '<button type="button" class="d2w-cat-chip' + activeClass + '" data-category-slug="' + escapeHtml(slug) + '">' + escapeHtml(cat.name || slug) + '</button>';
        }).join("");

        $host.html('<div class="d2w-cat-chip-wrap">' + chips + '</div>');
    }

    function readStoreRaw() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (!raw) {
                return { categories: [], products: [] };
            }
            return JSON.parse(raw);
        } catch (e) {
            return { categories: [], products: [] };
        }
    }

    function saveStoreRaw(store) {
        localStorage.setItem(STORE_KEY, JSON.stringify(store));
    }

    function getStoreData() {
        var store = readStoreRaw() || {};
        return {
            categories: store.categories || [],
            products: store.products || []
        };
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-d2w-src="' + src + '"]');
            if (existing) {
                if (existing.dataset.loaded === "1") {
                    resolve();
                    return;
                }
                existing.addEventListener("load", function () { resolve(); }, { once: true });
                existing.addEventListener("error", function () { reject(new Error("Script load failed: " + src)); }, { once: true });
                return;
            }

            var script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.dataset.d2wSrc = src;
            script.onload = function () {
                script.dataset.loaded = "1";
                resolve();
            };
            script.onerror = function () { reject(new Error("Script load failed: " + src)); };
            document.head.appendChild(script);
        });
    }

    function ensureCloudReady() {
        if (cloudInitPromise) return cloudInitPromise;

        cloudInitPromise = (async function () {
            try {
                await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
                await loadScript("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js");

                if (!window.firebase) return false;

                // Initialize explicitly so this works outside Firebase Hosting too.
                if (!window.firebase.apps || window.firebase.apps.length === 0) {
                    window.firebase.initializeApp(FIREBASE_CONFIG);
                }

                if (!window.firebase.apps || window.firebase.apps.length === 0) {
                    return false;
                }

                window.firebase.firestore();
                return true;
            } catch (err) {
                console.warn("Storefront cloud sync unavailable.", err);
                return false;
            }
        })();

        return cloudInitPromise;
    }

    async function pullStoreFromCloud() {
        var ready = await ensureCloudReady();
        if (!ready) return false;

        try {
            var db = window.firebase.firestore();
            var snap = await db.collection(CLOUD_COLLECTION).doc(CLOUD_DOCUMENT).get();
            if (!snap.exists) return false;

            var payload = snap.data() || {};
            var store = payload.store || {};
            if (!Array.isArray(store.categories)) store.categories = [];
            if (!Array.isArray(store.products)) store.products = [];

            saveStoreRaw(store);
            syncStorefrontIfChanged();
            return true;
        } catch (err) {
            console.warn("Failed to pull storefront data from cloud.", err);
            return false;
        }
    }

    function bootstrapStoreFromExistingMarkup() {
        var store = readStoreRaw();
        // Check if bootstrap has been explicitly disabled (user cleared products or added via admin)
        var bootstrapDisabled = localStorage.getItem('drop2wave_bootstrap_disabled');
        if (bootstrapDisabled || (store.products || []).length > 0) return;

        var discovered = [];
        var seenIds = {};

        function scan(containerSelector, isNew) {
            $(containerSelector).find(".product-item").each(function (index) {
                var $card = $(this);
                var $form = $card.find('form[action*="add-to-cart"]').first();
                var rawId = $.trim($form.find('input[name="product_id"]').val() || "");
                var id = rawId || (isNew ? "seed_new_" : "seed_total_") + index;
                if (seenIds[id]) return;

                var name = $.trim($card.find("h6").first().text()) || "Product";
                var image = $card.find("img").first().attr("src") || "";
                var priceText = $card.find(".d-flex h6").first().text();
                var sale = parseMoney(priceText);
                var oldPriceText = $card.find(".d-flex h6 del").first().text();
                var oldPrice = parseMoney(oldPriceText) || sale;
                var url = $card.find("a").first().attr("href") || "";

                discovered.push({
                    id: id,
                    name: name,
                    categoryId: "",
                    price: sale,
                    oldPrice: oldPrice,
                    productUrl: url,
                    description: "",
                    image: image,
                    isNew: isNew,
                    isActive: true,
                    sortOrder: index + 1
                });
                seenIds[id] = true;
            });
        }

        scan("#newProductsCarousel", true);
        scan("#allProductsGrid", false);

        if (discovered.length) {
            store.products = discovered;
            saveStoreRaw(store);
        }
    }

    function renderCategoriesFromStore(categories) {
        var activeCategories = categories.filter(function (c) { return c.isActive !== false; });

        if (activeCategories.length) {
            var menuHtml = activeCategories
                .map(function (cat) {
                    var slug = cat.slug || slugifyCategoryName(cat.name || "");
                    var img = cat.image || "https://via.placeholder.com/28";
                    var href = buildCategoryFilterUrl(slug);
                    return '<a href="' + escapeHtml(href) + '" class="nav-item nav-link d2w-category-link" data-category-slug="' + escapeHtml(slug) + '" data-category-name="' + escapeHtml(cat.name) + '"><img src="' + escapeHtml(img) + '" style="width: 28px;margin-right: 10px;">' + escapeHtml(cat.name) + '</a>';
                })
                .join("");

            var carouselHtml = activeCategories
                .map(function (cat) {
                    var slug = cat.slug || slugifyCategoryName(cat.name || "");
                    var img = cat.image || "https://via.placeholder.com/120x120?text=Category";
                    var href = buildCategoryFilterUrl(slug);
                    return [
                        '<div class="vendor-item mb-2">',
                        '  <div class="cat-item d-flex flex-column border-new" id="categoryItem">',
                        '      <a href="' + escapeHtml(href) + '" class="position-relative overflow-hidden mb-3 text-center d2w-category-link" data-category-slug="' + escapeHtml(slug) + '" data-category-name="' + escapeHtml(cat.name) + '">',
                        '          <img class="img-fluid" src="' + escapeHtml(img) + '" alt="" style="height: 100px;border-radius: 50%;">',
                        '      </a>',
                        '      <a href="' + escapeHtml(href) + '" class="d2w-category-link" data-category-slug="' + escapeHtml(slug) + '" data-category-name="' + escapeHtml(cat.name) + '">',
                        '          <h5 class="font-weight-semi-bold m-0" id="categoryItemName">' + escapeHtml(cat.name) + '</h5>',
                        '      </a>',
                        '  </div>',
                        '</div>'
                    ].join("");
                })
                .join("");

            $("#navbarCollapse").html(menuHtml);
            $("#mySidenav").find("a.nav-item.nav-link").remove();
            $("#mySidenav").append(
                activeCategories.map(function (cat) {
                    var slug = cat.slug || slugifyCategoryName(cat.name || "");
                    var href = buildCategoryFilterUrl(slug);
                    return '<a href="' + escapeHtml(href) + '" class="nav-item nav-link d2w-category-link" data-category-slug="' + escapeHtml(slug) + '" data-category-name="' + escapeHtml(cat.name) + '" style="color: white">' + escapeHtml(cat.name) + '</a>';
                }).join("")
            );
            $("#categoryCarousel").html(carouselHtml);
        }
    }

    function createProductCard(product, compact) {
        var productId = product.id || ("prod_" + Date.now());
        var image = product.coverImage || product.image || "https://via.placeholder.com/320x320?text=Product";
        var detailUrl = "product-details.html?id=" + encodeURIComponent(productId);
        var sale = Number(product.price || 0);
        var oldPrice = Number(product.oldPrice || sale);
        var colClass = compact ? "vendor-item" : "col-lg-2 col-6 pb-3";
        
        // Calculate discount percentage
        var discountPercent = 0;
        if (oldPrice > sale) {
            discountPercent = Math.round(((oldPrice - sale) / oldPrice) * 100);
        }
        var discountBadge = discountPercent > 0 ? '<div style="position: absolute; top: 10px; right: 10px; background: linear-gradient(135deg, #f85606 0%, #ff6b35 100%); color: #fff; padding: 6px 12px; border-radius: 6px; font-weight: 700; font-size: 13px; z-index: 10; box-shadow: 0 4px 10px rgba(248, 86, 6, 0.3);">' + discountPercent + '% Off</div>' : '';

        return [
            '<div class="' + colClass + '">',
            '  <div class="card product-item border-0">',
            '      <div class="card-header position-relative overflow-hidden bg-transparent border p-0" style="height: 185px;float: left;overflow:hidden;">',
            '          ' + discountBadge,
            '          <a href="' + escapeHtml(detailUrl) + '" style="display:block;overflow:hidden;height:100%;"><img class="img-fluid w-100" src="' + escapeHtml(image) + '" alt="" style="width:100%;height:100%;object-fit:cover;transition:transform 0.4s ease;"></a>',
            '      </div>',
            '      <div class="card-body border-left border-right text-center p-0 pt-2">',
            '          <a href="' + escapeHtml(detailUrl) + '"><h6 class="text-truncate mb-2">' + escapeHtml(product.name || "Product") + '</h6></a>',
            '          <div class="d-flex justify-content-center align-items-center" style="gap:8px;flex-wrap:nowrap;">',
            '              <h6 style="white-space:nowrap;margin-bottom:0;">৳ ' + formatMoney(sale) + '</h6>',
            '              <h6 class="text-muted" style="white-space:nowrap;margin-bottom:0;"><del>৳ ' + formatMoney(oldPrice) + '</del></h6>',
            '          </div>',
            '      </div>',
            '      <div class="card-footer justify-content-between bg-light border" style="padding:0;">',
            '          <form name="form" method="POST" action="add-to-cart" enctype="multipart/form-data">',
            '              <input type="text" name="product_id" value="' + escapeHtml(productId) + '" hidden>',
            '              <input type="text" name="qty" value="1" hidden>',
            '              <button type="submit" class="btn btn-info btn-sm btn-block text-dark" style="color: white !important;box-shadow: 0 4px 8px 0 rgba(0, 0, 0, 0.2), 0 6px 20px 0 rgba(0, 0, 0, 0.19);">অর্ডার করুন</button>',
            '          </form>',
            '      </div>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function renderProductsFromStore(products, categories) {
        var activeProducts = products.filter(function (p) { return p.isActive !== false; });
        if (!activeProducts.length) {
            $("#newProductsCarousel").html("");
            $("#allProductsGrid").html('<div class="col-12 text-center text-muted py-4">No products found.</div>');
            updateCategoryFilterBar();
            return;
        }

        var visibleProducts = filterProductsByActiveCategory(activeProducts, categories || []);

        var newProducts = visibleProducts.filter(function (p) { return p.isNew === true; }).sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
        var allProducts = visibleProducts.slice().sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });

        if (newProducts.length) {
            $("#newProductsCarousel").html(newProducts.map(function (p) { return createProductCard(p, true); }).join(""));
        } else {
            $("#newProductsCarousel").html("");
        }

        if (allProducts.length) {
            $("#allProductsGrid").html(allProducts.map(function (p) { return createProductCard(p, false); }).join(""));
        } else {
            $("#allProductsGrid").html('<div class="col-12 text-center text-muted py-4">No products found in this category.</div>');
        }

        updateCategoryFilterBar();
    }

    function destroyOwlIfLoaded($el) {
        if (!$el || !$el.length || !$el.hasClass("owl-loaded")) return;

        $el.trigger("destroy.owl.carousel");
        $el.find(".owl-stage-outer").children().unwrap();
        $el.removeClass("owl-center owl-loaded owl-text-select-on");
    }

    function rebuildCategoryCarousel() {
        if (!$.fn.owlCarousel) return;
        var $carousel = $("#categoryCarousel");
        if (!$carousel.length) return;

        destroyOwlIfLoaded($carousel);
        $carousel.owlCarousel({
            loop: true,
            margin: 10,
            autoplay: true,
            autoplayTimeout: 2600,
            autoplayHoverPause: true,
            smartSpeed: 1000,
            responsive: {
                0: { items: 3 },
                576: { items: 3 },
                768: { items: 4 },
                992: { items: 5, margin: 29 },
                1200: { items: 8, margin: 29 }
            }
        });
    }

    function rebuildNewProductsCarousel() {
        if (!$.fn.owlCarousel) return;
        var $carousel = $("#newProductsCarousel");
        if (!$carousel.length) return;

        destroyOwlIfLoaded($carousel);
        $carousel.owlCarousel({
            loop: true,
            margin: 29,
            nav: false,
            autoplay: true,
            autoplayTimeout: NEW_PRODUCTS_SLIDE_INTERVAL_MS,
            autoplayHoverPause: true,
            smartSpeed: 1000,
            responsive: {
                0: { items: 3 },
                576: { items: 3 },
                768: { items: 4 },
                992: { items: 5 },
                1200: { items: 6 }
            }
        });
    }

    function renderStorefrontFromAdmin() {
        var data = getStoreData();
        applyCategoryFromUrl(data.categories || []);
        renderCategoriesFromStore(data.categories || []);
        renderCategoryMultiFilter(data.categories || []);
        renderProductsFromStore(data.products || [], data.categories || []);
        rebuildCategoryCarousel();
        rebuildNewProductsCarousel();
        try {
            lastStoreSnapshot = JSON.stringify(data);
        } catch (e) {
            lastStoreSnapshot = "";
        }
    }

    function syncStorefrontIfChanged() {
        var data = getStoreData();
        var next = "";
        try {
            next = JSON.stringify(data);
        } catch (e) {
            next = "";
        }
        if (next !== lastStoreSnapshot) {
            renderStorefrontFromAdmin();
        }
    }

    function bindCategoryFilterEvents() {
        $(document).on("click", ".d2w-category-link", function (e) {
            var slug = String($(this).data("category-slug") || "").toLowerCase().trim();
            if (!slug) return;

            if (!isCategoryBrowsePage()) {
                return;
            }

            e.preventDefault();
            activeCategorySlugs = [slug];

            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", buildCategoryFilterUrl(activeCategorySlugs));
            }

            renderStorefrontFromAdmin();
            var target = document.getElementById("allProductsGrid");
            if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        });

        $(document).on("click", "#d2wClearCategoryFilter", function () {
            activeCategorySlugs = [];
            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", getCategoryBrowsePath() + "#allProductsGrid");
            }
            renderStorefrontFromAdmin();
        });

        $(document).on("click", ".d2w-cat-chip", function () {
            if (!isCategoryBrowsePage()) return;

            var slug = String($(this).data("category-slug") || "").trim().toLowerCase();
            if (!slug) return;

            var idx = activeCategorySlugs.indexOf(slug);
            if (idx >= 0) {
                activeCategorySlugs.splice(idx, 1);
            } else {
                activeCategorySlugs.push(slug);
            }

            if (window.history && window.history.replaceState) {
                window.history.replaceState(null, "", buildCategoryFilterUrl(activeCategorySlugs));
            }

            renderStorefrontFromAdmin();
        });
    }

    function normalizeCartItems(rawItems) {
        var list = Array.isArray(rawItems) ? rawItems : [];
        return list
            .filter(function (item) { return item && item.id != null; })
            .map(function (item) {
                var qty = parseInt(item.quantity != null ? item.quantity : item.qty, 10);
                qty = isNaN(qty) || qty < 1 ? 1 : qty;
                return {
                    id: item.id,
                    name: item.name || "Product",
                    image: item.image || "",
                    price: Number(item.price || 0),
                    quantity: qty,
                    qty: qty
                };
            });
    }

    function getCart() {
        try {
            var saved = localStorage.getItem(CART_KEY);
            if (!saved) return [];

            var parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                return normalizeCartItems(parsed);
            }

            if (parsed && Array.isArray(parsed.items)) {
                return normalizeCartItems(parsed.items);
            }

            return [];
        } catch (e) {
            return [];
        }
    }

    function saveCart(cart) {
        var normalized = normalizeCartItems(cart);
        localStorage.setItem(CART_KEY, JSON.stringify({ items: normalized }));
    }

    function addToCart(item) {
        var cart = getCart();
        var itemQty = parseInt(item.quantity != null ? item.quantity : item.qty, 10);
        itemQty = isNaN(itemQty) || itemQty < 1 ? 1 : itemQty;

        var existing = cart.find(function (x) {
            return String(x.id) === String(item.id);
        });

        if (existing) {
            existing.quantity += itemQty;
            existing.qty = existing.quantity;
        } else {
            cart.push({
                id: item.id,
                name: item.name || "Product",
                image: item.image || "",
                price: Number(item.price || 0),
                quantity: itemQty,
                qty: itemQty
            });
        }

        saveCart(cart);
        updateCartBadge();
    }

    function removeCartItem(id) {
        var cart = getCart().filter(function (x) {
            return String(x.id) !== String(id);
        });
        saveCart(cart);
        updateCartBadge();
        renderCartModal();
    }

    function updateCartItemQty(id, qty) {
        var cart = getCart();
        var item = cart.find(function (x) {
            return String(x.id) === String(id);
        });
        if (!item) return;

        item.quantity = Math.max(1, qty);
        item.qty = item.quantity;
        saveCart(cart);
        updateCartBadge();
        renderCartModal();
    }

    function getCartSummary() {
        var cart = getCart();
        return cart.reduce(
            function (acc, item) {
                acc.count += item.quantity;
                acc.total += item.price * item.quantity;
                return acc;
            },
            { count: 0, total: 0 }
        );
    }

    function updateCartBadge() {
        var summary = getCartSummary();
        $(".fa-shopping-cart").each(function () {
            var $sup = $(this).siblings("sup").first();
            if ($sup.length) {
                $sup.text(summary.count);
            }
        });

        var $mobilehide = $("#mobilehide").first();
        if ($mobilehide.length) {
            $mobilehide.text(" - ৳ " + formatMoney(summary.total));
            $mobilehide.toggle(summary.count > 0);
        }
    }

    function ensureCartModal() {
        if ($("#d2wCartModal").length) return;

        var modalHtml = [
            '<div class="modal fade" id="d2wCartModal" tabindex="-1" role="dialog" aria-hidden="true">',
            '  <div class="modal-dialog modal-lg" role="document">',
            '    <div class="modal-content">',
            '      <div class="modal-header">',
            '        <h5 class="modal-title">Shopping Cart</h5>',
            '        <button type="button" class="close" data-dismiss="modal" aria-label="Close">',
            '          <span aria-hidden="true">&times;</span>',
            '        </button>',
            '      </div>',
            '      <div class="modal-body" id="d2wCartBody"></div>',
            '      <div class="modal-footer">',
            '        <button type="button" class="btn btn-secondary" id="d2wContinueShoppingBtn">Continue Shopping</button>',
            '        <button type="button" class="btn btn-danger" id="d2wClearCartBtn">Clear Cart</button>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join("");

        $("body").append(modalHtml);
    }

    function renderCartModal() {
        ensureCartModal();
        var cart = getCart();
        var $body = $("#d2wCartBody");

        if (!cart.length) {
            $body.html('<p class="mb-0 text-muted">Your cart is empty.</p>');
            return;
        }

        var rows = cart
            .map(function (item, index) {
                return [
                    "<tr>",
                    "<td>" + (index + 1) + "</td>",
                    '<td><img src="' + item.image + '" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:6px;"></td>',
                    "<td>" + item.name + "</td>",
                    "<td>৳ " + formatMoney(item.price) + "</td>",
                    '<td><div class="input-group input-group-sm" style="max-width:120px;">' +
                        '<div class="input-group-prepend"><button class="btn btn-outline-secondary d2w-qty-minus" data-id="' + item.id + '">-</button></div>' +
                        '<input type="text" class="form-control text-center" value="' + item.quantity + '" readonly>' +
                        '<div class="input-group-append"><button class="btn btn-outline-secondary d2w-qty-plus" data-id="' + item.id + '">+</button></div>' +
                    "</div></td>",
                    "<td>৳ " + formatMoney(item.price * item.quantity) + "</td>",
                    '<td><button class="btn btn-sm btn-danger d2w-remove-cart" data-id="' + item.id + '">Remove</button></td>',
                    "</tr>"
                ].join("");
            })
            .join("");

        var summary = getCartSummary();
        var html = [
            '<div class="table-responsive">',
            '  <table class="table table-bordered table-sm">',
            "    <thead><tr><th>#</th><th>Image</th><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th>Action</th></tr></thead>",
            "    <tbody>",
            rows,
            "    </tbody>",
            "  </table>",
            "</div>",
            '<div class="text-right"><h5 class="mb-0">Total: ৳ ' + formatMoney(summary.total) + "</h5></div>"
        ].join("");

        $body.html(html);
    }

    function showCartToast(message) {
        var $toast = $("#d2wCartToast");
        if (!$toast.length) {
            $("body").append(
                '<div id="d2wCartToast" style="position:fixed;right:18px;bottom:18px;background:#1f2937;color:#fff;padding:10px 14px;border-radius:8px;z-index:99999;display:none;font-size:14px;"></div>'
            );
            $toast = $("#d2wCartToast");
        }
        $toast.stop(true, true).text(message).fadeIn(120).delay(1000).fadeOut(300);
    }

    function extractProductFromForm($form) {
        var $card = $form.closest(".product-item");
        var id = $.trim($form.find('input[name="product_id"]').val() || "");
        var qty = parseInt($form.find('input[name="qty"]').val(), 10);
        var name = $.trim($card.find("h6").first().text()) || "Product";
        var image = $card.find("img").first().attr("src") || "";
        var priceText = $card.find(".d-flex h6").first().text() || $card.find("h6").eq(1).text();
        var price = parseMoney(priceText);

        return {
            id: id || "item_" + Date.now(),
            name: name,
            image: image,
            price: price,
            quantity: isNaN(qty) || qty < 1 ? 1 : qty,
            qty: isNaN(qty) || qty < 1 ? 1 : qty
        };
    }

    function bindCartEvents() {
        // Intercept all legacy add-to-cart forms and keep user on site.
        $(document).on("submit", 'form[action*="add-to-cart"]', function (e) {
            e.preventDefault();
            var item = extractProductFromForm($(this));
            addToCart(item);
            
            // Check which button was clicked
            var clickedButton = $(this).find("button[type='submit']:focus").length ? 
                                $(this).find("button[type='submit']:focus") : 
                                $(this).find("button[type='submit']").first();
            
            // If "অর্ডার করুন" button was clicked, redirect to checkout
            if (clickedButton.text().includes("অর্ডার করুন")) {
                showCartToast("অর্ডার পেজে নিয়ে যাওয়া হচ্ছে...");
                setTimeout(function() {
                    window.location.href = "checkout.html";
                }, 500);
            } else {
                showCartToast("Product added to cart");
            }
        });

        // Intercept cart icon checkout link and open local cart modal.
        $(document).on("click", 'a[href*="/checkout"]', function (e) {
            e.preventDefault();
            renderCartModal();
            $("#d2wCartModal").modal("show");
        });

        $(document).on("click", ".d2w-remove-cart", function () {
            removeCartItem($(this).data("id"));
        });

        $(document).on("click", ".d2w-qty-plus", function () {
            var id = $(this).data("id");
            var item = getCart().find(function (x) {
                return String(x.id) === String(id);
            });
            if (item) updateCartItemQty(id, item.quantity + 1);
        });

        $(document).on("click", ".d2w-qty-minus", function () {
            var id = $(this).data("id");
            var item = getCart().find(function (x) {
                return String(x.id) === String(id);
            });
            if (item) updateCartItemQty(id, item.quantity - 1);
        });

        $(document).on("click", "#d2wClearCartBtn", function () {
            saveCart([]);
            updateCartBadge();
            renderCartModal();
        });

        $(document).on("click", "#d2wContinueShoppingBtn", function () {
            window.location.href = "index.html";
        });
    }

    function getActiveSearchProducts() {
        var data = getStoreData();
        var products = (data.products || []).filter(function (p) {
            return p && p.isActive !== false;
        });

        products.sort(function (a, b) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        });

        return products;
    }

    function collectSearchProductsFromDom() {
        var domProducts = [];
        $(".product-item").each(function (index) {
            var $card = $(this);
            var $title = $card.find("h6").first();
            var name = $.trim($title.text());
            if (!name) return;

            var $form = $card.find('form[action*="add-to-cart"]').first();
            var id = $.trim($form.find('input[name="product_id"]').val() || "") || ("dom_" + index);
            var priceText = $card.find(".d-flex h6").first().text() || "";
            var oldPriceText = $card.find(".d-flex h6 del").first().text() || "";
            var link = $card.find("a").first().attr("href") || "";
            var image = $card.find("img").first().attr("src") || "";

            domProducts.push({
                id: id,
                name: name,
                price: parseMoney(priceText),
                oldPrice: parseMoney(oldPriceText),
                image: image,
                productUrl: link
            });
        });

        return domProducts;
    }

    function getSearchProductsNow() {
        var merged = [];
        var seen = {};

        function pushUnique(product) {
            if (!product || !product.name) return;
            var key = String(product.id || "") + "__" + String(product.name || "").toLowerCase();
            if (seen[key]) return;
            seen[key] = true;
            merged.push(product);
        }

        getActiveSearchProducts().forEach(pushUnique);
        collectSearchProductsFromDom().forEach(pushUnique);

        return merged;
    }

    function openProductResult(product) {
        if (!product) return;

        var id = String(product.id || "").trim();
        if (id) {
            window.location.href = "product-details.html?id=" + encodeURIComponent(id);
            return;
        }

        var target = null;
        $(".product-item h6").each(function () {
            if ($.trim($(this).text()).toLowerCase() === String(product.name || "").toLowerCase()) {
                target = $(this).closest(".product-item");
                return false;
            }
        });

        if (target && target.length) {
            $("html, body").animate({ scrollTop: Math.max(0, target.offset().top - 120) }, 350);
            target.css("box-shadow", "0 0 0 3px rgba(248,86,6,0.35)");
            setTimeout(function () {
                target.css("box-shadow", "");
            }, 900);
            return;
        }

        showCartToast("Product found, but no detail link is available yet");
    }

    function buildSearchSuggestionHtml(product, idx) {
        var image = product.image || "https://via.placeholder.com/60";
        var price = Number(product.price || 0);
        var oldPrice = Number(product.oldPrice || 0);
        var hasOldPrice = oldPrice > 0 && oldPrice > price;

        return [
            '<div class="d2w-search-item" data-match-index="' + idx + '" style="display:flex;gap:12px;padding:10px 12px;cursor:pointer;border-bottom:1px solid #eee;align-items:center;background:#fff;">',
            '  <img src="' + escapeHtml(image) + '" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px;flex:0 0 auto;" onerror="this.src=\'https://via.placeholder.com/56\'">',
            '  <div style="min-width:0;">',
            '    <div style="font-size:16px;font-weight:600;color:#1f2937;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px;">' + escapeHtml(product.name || "Product") + '</div>',
            '    <div style="margin-top:6px;font-size:15px;font-weight:700;color:#ef4444;">৳' + formatMoney(price) + (hasOldPrice ? ' <span style="color:#9ca3af;text-decoration:line-through;font-weight:500;margin-left:6px;">৳' + formatMoney(oldPrice) + '</span>' : '') + '</div>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function setupSearchForms() {
        $("input[name='search'], #search").each(function () {
            var $input = $(this);
            if ($input.data("d2w-search-bound")) return;
            $input.data("d2w-search-bound", true);

            var $form = $input.closest("form");
            if ($form.length) {
                $form.attr("action", "#");
                $form.attr("method", "GET");
            }
            $input.attr("autocomplete", "off");

            var $container = $input.closest(".input-group");
            if (!$container.length) {
                $container = $input.parent();
            }
            $container.css("position", "relative");

            var dropdownId = "d2wSearchDropdown_" + Math.random().toString(36).slice(2, 8);
            var $dropdown = $('<div id="' + dropdownId + '" style="display:none;position:absolute;left:0;right:0;top:calc(100% + 8px);background:#fff;border:1px solid #d1d5db;border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,0.18);z-index:9999;max-height:520px;overflow:auto;"></div>');
            $container.append($dropdown);
            $dropdown.data("d2wMatches", []);

            function renderSuggestions(term) {
                var query = String(term || "").trim().toLowerCase();
                if (!query) {
                    $dropdown.data("d2wMatches", []);
                    $dropdown.hide().empty();
                    return;
                }

                var products = getSearchProductsNow();
                var matches = products.filter(function (p) {
                    return String(p.name || "").toLowerCase().indexOf(query) !== -1;
                }).slice(0, 8);
                $dropdown.data("d2wMatches", matches);

                if (!matches.length) {
                    $dropdown.html('<div style="padding:12px;color:#6b7280;font-size:14px;">No product found</div>').show();
                    return;
                }

                $dropdown.html(matches.map(function (p, idx) {
                    return buildSearchSuggestionHtml(p, idx);
                }).join(""));
                $dropdown.show();
            }

            $input.on("input", function () {
                renderSuggestions($input.val());
            });

            $input.on("focus", function () {
                renderSuggestions($input.val());
            });

            $form.on("submit", function (e) {
                e.preventDefault();
                var query = String($input.val() || "").trim().toLowerCase();
                if (!query) return;

                var products = getSearchProductsNow();
                var firstMatch = products.find(function (p) {
                    return String(p.name || "").toLowerCase().indexOf(query) !== -1;
                });

                if (firstMatch) {
                    openProductResult(firstMatch);
                } else {
                    showCartToast("No matching product found");
                }
                $dropdown.hide();
            });

            $dropdown.on("click", ".d2w-search-item", function () {
                var idx = parseInt($(this).data("match-index"), 10);
                var matches = $dropdown.data("d2wMatches") || [];
                var product = matches[idx];
                if (!product) return;
                $input.val(product.name || "");
                $dropdown.hide();
                openProductResult(product);
            });

            $(document).on("click", function (e) {
                if (!$(e.target).closest($container).length) {
                    $dropdown.hide();
                }
            });
        });
    }

    function initThemeFeatures() {
        function toggleNavbarMethod() {
            if ($(window).width() > 992) {
                $(".navbar .dropdown").on("mouseover", function () {
                    $(".dropdown-toggle", this).trigger("click");
                }).on("mouseout", function () {
                    $(".dropdown-toggle", this).trigger("click").blur();
                });
            } else {
                $(".navbar .dropdown").off("mouseover").off("mouseout");
            }
        }
        toggleNavbarMethod();
        $(window).resize(toggleNavbarMethod);

        $(window).scroll(function () {
            if ($(this).scrollTop() > 100) {
                $(".back-to-top").fadeIn("slow");
            } else {
                $(".back-to-top").fadeOut("slow");
            }
        });

        $(".back-to-top").click(function () {
            $("html, body").animate({ scrollTop: 0 }, 1500, "easeInOutExpo");
            return false;
        });

        $(".vendor-carousel").owlCarousel({
            loop: true,
            margin: 29,
            nav: false,
            autoplay: true,
            autoplayTimeout: NEW_PRODUCTS_SLIDE_INTERVAL_MS,
            autoplayHoverPause: true,
            smartSpeed: 1000,
            responsive: {
                0: { items: 3 },
                576: { items: 3 },
                768: { items: 4 },
                992: { items: 5 },
                1200: { items: 6 }
            }
        });

        $(".category-carousel").owlCarousel({
            loop: true,
            margin: 10,
            autoplay: true,
            smartSpeed: 1000,
            responsive: {
                0: { items: 3 },
                576: { items: 3 },
                768: { items: 4 },
                992: { items: 5, margin: 29 },
                1200: { items: 8, margin: 29 }
            }
        });

        $(".related-carousel").owlCarousel({
            loop: true,
            margin: 29,
            nav: false,
            autoplay: true,
            smartSpeed: 1000,
            responsive: {
                0: { items: 1 },
                576: { items: 2 },
                768: { items: 3 },
                992: { items: 4 }
            }
        });

        $(".quantity button").on("click", function () {
            var button = $(this);
            var oldValue = button.parent().parent().find("input").val();
            var newVal;
            if (button.hasClass("btn-plus")) {
                newVal = parseFloat(oldValue) + 1;
            } else {
                newVal = oldValue > 0 ? parseFloat(oldValue) - 1 : 0;
            }
            button.parent().parent().find("input").val(newVal);
        });
    }

    $(document).ready(async function () {
        /* Loading window disabled on non-product pages.
        ensureGlobalLoadingOverlay();
        var closeBootLoading = openGlobalLoading("Loading latest products...", 220);
        */
        var closeBootLoading = function () {};

        bindCategoryFilterEvents();
        bootstrapStoreFromExistingMarkup();
        renderStorefrontFromAdmin();

        pullStoreFromCloud().then(function () {
            syncStorefrontIfChanged();
        }).catch(function () {});

        initThemeFeatures();
        ensureCartModal();
        bindCartEvents();
        setupSearchForms();
        updateCartBadge();
        closeBootLoading();

        $(document).on("click", "a[href]", function (e) {
            if (e.isDefaultPrevented && e.isDefaultPrevented()) return;
            if (e.which && e.which !== 1) return;
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

            var $link = $(this);
            var href = String($link.attr("href") || "").trim();
            if (!href || href.charAt(0) === "#") return;
            if (/^(javascript:|mailto:|tel:)/i.test(href)) return;
            if (String($link.attr("target") || "").toLowerCase() === "_blank") return;
            if ($link.is("[download]")) return;

            // Loading window disabled everywhere except product page; keep navigation instant.
        });

        // Keep storefront synced when admin updates data in another tab/window.
        window.addEventListener("storage", function (event) {
            if (event.key === STORE_KEY) {
                syncStorefrontIfChanged();
            }
        });

        window.addEventListener("focus", syncStorefrontIfChanged);
        window.addEventListener("focus", pullStoreFromCloud);
        document.addEventListener("visibilitychange", function () {
            if (!document.hidden) {
                syncStorefrontIfChanged();
                pullStoreFromCloud();
            }
        });

        // Keep all visitors refreshed with admin updates from cloud.
        setInterval(pullStoreFromCloud, 20000);
    });
})(jQuery);


