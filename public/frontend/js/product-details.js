(function () {
    "use strict";

    var STORE_KEY = "drop2wave_store_v1";
    var CART_KEY = "drop2wave_cart_v1";
    var REVIEW_CLIENT_KEY = "drop2wave_review_client_v1";
    var CLOUD_COLLECTION = "drop2wave";
    var CLOUD_DOCUMENT = "store";
    var FIREBASE_CONFIG = {
        apiKey: "AIzaSyBkOvOhYO1o1fUW0DtRns5VLirbRO5EsWA",
        authDomain: "drop2wavefirebase.firebaseapp.com",
        projectId: "drop2wavefirebase",
        storageBucket: "drop2wavefirebase.firebasestorage.app",
        messagingSenderId: "296193741264"
    };

    var cloudInitPromise = null;
    var activeProduct = null;
    var cloudStoreUnsubscribe = null;
    var cloudListenerPrimed = false;
    var galleryState = {
        images: [],
        index: 0,
        timer: null,
        transitionToken: ""
    };

    function escapeHtml(text) {
        return String(text || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function formatMoney(value) {
        var n = Number(value || 0);
        if (!isFinite(n)) n = 0;
        if (Math.round(n) === n) return String(n);
        return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
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
                if (!window.firebase.apps || window.firebase.apps.length === 0) {
                    window.firebase.initializeApp(FIREBASE_CONFIG);
                }

                if (!window.firebase.apps || window.firebase.apps.length === 0) {
                    return false;
                }

                window.firebase.firestore();
                return true;
            } catch (err) {
                console.warn("Product details cloud sync unavailable.", err);
                return false;
            }
        })();

        return cloudInitPromise;
    }

    function normalizeStoreShape(store) {
        var normalized = store && typeof store === "object" ? store : {};
        if (!Array.isArray(normalized.categories)) normalized.categories = [];
        if (!Array.isArray(normalized.products)) normalized.products = [];
        if (!Array.isArray(normalized.reviews)) normalized.reviews = [];
        return normalized;
    }

    function readStoreRaw() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            return raw ? normalizeStoreShape(JSON.parse(raw)) : { categories: [], products: [], reviews: [] };
        } catch (e) {
            return { categories: [], products: [], reviews: [] };
        }
    }

    function saveStoreRaw(store) {
        localStorage.setItem(STORE_KEY, JSON.stringify(normalizeStoreShape(store)));
    }

    function getStoreTimestamp(store) {
        var raw = store && store.updatedAt;
        if (!raw) return 0;
        if (typeof raw === "number") return raw;
        if (raw && typeof raw.toMillis === "function") return raw.toMillis();
        if (raw && typeof raw.seconds === "number") {
            return (raw.seconds * 1000) + Math.round((raw.nanoseconds || 0) / 1000000);
        }
        var parsed = Number(raw);
        return isFinite(parsed) ? parsed : 0;
    }

    function hasMeaningfulStoreData(store) {
        return (Array.isArray(store && store.categories) && store.categories.length > 0) ||
            (Array.isArray(store && store.products) && store.products.length > 0) ||
            (Array.isArray(store && store.reviews) && store.reviews.length > 0);
    }

    function shouldPreferCloudStore(localStore, cloudStore) {
        var local = normalizeStoreShape(localStore);
        var cloud = normalizeStoreShape(cloudStore);
        var localUpdatedAt = getStoreTimestamp(local);
        var cloudUpdatedAt = getStoreTimestamp(cloud);

        if (localUpdatedAt > 0 && cloudUpdatedAt > 0) {
            return cloudUpdatedAt >= localUpdatedAt;
        }

        if (!hasMeaningfulStoreData(cloud)) return false;

        if (
            cloud.categories.length < local.categories.length ||
            cloud.products.length < local.products.length ||
            cloud.reviews.length < local.reviews.length
        ) {
            return false;
        }

        return true;
    }

    function isDataUrl(value) {
        return typeof value === "string" && /^data:image\//i.test(value.trim());
    }

    function sanitizeStoreForCloud(store) {
        var normalized = normalizeStoreShape(store);

        var categories = (normalized.categories || []).map(function (cat) {
            var next = Object.assign({}, cat);
            if (isDataUrl(next.image)) next.image = "";
            return next;
        });

        var products = (normalized.products || []).map(function (prod) {
            var next = Object.assign({}, prod);
            if (isDataUrl(next.image)) next.image = "";
            if (isDataUrl(next.coverImage)) next.coverImage = "";
            if (Array.isArray(next.galleryImages)) {
                next.galleryImages = next.galleryImages.filter(function (img) { return !isDataUrl(img); });
            }
            return next;
        });

        var reviews = (normalized.reviews || []).map(function (review) {
            var next = Object.assign({}, review);
            if (Array.isArray(next.images)) {
                next.images = next.images.filter(function (img) { return !isDataUrl(img); });
            }
            return next;
        });

        return {
            updatedAt: normalized.updatedAt,
            categories: categories,
            products: products,
            reviews: reviews
        };
    }

    async function pullStoreFromCloud() {
        var ready = await ensureCloudReady();
        if (!ready) return false;

        try {
            var db = window.firebase.firestore();
            var snap = await db.collection(CLOUD_COLLECTION).doc(CLOUD_DOCUMENT).get();
            if (!snap.exists) return false;

            var payload = snap.data() || {};
            var cloudStore = payload.store || { categories: [], products: [], reviews: [] };
            var localStore = readStoreRaw();

            if (!shouldPreferCloudStore(localStore, cloudStore)) {
                return false;
            }

            saveStoreRaw(cloudStore);
            return true;
        } catch (err) {
            console.warn("Failed to pull details store from cloud.", err);
            return false;
        }
    }

    async function startCloudStoreListener() {
        var ready = await ensureCloudReady();
        if (!ready || cloudStoreUnsubscribe) return;

        try {
            var db = window.firebase.firestore();
            var ref = db.collection(CLOUD_COLLECTION).doc(CLOUD_DOCUMENT);

            cloudStoreUnsubscribe = ref.onSnapshot(function (snap) {
                if (!snap || !snap.exists) return;

                var payload = snap.data() || {};
                var cloudStore = payload.store || { categories: [], products: [], reviews: [] };
                var localStore = readStoreRaw();

                if (!shouldPreferCloudStore(localStore, cloudStore)) return;

                saveStoreRaw(cloudStore);

                if (activeProduct) {
                    var store = readStoreRaw();
                    renderReviewList(activeProduct.id, store);
                }

                if (cloudListenerPrimed) {
                    flashReviewSyncNote();
                } else {
                    cloudListenerPrimed = true;
                }
            }, function (err) {
                console.warn("Live store listener failed.", err);
            });
        } catch (err) {
            console.warn("Unable to start live store listener.", err);
        }
    }

    async function pushStoreToCloud(store) {
        var ready = await ensureCloudReady();
        if (!ready) return false;

        try {
            var db = window.firebase.firestore();
            await db.collection(CLOUD_COLLECTION).doc(CLOUD_DOCUMENT).set({
                store: normalizeStoreShape(store),
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        } catch (err) {
            try {
                var sanitized = sanitizeStoreForCloud(store);
                var dbRetry = window.firebase.firestore();
                await dbRetry.collection(CLOUD_COLLECTION).doc(CLOUD_DOCUMENT).set({
                    store: sanitized,
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.warn("Details sync used sanitized payload (inline base64 images removed).");
                return true;
            } catch (retryErr) {
                console.warn("Failed to push details store to cloud.", retryErr);
                return false;
            }
        }
    }

    function flashReviewSyncNote() {
        var note = document.getElementById("reviewSyncNote");
        if (!note) return;

        note.style.display = "block";
        note.textContent = "Updated just now";

        if (note._hideTimer) {
            clearTimeout(note._hideTimer);
        }

        note._hideTimer = setTimeout(function () {
            note.style.display = "none";
        }, 2200);
    }

    function openLightbox(src, caption) {
        var overlay = document.getElementById("imageLightbox");
        var img = document.getElementById("lightboxImage");
        var label = document.getElementById("lightboxCaption");
        if (!overlay || !img || !src) return;

        img.src = src;
        img.alt = caption || "Product image";
        if (label) label.textContent = caption || "";

        overlay.classList.add("open");
        overlay.setAttribute("aria-hidden", "false");
        document.body.style.overflow = "hidden";
    }

    function closeLightbox() {
        var overlay = document.getElementById("imageLightbox");
        var img = document.getElementById("lightboxImage");
        var label = document.getElementById("lightboxCaption");
        if (!overlay) return;

        overlay.classList.remove("open");
        overlay.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";

        if (img) img.src = "";
        if (label) label.textContent = "";
    }

    function getReviewClientId() {
        var existing = localStorage.getItem(REVIEW_CLIENT_KEY);
        if (existing) return existing;

        var nextId = "rc_" + String(Date.now()) + "_" + String(Math.floor(Math.random() * 100000));
        localStorage.setItem(REVIEW_CLIENT_KEY, nextId);
        return nextId;
    }

    function formatReviewDate(ts) {
        var date = new Date(Number(ts || Date.now()));
        if (isNaN(date.getTime())) return "Just now";
        return date.toLocaleString();
    }

    function getStarText(rating) {
        var r = Math.max(1, Math.min(5, Number(rating || 0)));
        return "★".repeat(r) + "☆".repeat(5 - r);
    }

    function getCurrentProductReviews(store, productId) {
        var clientId = getReviewClientId();
        var reviews = (store.reviews || []).filter(function (review) {
            return String(review.productId) === String(productId);
        });

        return reviews.filter(function (review) {
            if (String(review.status) === "approved") return true;
            if (String(review.status) === "pending" && String(review.clientId || "") === String(clientId)) return true;
            return false;
        }).sort(function (a, b) {
            return Number(b.createdAt || 0) - Number(a.createdAt || 0);
        });
    }

    function renderReviewList(productId, store) {
        var host = document.getElementById("reviewList");
        if (!host) return;

        var list = getCurrentProductReviews(store, productId);
        if (!list.length) {
            host.innerHTML = '<div class="text-muted">No reviews yet. Be the first one to review this product.</div>';
            return;
        }

        host.innerHTML = list.map(function (review) {
            var images = Array.isArray(review.images) ? review.images : [];

            return [
                '<div class="review-item">',
                '  <div class="d-flex justify-content-between align-items-center">',
                '    <strong>' + escapeHtml(review.authorName || "Anonymous") + '</strong>',
                '    <span class="review-meta">' + escapeHtml(formatReviewDate(review.createdAt)) + '</span>',
                '  </div>',
                '  <div class="review-rating">' + escapeHtml(getStarText(review.rating)) + '</div>',
                '  <div class="mt-1">' + escapeHtml(review.text || "") + '</div>',
                images.length ? ('  <div class="review-images">' + images.map(function (src) {
                    return '<img src="' + escapeHtml(src) + '" alt="Review image">';
                }).join("") + '</div>') : "",
                '</div>'
            ].join("\n");
        }).join("\n");
    }

    function getPendingImageList() {
        try {
            var parsed = JSON.parse((document.getElementById("reviewerImageData") || {}).value || "[]");
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (err) {
            return [];
        }
    }

    function setPendingImageList(images) {
        var input = document.getElementById("reviewerImageData");
        if (!input) return;
        input.value = JSON.stringify(Array.isArray(images) ? images : []);
        renderPendingImagePreview();
    }

    function renderPendingImagePreview() {
        var host = document.getElementById("reviewerImagePreview");
        if (!host) return;

        var images = getPendingImageList();
        if (!images.length) {
            host.innerHTML = "";
            host.style.display = "none";
            return;
        }

        host.innerHTML = images.map(function (src, idx) {
            return [
                '<div style="position:relative;">',
                '  <img src="' + escapeHtml(src) + '" alt="Preview ' + (idx + 1) + '">',
                '  <button type="button" class="btn btn-sm btn-danger" data-remove-review-image="' + idx + '" style="position:absolute;top:-8px;right:-8px;line-height:1;padding:1px 6px;">&times;</button>',
                '</div>'
            ].join("\n");
        }).join("\n");
        host.style.display = "flex";
    }

    function compressImageFile(file, maxDimension, quality) {
        var nextMaxDimension = Number(maxDimension || 900);
        var nextQuality = Number(quality || 0.72);

        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onerror = function () { reject(new Error("Failed to read image file")); };
            reader.onload = function (event) {
                var img = new Image();
                img.onerror = function () { reject(new Error("Invalid image file")); };
                img.onload = function () {
                    var ratio = Math.min(1, nextMaxDimension / Math.max(img.width, img.height));
                    var width = Math.max(1, Math.round(img.width * ratio));
                    var height = Math.max(1, Math.round(img.height * ratio));

                    var canvas = document.createElement("canvas");
                    canvas.width = width;
                    canvas.height = height;
                    var ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, width, height);

                    var q = nextQuality;
                    var output = canvas.toDataURL("image/jpeg", q);
                    while (output.length > 220000 && q > 0.45) {
                        q -= 0.07;
                        output = canvas.toDataURL("image/jpeg", q);
                    }

                    resolve(output);
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    async function handleReviewerImageSelection(inputEl) {
        var files = inputEl && inputEl.files ? Array.prototype.slice.call(inputEl.files) : [];
        if (!files.length) return;

        var current = getPendingImageList();
        for (var i = 0; i < files.length; i += 1) {
            try {
                var dataUrl = await compressImageFile(files[i]);
                current.push(dataUrl);
            } catch (err) {
                console.warn("Skipping invalid review image", err);
            }
        }

        setPendingImageList(current);
        if (inputEl) inputEl.value = "";
    }

    async function submitCustomerReview() {
        if (!activeProduct) return;

        var nameEl = document.getElementById("reviewerName");
        var ratingEl = document.getElementById("reviewerRating");
        var textEl = document.getElementById("reviewerText");

        var authorName = String((nameEl || {}).value || "").trim();
        var rating = Number((ratingEl || {}).value || 5);
        var text = String((textEl || {}).value || "").trim();
        var images = getPendingImageList();

        if (!authorName || !text) {
            alert("Please provide your name and review text.");
            return;
        }

        var store = readStoreRaw();
        if (!Array.isArray(store.reviews)) store.reviews = [];

        var review = {
            id: "rev_" + Date.now() + "_" + Math.floor(Math.random() * 10000),
            productId: activeProduct.id,
            authorName: authorName,
            rating: Math.max(1, Math.min(5, rating || 5)),
            text: text,
            images: images,
            status: "pending",
            source: "customer",
            clientId: getReviewClientId(),
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        store.reviews.push(review);
        saveStoreRaw(store);

        // Render instantly so customer sees feedback without network delay.
        renderReviewList(activeProduct.id, store);

        // Prefer shared admin sync utility when available; fallback to direct page sync.
        // Sync is intentionally non-blocking for faster UX.
        if (window.AdminStore && typeof window.AdminStore.syncToCloud === "function") {
            window.AdminStore.syncToCloud().catch(function (err) {
                console.warn("AdminStore cloud sync failed for review submission.", err);
            });
        } else {
            pushStoreToCloud(store).catch(function (err) {
                console.warn("Fallback cloud sync failed for review submission.", err);
            });
        }

        if (nameEl) nameEl.value = authorName;
        if (textEl) textEl.value = "";
        if (ratingEl) ratingEl.value = "5";
        setPendingImageList([]);
        var panel = document.getElementById("reviewFormPanel");
        var icon = document.getElementById("reviewFormToggleIcon");
        if (panel) panel.style.display = "none";
        if (icon) icon.className = "fas fa-chevron-down";
        alert("Thanks! Your review was submitted successfully.");
    }

    function bindReviewFormEvents() {
        var form = document.getElementById("customerReviewForm");
        if (!form || form.dataset.bound === "1") return;

        form.dataset.bound = "1";
        form.addEventListener("submit", function (event) {
            event.preventDefault();
            submitCustomerReview();
        });

        form.addEventListener("change", function (event) {
            var target = event.target;
            if (target && target.id === "reviewerImages") {
                handleReviewerImageSelection(target);
            }
        });

        form.addEventListener("click", function (event) {
            var btn = event.target.closest("button[data-remove-review-image]");
            if (!btn) return;

            var idx = parseInt(btn.getAttribute("data-remove-review-image"), 10);
            var images = getPendingImageList();
            if (Number.isInteger(idx) && idx >= 0 && idx < images.length) {
                images.splice(idx, 1);
                setPendingImageList(images);
            }
        });

        var toggleBtn = document.getElementById("reviewFormToggle");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", function () {
                var panel = document.getElementById("reviewFormPanel");
                var icon = document.getElementById("reviewFormToggleIcon");
                if (!panel) return;

                var open = panel.style.display === "block";
                panel.style.display = open ? "none" : "block";
                if (icon) {
                    icon.className = open ? "fas fa-chevron-down" : "fas fa-chevron-up";
                }
            });
        }
    }

    function getProductIdFromUrl() {
        var params = new URLSearchParams(window.location.search);
        return String(params.get("id") || "").trim();
    }

    function normalizeGallery(product) {
        var cover = product.coverImage || product.image || "https://via.placeholder.com/800x800?text=Product";
        var list = [];

        if (Array.isArray(product.galleryImages)) {
            list = product.galleryImages.filter(Boolean);
        } else if (typeof product.galleryImages === "string" && product.galleryImages.trim()) {
            try {
                var parsed = JSON.parse(product.galleryImages);
                if (Array.isArray(parsed)) list = parsed.filter(Boolean);
            } catch (e) {
                list = product.galleryImages.split(/\r?\n|,/).map(function (x) { return String(x || "").trim(); }).filter(Boolean);
            }
        }

        if (cover && list.indexOf(cover) === -1) {
            list.unshift(cover);
        }

        if (!list.length) {
            list = ["https://via.placeholder.com/800x800?text=Product"];
        }

        return list;
    }

    function getCategoryName(categoryId, store) {
        var c = (store.categories || []).find(function (x) { return String(x.id) === String(categoryId); });
        return c ? c.name : "Uncategorized";
    }

    function readCart() {
        try {
            var parsed = JSON.parse(localStorage.getItem(CART_KEY) || "null");
            if (Array.isArray(parsed)) return parsed;
            if (parsed && Array.isArray(parsed.items)) return parsed.items;
            return [];
        } catch (e) {
            return [];
        }
    }

    function saveCart(items) {
        localStorage.setItem(CART_KEY, JSON.stringify({ items: items }));
    }

    function addProductToCart(product, quantity) {
        var qty = Number(quantity || 1) || 1;
        var cart = readCart();
        var existing = cart.find(function (x) { return String(x.id) === String(product.id); });
        if (existing) {
            existing.quantity = (Number(existing.quantity || existing.qty || 1) || 1) + qty;
            existing.qty = existing.quantity;
        } else {
            cart.push({
                id: product.id,
                name: product.name || "Product",
                image: product.coverImage || product.image || "",
                price: Number(product.price || 0),
                quantity: qty,
                qty: qty
            });
        }
        saveCart(cart);
    }

    function bindDetailEvents() {
        document.addEventListener("click", function (e) {
            var lightboxOverlay = e.target.closest("#imageLightbox");
            if (lightboxOverlay) {
                if (e.target.closest("#lightboxClose") || e.target === lightboxOverlay) {
                    closeLightbox();
                }
                return;
            }

            if (e.target.closest("#lightboxClose")) {
                closeLightbox();
                return;
            }

            var thumb = e.target.closest(".thumb-item");
            if (thumb) {
                var thumbIndex = parseInt(thumb.getAttribute("data-index"), 10);
                if (Number.isInteger(thumbIndex)) {
                    openLightbox(thumb.getAttribute("data-src") || thumb.getAttribute("src") || "", thumb.getAttribute("alt") || "Product image");
                    setGalleryIndex(thumbIndex, true);
                }
            }

            if (e.target.closest("#mainDetailImage")) {
                var mainImage = document.getElementById("mainDetailImage");
                if (mainImage && mainImage.getAttribute("src")) {
                    openLightbox(mainImage.getAttribute("src"), activeProduct && activeProduct.name ? activeProduct.name : "Product image");
                }
            }

            if (e.target.closest("#detailPrev")) {
                setGalleryIndex(galleryState.index - 1, true);
            }

            if (e.target.closest("#detailNext")) {
                setGalleryIndex(galleryState.index + 1, true);
            }

            var dot = e.target.closest(".detail-dot");
            if (dot) {
                var dotIndex = parseInt(dot.getAttribute("data-index"), 10);
                if (Number.isInteger(dotIndex)) {
                    setGalleryIndex(dotIndex, true);
                }
            }

            if (e.target.closest("#qtyMinus")) {
                var qtyInput = document.getElementById("detailQty");
                var next = Math.max(1, (parseInt(qtyInput.value, 10) || 1) - 1);
                qtyInput.value = next;
            }

            if (e.target.closest("#qtyPlus")) {
                var qtyInput2 = document.getElementById("detailQty");
                qtyInput2.value = (parseInt(qtyInput2.value, 10) || 1) + 1;
            }

            if (e.target.closest("#addDetailToCart")) {
                var qty = parseInt((document.getElementById("detailQty") || {}).value, 10) || 1;
                if (!activeProduct) return;
                addProductToCart(activeProduct, qty);
                alert("Product added to cart");
            }

            if (e.target.closest("#orderNowBtn")) {
                var qty2 = parseInt((document.getElementById("detailQty") || {}).value, 10) || 1;
                if (!activeProduct) return;
                addProductToCart(activeProduct, qty2);
                window.location.href = "checkout.html";
            }
        });

        document.addEventListener("visibilitychange", function () {
            if (document.hidden) {
                stopGalleryAutoSlide();
            } else {
                startGalleryAutoSlide();
            }
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                closeLightbox();
            }
        });
    }

    function bindStageZoomEvents() {
        var stage = document.getElementById("detailImageStage");
        if (!stage || stage.dataset.zoomBound === "1") return;

        stage.dataset.zoomBound = "1";

        stage.addEventListener("mouseenter", function () {
            if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
                stage.classList.add("zooming");
                stopGalleryAutoSlide();
            }
        });

        stage.addEventListener("mousemove", function (ev) {
            if (!stage.classList.contains("zooming")) return;
            var img = document.getElementById("mainDetailImage");
            if (!img) return;

            var rect = stage.getBoundingClientRect();
            var x = ((ev.clientX - rect.left) / rect.width) * 100;
            var y = ((ev.clientY - rect.top) / rect.height) * 100;
            img.style.transformOrigin = x + "% " + y + "%";
        });

        stage.addEventListener("mouseleave", function () {
            stage.classList.remove("zooming");
            var img = document.getElementById("mainDetailImage");
            if (img) {
                img.style.transformOrigin = "center center";
            }
            startGalleryAutoSlide();
        });
    }

    function updateMainImage(src, smoothTransition) {
        var img = document.getElementById("mainDetailImage");
        if (!img || !src) return;

        var currentSrc = img.getAttribute("src") || "";
        if (currentSrc === src) return;

        if (!smoothTransition) {
            img.src = src;
            return;
        }

        var token = String(Date.now()) + String(Math.random());
        galleryState.transitionToken = token;
        img.classList.add("is-fading");

        setTimeout(function () {
            if (galleryState.transitionToken !== token) return;

            img.src = src;
            requestAnimationFrame(function () {
                requestAnimationFrame(function () {
                    if (galleryState.transitionToken !== token) return;
                    img.classList.remove("is-fading");
                });
            });
        }, 120);
    }

    function setGalleryIndex(nextIndex, userInitiated, animateTransition) {
        if (!galleryState.images.length) return;
        var shouldAnimate = animateTransition !== false;

        var len = galleryState.images.length;
        var index = ((nextIndex % len) + len) % len;
        galleryState.index = index;

        var src = galleryState.images[index];
        updateMainImage(src, shouldAnimate);

        document.querySelectorAll(".thumb-item").forEach(function (el) {
            var i = parseInt(el.getAttribute("data-index"), 10);
            el.classList.toggle("active", i === index);
        });

        document.querySelectorAll(".detail-dot").forEach(function (el) {
            var i = parseInt(el.getAttribute("data-index"), 10);
            el.classList.toggle("active", i === index);
        });

        if (userInitiated) {
            restartGalleryAutoSlide();
        }
    }

    function stopGalleryAutoSlide() {
        if (galleryState.timer) {
            clearInterval(galleryState.timer);
            galleryState.timer = null;
        }
    }

    function startGalleryAutoSlide() {
        stopGalleryAutoSlide();
        if (galleryState.images.length <= 1) return;

        galleryState.timer = setInterval(function () {
            setGalleryIndex(galleryState.index + 1, false);
        }, 3500);
    }

    function restartGalleryAutoSlide() {
        stopGalleryAutoSlide();
        startGalleryAutoSlide();
    }

    function initGallery(gallery) {
        galleryState.images = Array.isArray(gallery) ? gallery.slice() : [];
        galleryState.index = 0;
        stopGalleryAutoSlide();
        bindStageZoomEvents();

        var dotsHost = document.getElementById("detailSliderDots");
        if (dotsHost) {
            if (galleryState.images.length > 1) {
                dotsHost.innerHTML = galleryState.images.map(function (_, idx) {
                    return '<button type="button" class="detail-dot' + (idx === 0 ? ' active' : '') + '" data-index="' + idx + '" aria-label="Slide ' + (idx + 1) + '"></button>';
                }).join("");
            } else {
                dotsHost.innerHTML = "";
            }
        }

        var prevBtn = document.getElementById("detailPrev");
        var nextBtn = document.getElementById("detailNext");
        var showControls = galleryState.images.length > 1;
        if (prevBtn) prevBtn.style.display = showControls ? "inline-flex" : "none";
        if (nextBtn) nextBtn.style.display = showControls ? "inline-flex" : "none";

        setGalleryIndex(0, false, false);
        startGalleryAutoSlide();
    }

    function renderNotFound() {
        var root = document.getElementById("productDetailRoot");
        if (!root) return;
        root.innerHTML = [
            '<div class="text-center py-5">',
            '  <h4>Product not found</h4>',
            '  <p class="text-muted">This product may have been removed by admin.</p>',
            '  <a href="index.html" class="btn btn-primary">Back To Home</a>',
            '</div>'
        ].join("");
        document.getElementById("relatedProducts").innerHTML = "";
        var reviewsSection = document.getElementById("productReviewsSection");
        if (reviewsSection) reviewsSection.style.display = "none";
        var reviewList = document.getElementById("reviewList");
        if (reviewList) reviewList.innerHTML = '<div class="text-muted">No product selected.</div>';
    }

    function normalizeText(value) {
        return String(value || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function stripHtml(value) {
        var holder = document.createElement("div");
        holder.innerHTML = String(value || "");
        return (holder.textContent || holder.innerText || "").trim();
    }

    function sanitizeInlineStyle(styleValue) {
        if (!styleValue) return "";

        var safe = [];
        String(styleValue).split(";").forEach(function (rule) {
            var parts = rule.split(":");
            if (parts.length < 2) return;

            var prop = String(parts[0] || "").trim().toLowerCase();
            var value = String(parts.slice(1).join(":") || "").trim();

            if (!prop || !value) return;

            if (prop === "color" && (/^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(value))) {
                safe.push("color: " + value);
            }

            if (prop === "font-size" && /^(?:\d{1,2}|\d{1,2}\.\d)(?:px|em|rem|%)$/i.test(value)) {
                safe.push("font-size: " + value);
            }

            if (prop === "text-decoration" && /^(none|underline|line-through)$/i.test(value)) {
                safe.push("text-decoration: " + value.toLowerCase());
            }

            if (prop === "font-weight" && /^(normal|bold|[1-9]00)$/i.test(value)) {
                safe.push("font-weight: " + value.toLowerCase());
            }

            if (prop === "font-style" && /^(normal|italic)$/i.test(value)) {
                safe.push("font-style: " + value.toLowerCase());
            }
        });

        return safe.join("; ");
    }

    function sanitizeRichDescription(html) {
        if (!html) return "";

        var template = document.createElement("template");
        template.innerHTML = String(html);

        var allowed = {
            B: true, STRONG: true, I: true, EM: true, U: true,
            BR: true, P: true, DIV: true, SPAN: true,
            UL: true, OL: true, LI: true, FONT: true
        };

        function walk(node) {
            var children = Array.prototype.slice.call(node.childNodes || []);
            children.forEach(function (child) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    var tag = child.tagName;
                    if (!allowed[tag]) {
                        var replacement = document.createTextNode(child.textContent || "");
                        node.replaceChild(replacement, child);
                        return;
                    }

                    Array.prototype.slice.call(child.attributes || []).forEach(function (attr) {
                        var name = String(attr.name || "").toLowerCase();

                        if (tag === "FONT" && (name === "size" || name === "color")) {
                            return;
                        }

                        if (name !== "style") {
                            child.removeAttribute(attr.name);
                        }
                    });

                    if (child.hasAttribute("style")) {
                        var safeStyle = sanitizeInlineStyle(child.getAttribute("style"));
                        if (safeStyle) child.setAttribute("style", safeStyle);
                        else child.removeAttribute("style");
                    }

                    if (tag === "FONT") {
                        var color = child.getAttribute("color");
                        if (color && !(/^#[0-9a-f]{3,8}$/i.test(color) || /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(color))) {
                            child.removeAttribute("color");
                        }

                        var size = child.getAttribute("size");
                        if (size && !/^[1-7]$/.test(size)) {
                            child.removeAttribute("size");
                        }
                    }

                    walk(child);
                } else if (child.nodeType !== Node.TEXT_NODE) {
                    node.removeChild(child);
                }
            });
        }

        walk(template.content);
        return template.innerHTML;
    }

    function buildDescriptionHtml(raw) {
        var source = String(raw || "").trim();
        if (!source) {
            return '<p class="text-muted mb-0">No description added yet.</p>';
        }

        if (!/<\/?[a-z][\s\S]*>/i.test(source)) {
            return '<p class="text-muted mb-0" style="white-space: pre-line;">' + escapeHtml(source) + '</p>';
        }

        var safeHtml = sanitizeRichDescription(source);
        return '<div class="text-muted mb-0 detail-description">' + safeHtml + '</div>';
    }

    function getTextTokens(value) {
        var stopwords = {
            "the": true, "and": true, "with": true, "for": true, "you": true,
            "this": true, "that": true, "are": true, "from": true, "your": true,
            "item": true, "product": true, "new": true, "best": true,
            "এ�•�Ÿি": true, "এব�‚": true, "�œন্য": true, "পণ্য": true, "নতুন": true
        };

        var text = normalizeText(value);
        if (!text) return [];

        return text.split(" ").filter(function (token) {
            return token.length >= 2 && !stopwords[token];
        });
    }

    function toTokenSet(tokens) {
        var set = {};
        (tokens || []).forEach(function (token) {
            set[token] = true;
        });
        return set;
    }

    function countTokenOverlap(aSet, bTokens) {
        var count = 0;
        (bTokens || []).forEach(function (token) {
            if (aSet[token]) count += 1;
        });
        return count;
    }

    function scoreRelatedProduct(current, candidate, store) {
        var score = 0;

        // Strong primary signal when categories match.
        if (String(current.categoryId || "") && String(current.categoryId) === String(candidate.categoryId || "")) {
            score += 70;
        }

        var currentCategoryName = getCategoryName(current.categoryId, store);
        var candidateCategoryName = getCategoryName(candidate.categoryId, store);
        if (normalizeText(currentCategoryName) && normalizeText(currentCategoryName) === normalizeText(candidateCategoryName)) {
            score += 20;
        }

        var currentTokens = getTextTokens((current.name || "") + " " + stripHtml(current.description || "") + " " + currentCategoryName);
        var candidateTokens = getTextTokens((candidate.name || "") + " " + stripHtml(candidate.description || "") + " " + candidateCategoryName);
        var currentSet = toTokenSet(currentTokens);
        var overlap = countTokenOverlap(currentSet, candidateTokens);
        score += Math.min(45, overlap * 9);

        var currentPrice = Number(current.price || 0);
        var candidatePrice = Number(candidate.price || 0);
        if (currentPrice > 0 && candidatePrice > 0) {
            var distanceRatio = Math.abs(currentPrice - candidatePrice) / currentPrice;
            if (distanceRatio <= 0.1) score += 20;
            else if (distanceRatio <= 0.25) score += 14;
            else if (distanceRatio <= 0.5) score += 8;
            else if (distanceRatio <= 1) score += 3;
        }

        if ((current.isNew === true) === (candidate.isNew === true)) {
            score += 6;
        }

        // Slight boost for manually prioritized products.
        var sortOrder = Number(candidate.sortOrder || 0);
        if (sortOrder > 0) {
            score += Math.max(0, 6 - Math.min(5, sortOrder - 1));
        }

        return score;
    }

    function getRelatedProducts(current, store) {
        var source = (store.products || []).filter(function (p) {
            return p && p.isActive !== false && String(p.id) !== String(current.id);
        });

        var scored = source.map(function (candidate) {
            return {
                product: candidate,
                score: scoreRelatedProduct(current, candidate, store)
            };
        });

        scored.sort(function (a, b) {
            if (b.score !== a.score) return b.score - a.score;

            var as = Number(a.product.sortOrder || 0);
            var bs = Number(b.product.sortOrder || 0);
            if (as !== bs) return as - bs;

            return String(a.product.name || "").localeCompare(String(b.product.name || ""));
        });

        var strong = scored.filter(function (x) { return x.score >= 18; }).slice(0, 6).map(function (x) { return x.product; });
        if (strong.length >= 4) return strong;

        // Fallback: keep best-ranked candidates even if metadata quality is weak.
        return scored.slice(0, 6).map(function (x) { return x.product; });
    }

    function renderRelatedProducts(current, store) {
        var related = getRelatedProducts(current, store);

        var box = document.getElementById("relatedProducts");
        if (!box) return;

        if (!related.length) {
            box.innerHTML = '<div class="text-muted">No related products found.</div>';
            return;
        }

        box.innerHTML = related.map(function (p) {
            var image = p.coverImage || p.image || "https://via.placeholder.com/320x320?text=Product";
            return [
                '<a class="related-card" href="product-details.html?id=' + encodeURIComponent(p.id) + '">',
                '  <img src="' + escapeHtml(image) + '" alt="' + escapeHtml(p.name || "Product") + '">',
                '  <h6>' + escapeHtml(p.name || "Product") + '</h6>',
                '  <div><strong>৳ ' + formatMoney(Number(p.price || 0)) + '</strong></div>',
                '</a>'
            ].join("");
        }).join("");
    }

    function renderProduct(product, store) {
        var root = document.getElementById("productDetailRoot");
        if (!root) return;

        var gallery = normalizeGallery(product);
        var cover = gallery[0];
        var oldPrice = Number(product.oldPrice || 0);
        var price = Number(product.price || 0);
        var categoryName = getCategoryName(product.categoryId, store);
        var contactNumber = "01843912510";
        var whatsappPhone = "8801843912510";
        var messengerLink = "https://www.messenger.com/t/1102809406238402";
        var whatsappMessage = encodeURIComponent("Assalamu Alaikum, I want to know about: " + String(product.name || "this product"));
        var whatsappLink = "https://wa.me/" + whatsappPhone + "?text=" + whatsappMessage;
        var hotlineLink = "tel:" + contactNumber;

        root.innerHTML = [
            '<div class="row">',
            '  <div class="col-lg-6 mb-3 mb-lg-0">',
            '    <div class="detail-image-stage" id="detailImageStage">',
            '      <img id="mainDetailImage" class="main-photo" src="' + escapeHtml(cover) + '" alt="' + escapeHtml(product.name || "Product") + '">',
            '      <button type="button" id="detailPrev" class="detail-slider-btn" aria-label="Previous image"><i class="fas fa-chevron-left"></i></button>',
            '      <button type="button" id="detailNext" class="detail-slider-btn" aria-label="Next image"><i class="fas fa-chevron-right"></i></button>',
            '      <div id="detailSliderDots" class="detail-slider-dots"></div>',
            '    </div>',
            '    <div class="thumb-list">',
                    gallery.map(function (src, idx) {
                        return '<img class="thumb-item ' + (idx === 0 ? 'active' : '') + '" data-index="' + idx + '" data-src="' + escapeHtml(src) + '" src="' + escapeHtml(src) + '" alt="thumb ' + (idx + 1) + '">';
                    }).join(''),
            '    </div>',
            '  </div>',
            '  <div class="col-lg-6">',
            '    <h2>' + escapeHtml(product.name || "Product") + '</h2>',
            '    <div class="price-line">',
            '      <span class="price-now">৳ ' + formatMoney(price) + '</span>',
            oldPrice > price ? ('      <span class="price-old">৳ ' + formatMoney(oldPrice) + '</span>') : '',
            '    </div>',
            '    <div class="mb-2"><span class="badge badge-primary">' + escapeHtml(categoryName) + '</span></div>',
            '    ' + buildDescriptionHtml(product.description),
            '    <div class="d-flex align-items-center" style="gap:10px;">',
            '      <strong>Qty:</strong>',
            '      <div class="qty-wrap">',
            '        <button id="qtyMinus" type="button">-</button>',
            '        <input id="detailQty" type="text" value="1" readonly>',
            '        <button id="qtyPlus" type="button">+</button>',
            '      </div>',
            '    </div>',
            '    <div class="cta-row" style="display: flex; gap: 10px; margin-top: 12px; width: 100%;">',
            '      <button id="orderNowBtn" type="button" style="flex: 1; min-width: 0; background: #fff; color: #f85606; border: 2px solid #f85606; font-weight: 700; padding: 12px 20px; border-radius: 8px; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.3s ease;"><i class="fas fa-bolt"></i> Order Now</button>',
            '      <button id="addDetailToCart" type="button" style="flex: 1; min-width: 0; background: linear-gradient(135deg, #f85606 0%, #ff6b35 100%); color: #fff; border: none; font-weight: 700; padding: 12px 20px; border-radius: 8px; font-size: 15px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.3s ease;"><i class="fas fa-cart-plus"></i> Add To Cart</button>',
            '    </div>',
            '    <div class="contact-cta-row">',
            '      <a href="' + escapeHtml(messengerLink) + '" target="_blank" rel="noopener noreferrer" class="contact-cta contact-cta--messenger"><i class="fab fa-facebook-messenger"></i> Click to Message</a>',
            '      <a href="' + escapeHtml(whatsappLink) + '" target="_blank" rel="noopener noreferrer" class="contact-cta contact-cta--whatsapp"><i class="fab fa-whatsapp"></i> WhatsApp Message</a>',
            '      <a href="' + escapeHtml(hotlineLink) + '" class="contact-cta contact-cta--hotline"><i class="fas fa-phone-alt"></i> Hotline</a>',
            '    </div>',
            '    <div class="contact-note">WhatsApp & Hotline: ' + escapeHtml(contactNumber) + '</div>',
            '  </div>',
            '</div>'
        ].join("\n");

        var reviewsSection = document.getElementById("productReviewsSection");
        if (reviewsSection) reviewsSection.style.display = "block";

        initGallery(gallery);

        renderReviewList(product.id, store);
        renderRelatedProducts(product, store);
    }

    async function initPage() {
        var store = readStoreRaw();
        var productId = getProductIdFromUrl();
        if (!productId) {
            renderNotFound();
            return;
        }

        var product = (store.products || []).find(function (p) {
            return String(p.id) === String(productId) && p.isActive !== false;
        });

        if (!product) {
            renderNotFound();
        } else {
            activeProduct = product;
            renderProduct(product, store);
        }

        pullStoreFromCloud().then(function () {
            return startCloudStoreListener();
        }).then(function () {
            var freshStore = readStoreRaw();
            var freshProduct = (freshStore.products || []).find(function (p) {
                return String(p.id) === String(productId) && p.isActive !== false;
            });

            if (freshProduct && activeProduct && String(freshProduct.updatedAt || freshProduct.id || '') !== String(activeProduct.updatedAt || activeProduct.id || '')) {
                activeProduct = freshProduct;
                renderProduct(freshProduct, freshStore);
            }
        }).catch(function () {});
    }

    bindDetailEvents();
    bindReviewFormEvents();
    initPage();
})();

