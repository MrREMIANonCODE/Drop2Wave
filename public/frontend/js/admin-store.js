/**
 * Admin Store Utility - Shared local storage management
 * Handles store CRUD operations, cloud sync, and session management
 */

const AdminStore = {
    STORE_KEY: 'drop2wave_store_v1',
    SESSION_KEY: 'drop2wave_admin_session',
    LEGACY_SESSION_KEYS: [
        'drop2wave_admin_auth',
        'drop2wave_auth_session',
        'admin_session',
        'adminAuth'
    ],
    CLOUD_COLLECTION: 'drop2wave',
    CLOUD_DOCUMENT: 'store',
    FIREBASE_CONFIG: {
        apiKey: 'AIzaSyBkOvOhYO1o1fUW0DtRns5VLirbRO5EsWA',
        authDomain: 'drop2wavefirebase.firebaseapp.com',
        projectId: 'drop2wavefirebase',
        storageBucket: 'drop2wavefirebase.firebasestorage.app',
        messagingSenderId: '296193741264'
    },
    _cloudInitPromise: null,
    _cloudEnabled: false,
    
    // Initialize store with defaults
    ensureStore() {
        if (!localStorage.getItem(this.STORE_KEY)) {
            localStorage.setItem(this.STORE_KEY, JSON.stringify({
                categories: [
                    { id: 'cat1', slug: 'kitchen-item', name: 'Kitchen Item', image: '' },
                    { id: 'cat2', slug: 'crossbody-fashion-bag', name: 'Crossbody Fashion Bag', image: '' },
                    { id: 'cat3', slug: 'islamic-item', name: 'Islamic Item', image: '' },
                    { id: 'cat4', slug: 'hot-offer', name: 'Hot Offer', image: '' },
                    { id: 'cat5', slug: 'ems-therapy-machine', name: 'EMS Therapy Machine', image: '' },
                    { id: 'cat6', slug: 'man-watches', name: 'Man Watches', image: '' },
                    { id: 'cat7', slug: 'home-living', name: 'Home Living', image: '' }
                ],
                products: [],
                reviews: []
            }));
        }
    },
    
    // Get entire store object
    getStore() {
        this.ensureStore();
        const store = localStorage.getItem(this.STORE_KEY);
        return this.normalizeStoreShape(store ? JSON.parse(store) : { categories: [], products: [], reviews: [] });
    },
    
    // Save store object
    saveStore(store) {
        const nextStore = this.normalizeStoreShape(store);
        nextStore.updatedAt = Date.now();
        localStorage.setItem(this.STORE_KEY, JSON.stringify(nextStore));

        // Keep cloud in sync for global, cross-browser updates.
        this.syncToCloud().catch(err => {
            console.warn('Cloud sync failed. Local data saved only.', err);
        });
    },

    normalizeStoreShape(store) {
        const normalized = store && typeof store === 'object' ? store : {};
        if (!Array.isArray(normalized.categories)) normalized.categories = [];
        if (!Array.isArray(normalized.products)) normalized.products = [];
        if (!Array.isArray(normalized.reviews)) normalized.reviews = [];
        return normalized;
    },

    getStoreTimestamp(store) {
        const raw = store && store.updatedAt;
        if (!raw) return 0;
        if (typeof raw === 'number') return raw;
        if (raw && typeof raw.toMillis === 'function') return raw.toMillis();
        if (raw && typeof raw.seconds === 'number') {
            return (raw.seconds * 1000) + Math.round((raw.nanoseconds || 0) / 1000000);
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : 0;
    },

    hasMeaningfulStoreData(store) {
        const normalized = this.normalizeStoreShape(store);
        return normalized.categories.length > 0 || normalized.products.length > 0 || normalized.reviews.length > 0;
    },

    shouldPreferCloudStore(localStore, cloudStore) {
        const local = this.normalizeStoreShape(localStore);
        const cloud = this.normalizeStoreShape(cloudStore);
        const localUpdatedAt = this.getStoreTimestamp(local);
        const cloudUpdatedAt = this.getStoreTimestamp(cloud);

        if (localUpdatedAt > 0 && cloudUpdatedAt > 0) {
            return cloudUpdatedAt >= localUpdatedAt;
        }

        if (!this.hasMeaningfulStoreData(cloud)) {
            return false;
        }

        if (
            cloud.categories.length < local.categories.length ||
            cloud.products.length < local.products.length ||
            cloud.reviews.length < local.reviews.length
        ) {
            return false;
        }

        return true;
    },

    isDataUrl(value) {
        return typeof value === 'string' && /^data:image\//i.test(value.trim());
    },

    sanitizeStoreForCloud(store) {
        const normalized = this.normalizeStoreShape(store);

        const categories = (normalized.categories || []).map(cat => {
            const next = { ...cat };
            if (this.isDataUrl(next.image)) next.image = '';
            return next;
        });

        const products = (normalized.products || []).map(prod => {
            const next = { ...prod };
            if (this.isDataUrl(next.image)) next.image = '';
            if (this.isDataUrl(next.coverImage)) next.coverImage = '';
            if (Array.isArray(next.galleryImages)) {
                next.galleryImages = next.galleryImages.filter(img => !this.isDataUrl(img));
            }
            return next;
        });

        const reviews = (normalized.reviews || []).map(review => {
            const next = { ...review };
            if (Array.isArray(next.images)) {
                next.images = next.images.filter(img => !this.isDataUrl(img));
            }
            return next;
        });

        return {
            ...normalized,
            categories,
            products,
            reviews
        };
    },

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector('script[data-d2w-src="' + src + '"]');
            if (existing) {
                if (existing.dataset.loaded === '1') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error('Script load failed: ' + src)), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.dataset.d2wSrc = src;
            script.onload = () => {
                script.dataset.loaded = '1';
                resolve();
            };
            script.onerror = () => reject(new Error('Script load failed: ' + src));
            document.head.appendChild(script);
        });
    },

    async ensureCloudReady() {
        if (this._cloudEnabled) return true;
        if (this._cloudInitPromise) return this._cloudInitPromise;

        this._cloudInitPromise = (async () => {
            try {
                await this.loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
                await this.loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');

                if (!window.firebase) {
                    throw new Error('Firebase SDK not available');
                }

                // Initialize explicitly so this works on any host (Firebase Hosting, Hostinger, etc.).
                if (!window.firebase.apps || window.firebase.apps.length === 0) {
                    window.firebase.initializeApp(this.FIREBASE_CONFIG);
                }

                const hasApp = window.firebase.apps && window.firebase.apps.length > 0;
                if (!hasApp) {
                    throw new Error('Firebase app is not initialized');
                }

                // Ensure Firestore service is ready.
                window.firebase.firestore();
                this._cloudEnabled = true;
                return true;
            } catch (err) {
                console.warn('Cloud mode unavailable; running in local mode.', err);
                this._cloudEnabled = false;
                return false;
            }
        })();

        return this._cloudInitPromise;
    },

    getCloudDocRef() {
        if (!window.firebase || !window.firebase.firestore) return null;
        const db = window.firebase.firestore();
        return db.collection(this.CLOUD_COLLECTION).doc(this.CLOUD_DOCUMENT);
    },

    async syncFromCloud() {
        const ready = await this.ensureCloudReady();
        if (!ready) return false;

        const ref = this.getCloudDocRef();
        if (!ref) return false;

        try {
            const snap = await ref.get();
            if (!snap.exists) return false;

            const payload = snap.data() || {};
            const cloudStore = this.normalizeStoreShape(payload.store || {});
            const localStore = this.getStore();

            if (!this.shouldPreferCloudStore(localStore, cloudStore)) {
                return false;
            }

            localStorage.setItem(this.STORE_KEY, JSON.stringify(cloudStore));
            return true;
        } catch (err) {
            console.warn('Failed to pull store from cloud.', err);
            return false;
        }
    },

    async syncToCloud() {
        const ready = await this.ensureCloudReady();
        if (!ready) return false;

        const ref = this.getCloudDocRef();
        if (!ref) return false;

        const store = this.normalizeStoreShape(this.getStore());

        try {
            await ref.set({
                store,
                updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            return true;
        } catch (err) {
            const sanitizedStore = this.sanitizeStoreForCloud(store);

            try {
                await ref.set({
                    store: sanitizedStore,
                    updatedAt: window.firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                console.warn('Cloud sync used sanitized payload (inline base64 images removed).');
                return true;
            } catch (retryErr) {
                console.warn('Failed to push store to cloud.', retryErr);
                return false;
            }
        }
    },
    
    // ===================
    // CATEGORY OPERATIONS
    // ===================
    
    getCategories() {
        return this.getStore().categories || [];
    },
    
    addCategory(category) {
        const store = this.getStore();
        category.id = category.id || 'cat_' + Date.now();
        category.updatedAt = Date.now();
        if (!store.categories) store.categories = [];
        store.categories.push(category);
        this.saveStore(store);
        return category;
    },
    
    updateCategory(id, updates) {
        const store = this.getStore();
        const index = store.categories.findIndex(c => c.id === id);
        if (index !== -1) {
            store.categories[index] = { ...store.categories[index], ...updates, updatedAt: Date.now() };
            this.saveStore(store);
        }
        return store.categories[index];
    },
    
    deleteCategory(id) {
        const store = this.getStore();
        store.categories = store.categories.filter(c => c.id !== id);
        this.saveStore(store);
    },
    
    // ===================
    // PRODUCT OPERATIONS
    // ===================
    
    getProducts() {
        return this.getStore().products || [];
    },
    
    addProduct(product) {
        const store = this.getStore();
        product.id = product.id || 'prod_' + Date.now();
        product.updatedAt = Date.now();
        if (!store.products) store.products = [];
        store.products.push(product);
        this.saveStore(store);
        return product;
    },
    
    updateProduct(id, updates) {
        const store = this.getStore();
        const index = store.products.findIndex(p => p.id === id);
        if (index !== -1) {
            store.products[index] = { ...store.products[index], ...updates, updatedAt: Date.now() };
            this.saveStore(store);
        }
        return store.products[index];
    },
    
    deleteProduct(id) {
        const store = this.getStore();
        store.products = store.products.filter(p => p.id !== id);
        this.saveStore(store);
    },
    
    deleteMultipleProducts(ids) {
        const store = this.getStore();
        store.products = store.products.filter(p => !ids.includes(p.id));
        store.reviews = (store.reviews || []).filter(r => !ids.includes(r.productId));
        this.saveStore(store);
    },

    // ===================
    // REVIEW OPERATIONS
    // ===================

    getReviews() {
        return this.getStore().reviews || [];
    },

    addReview(review) {
        const store = this.getStore();
        if (!store.reviews) store.reviews = [];

        const nextReview = {
            id: review.id || ('rev_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
            productId: String(review.productId || ''),
            authorName: String(review.authorName || 'Anonymous'),
            rating: Number(review.rating || 5),
            text: String(review.text || ''),
            images: Array.isArray(review.images) ? review.images.filter(Boolean) : [],
            status: review.status || 'pending',
            source: review.source || 'customer',
            clientId: review.clientId || '',
            createdAt: review.createdAt || Date.now(),
            updatedAt: Date.now()
        };

        store.reviews.push(nextReview);
        this.saveStore(store);
        return nextReview;
    },

    updateReview(id, updates) {
        const store = this.getStore();
        const index = (store.reviews || []).findIndex(r => String(r.id) === String(id));
        if (index === -1) return null;

        store.reviews[index] = {
            ...store.reviews[index],
            ...updates,
            updatedAt: Date.now()
        };

        this.saveStore(store);
        return store.reviews[index];
    },

    deleteReview(id) {
        const store = this.getStore();
        store.reviews = (store.reviews || []).filter(r => String(r.id) !== String(id));
        this.saveStore(store);
    },
    
    // ===================
    // SESSION OPERATIONS
    // ===================
    
    createSession(username) {
        const sessionData = {
            username: username,
            timestamp: Date.now(),
            expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
        };
        localStorage.setItem(this.SESSION_KEY, JSON.stringify(sessionData));
        return sessionData;
    },
    
    getSession() {
        const session = localStorage.getItem(this.SESSION_KEY);
        if (!session) return null;
        
        const sessionData = JSON.parse(session);
        if (sessionData.expires < Date.now()) {
            this.clearSession();
            return null;
        }
        return sessionData;
    },
    
    isAuthenticated() {
        return this.getSession() !== null;
    },
    
    clearSession() {
        const keys = [this.SESSION_KEY].concat(this.LEGACY_SESSION_KEYS || []);

        keys.forEach(key => {
            try {
                localStorage.removeItem(key);
            } catch (err) {
                // Ignore storage cleanup errors.
            }

            try {
                sessionStorage.removeItem(key);
            } catch (err) {
                // Ignore storage cleanup errors.
            }
        });

        try {
            sessionStorage.setItem('drop2wave_admin_recent_logout', String(Date.now()));
        } catch (err) {
            // Ignore storage write errors.
        }
    }
};

// Ensure store is initialized on page load
AdminStore.ensureStore();
