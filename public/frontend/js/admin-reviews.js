$(document).ready(async function() {
    function getReviewsView() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            const view = String(params.get('view') || 'all').toLowerCase();
            return ['all', 'create', 'pending'].includes(view) ? view : 'all';
        } catch (err) {
            return 'all';
        }
    }

    const currentView = getReviewsView();
    let activeDateRange = null;

    if (!AdminStore.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    const $status = $('#statusMessage');
    let cloudReviewUnsubscribe = null;

    setupViewMode();
    setupDateRangeFilter();
    loadProductOptions();
    loadReviews();
    setupEvents();
    startLiveReviewListener();

    // Apply UI instantly from local state, then refresh from cloud in background.
    AdminStore.syncFromCloud().then(() => {
        loadProductOptions();
        loadReviews();
    }).catch((err) => {
        console.warn('Background cloud sync failed for reviews page.', err);
    });

    function setupViewMode() {
        const map = {
            all: {
                title: 'All Reviews',
                subtitle: 'See all customer and admin reviews in one place.',
                showCreate: false,
                showPending: false,
                showAll: true
            },
            create: {
                title: 'Create Review',
                subtitle: 'Create and publish reviews directly from admin panel.',
                showCreate: true,
                showPending: false,
                showAll: false
            },
            pending: {
                title: 'Pending Reviews',
                subtitle: 'Approve or reject customer reviews that are waiting for moderation.',
                showCreate: false,
                showPending: true,
                showAll: false
            }
        };

        const cfg = map[currentView] || map.all;
        $('#reviewsPageTitle').text(cfg.title);
        $('#reviewsPageSubtitle').text(cfg.subtitle);

        $('#createReviewCard').toggle(cfg.showCreate);
        $('#pendingReviewsCard').toggle(cfg.showPending);
        $('#allReviewsCard').toggle(cfg.showAll);
    }

    function compressImageFile(file, maxDimension = 900, quality = 0.72) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read image file'));
            reader.onload = (e) => {
                const img = new Image();
                img.onerror = () => reject(new Error('Invalid image file'));
                img.onload = () => {
                    const ratio = Math.min(1, maxDimension / Math.max(img.width, img.height));
                    const width = Math.max(1, Math.round(img.width * ratio));
                    const height = Math.max(1, Math.round(img.height * ratio));

                    const canvas = document.createElement('canvas');
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    let q = quality;
                    let output = canvas.toDataURL('image/jpeg', q);
                    while (output.length > 220000 && q > 0.45) {
                        q -= 0.07;
                        output = canvas.toDataURL('image/jpeg', q);
                    }
                    resolve(output);
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        });
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getProductsMap() {
        const map = {};
        AdminStore.getProducts().forEach(product => {
            map[String(product.id)] = product;
        });
        return map;
    }

    function getStars(rating) {
        const r = Math.max(1, Math.min(5, Number(rating || 0)));
        return '★'.repeat(r) + '☆'.repeat(5 - r);
    }

    function formatDate(ts) {
        const date = new Date(Number(ts || Date.now()));
        return date.toLocaleString();
    }

    function inDateRange(ts) {
        if (!activeDateRange || !activeDateRange.startDate || !activeDateRange.endDate) return true;
        const value = Number(ts || 0);
        if (!Number.isFinite(value) || value <= 0) return false;

        const start = new Date(
            activeDateRange.startDate.getFullYear(),
            activeDateRange.startDate.getMonth(),
            activeDateRange.startDate.getDate(),
            0, 0, 0, 0
        ).getTime();
        const end = new Date(
            activeDateRange.endDate.getFullYear(),
            activeDateRange.endDate.getMonth(),
            activeDateRange.endDate.getDate(),
            23, 59, 59, 999
        ).getTime();

        return value >= start && value <= end;
    }

    function setupDateRangeFilter() {
        if (typeof window.createD2WDateRangeFilter !== 'function') return;

        window.createD2WDateRangeFilter({
            defaultPresetDays: 30,
            onRangeChange: function(startDate, endDate) {
                if (startDate instanceof Date && endDate instanceof Date) {
                    activeDateRange = {
                        startDate: new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()),
                        endDate: new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
                    };
                } else {
                    activeDateRange = null;
                }

                loadReviews();
            }
        });
    }

    function getReviewImages() {
        try {
            const parsed = JSON.parse($('#reviewImages').val() || '[]');
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (err) {
            return [];
        }
    }

    function setReviewImages(images) {
        $('#reviewImages').val(JSON.stringify(Array.isArray(images) ? images : []));
        renderReviewImagePreview();
    }

    function renderReviewImagePreview() {
        const images = getReviewImages();
        const $preview = $('#reviewImagePreview');
        if (!images.length) {
            $preview.hide().empty();
            return;
        }

        const html = images.map((src, idx) => `
            <div style="position: relative;">
                <img src="${src}" alt="Review ${idx + 1}">
                <button type="button" class="btn btn-sm btn-danger remove-review-image" data-index="${idx}" style="position:absolute;top:-8px;right:-8px;line-height:1;padding:1px 6px;">&times;</button>
            </div>
        `).join('');

        $preview.html(html).css('display', 'flex');
    }

    function loadProductOptions() {
        const products = AdminStore.getProducts().filter(p => p.isActive !== false);
        const options = ['<option value="">Select product</option>']
            .concat(products.map(p => `<option value="${p.id}">${escapeHtml(p.name || 'Product')}</option>`));
        $('#reviewProductId').html(options.join(''));
    }

    function renderReviewRow(review, productsMap, allowActions, idx) {
        const product = productsMap[String(review.productId)] || {};
        const images = Array.isArray(review.images) ? review.images : [];
        const statusClass = review.status === 'approved' ? 'badge-approved' : review.status === 'rejected' ? 'badge-rejected' : 'badge-pending';
        const preview = String(review.text || '').trim();
        const shortText = preview.length > 110 ? `${preview.slice(0, 110)}...` : preview;
        const thumb = images.length ? `<img src="${images[0]}" alt="Review image" style="width:30px;height:30px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;">` : '<span class="text-muted">-</span>';

        return `
            <tr>
                <td>${idx + 1}</td>
                <td style="min-width:170px;">
                    <div style="font-weight:600;">${escapeHtml(review.authorName || 'Anonymous')}</div>
                    <div class="text-muted" style="font-size:11px;">${escapeHtml(review.source || 'customer')}</div>
                </td>
                <td style="min-width:220px;">${escapeHtml(product.name || 'Unknown Product')}</td>
                <td><span class="review-stars">${getStars(review.rating)}</span></td>
                <td style="min-width:280px;">${escapeHtml(shortText || '-')}</td>
                <td class="text-center">${thumb}</td>
                <td>${escapeHtml(formatDate(review.createdAt))}</td>
                <td><span class="badge ${statusClass}">${escapeHtml(review.status || 'pending')}</span></td>
                <td>
                    ${allowActions ? `
                        <div class="d-flex align-items-center" style="gap:6px;">
                            <button class="btn btn-success btn-sm approve-review" data-id="${review.id}" title="Approve"><i class="fas fa-check"></i></button>
                            <button class="btn btn-outline-danger btn-sm reject-review" data-id="${review.id}" title="Reject"><i class="fas fa-times"></i></button>
                            <button class="btn btn-outline-secondary btn-sm delete-review" data-id="${review.id}" title="Delete"><i class="fas fa-trash"></i></button>
                        </div>
                    ` : '<span class="text-muted">-</span>'}
                </td>
            </tr>
        `;
    }

    function renderReviewsTable(reviews, productsMap, allowActions) {
        if (!reviews.length) {
            return '<div class="text-muted">No reviews found yet.</div>';
        }

        const rows = reviews.map((review, idx) => renderReviewRow(review, productsMap, allowActions, idx)).join('');
        return `
            <div class="table-responsive admin-table-wrap">
                <table class="table table-hover table-bordered mb-0 admin-record-table">
                    <thead>
                        <tr>
                            <th>SL</th>
                            <th>Customer</th>
                            <th>Product</th>
                            <th>Rating</th>
                            <th>Review</th>
                            <th>Image</th>
                            <th>Time</th>
                            <th>Status</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function loadReviews() {
        const reviews = AdminStore.getReviews()
            .slice()
            .filter(r => inDateRange(r.createdAt))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
        const productsMap = getProductsMap();

        const pending = reviews.filter(r => String(r.status) === 'pending');
        const all = reviews;

        $('#pendingCount').text(pending.length);

        if (!pending.length) {
            $('#pendingReviewsList').html('<div class="text-muted">No pending customer reviews.</div>');
        } else {
            $('#pendingReviewsList').html(renderReviewsTable(pending, productsMap, true));
        }

        if (!all.length) {
            $('#allReviewsList').html('<div class="text-muted">No reviews found yet.</div>');
        } else {
            $('#allReviewsList').html(renderReviewsTable(all, productsMap, true));
        }
    }

    async function startLiveReviewListener() {
        try {
            const ready = await AdminStore.ensureCloudReady();
            if (!ready || cloudReviewUnsubscribe) return;

            const ref = AdminStore.getCloudDocRef();
            if (!ref) return;

            cloudReviewUnsubscribe = ref.onSnapshot((snap) => {
                if (!snap || !snap.exists) return;

                const payload = snap.data() || {};
                const cloudStore = AdminStore.normalizeStoreShape(payload.store || {});
                localStorage.setItem(AdminStore.STORE_KEY, JSON.stringify(cloudStore));
                loadProductOptions();
                loadReviews();
            }, (err) => {
                console.warn('Live review listener failed.', err);
            });
        } catch (err) {
            console.warn('Unable to start live review listener.', err);
        }
    }

    function setupEvents() {
        $(document).on('click', '#uploadReviewImagesBtn', async function() {
            const input = document.getElementById('reviewImageFiles');
            const files = input && input.files ? Array.from(input.files) : [];
            if (!files.length) {
                showStatus('Please select image files first.', 'warning');
                return;
            }

            const current = getReviewImages();
            const uploaded = [];

            for (const file of files) {
                try {
                    const data = await compressImageFile(file);
                    uploaded.push(data);
                } catch (err) {
                    console.warn('Skipping invalid review image file', err);
                }
            }

            setReviewImages(current.concat(uploaded));
            if (input) input.value = '';
            showStatus('Review images uploaded.', 'success');
        });

        $(document).on('click', '.remove-review-image', function() {
            const idx = parseInt($(this).data('index'), 10);
            const images = getReviewImages();
            if (Number.isInteger(idx) && idx >= 0 && idx < images.length) {
                images.splice(idx, 1);
                setReviewImages(images);
            }
        });

        $('#adminReviewForm').on('submit', function(e) {
            e.preventDefault();

            const productId = String($('#reviewProductId').val() || '').trim();
            const authorName = String($('#reviewAuthor').val() || '').trim();
            const text = String($('#reviewText').val() || '').trim();
            const rating = Number($('#reviewRating').val() || 5);
            const images = getReviewImages();

            if (!productId || !authorName || !text) {
                showStatus('Product, customer name, and review text are required.', 'danger');
                return;
            }

            AdminStore.addReview({
                productId,
                authorName,
                rating,
                text,
                images,
                status: 'approved',
                source: 'admin'
            });

            this.reset();
            setReviewImages([]);
            loadReviews();
            showStatus('Review published successfully.', 'success');

            if (currentView === 'create') {
                $('#reviewProductId').focus();
            }
        });

        $(document).on('click', '.approve-review', function() {
            const id = $(this).data('id');
            AdminStore.updateReview(id, { status: 'approved' });
            loadReviews();
            showStatus('Review approved.', 'success');
        });

        $(document).on('click', '.reject-review', function() {
            const id = $(this).data('id');
            AdminStore.updateReview(id, { status: 'rejected' });
            loadReviews();
            showStatus('Review rejected.', 'info');
        });

        $(document).on('click', '.delete-review', function() {
            const id = $(this).data('id');
            if (!confirm('Delete this review permanently?')) return;
            AdminStore.deleteReview(id);
            loadReviews();
            showStatus('Review deleted.', 'info');
        });

        $(document).on('click', '#logoutBtn', function() {
            if (confirm('Logout from admin panel?')) {
                AdminStore.clearSession();
                    window.location.href = 'login.html?logout=1';
            }
        });

        window.addEventListener('storage', function(event) {
            if (event.key === AdminStore.STORE_KEY) {
                loadProductOptions();
                loadReviews();
            }
        });
    }

    function showStatus(message, type) {
        $status
            .removeClass('d-none')
            .removeClass('alert-success alert-danger alert-info alert-warning')
            .addClass('alert-' + type)
            .text(message)
            .fadeIn();

        if (type === 'success' || type === 'info') {
            setTimeout(() => $status.fadeOut().addClass('d-none'), 2500);
        }
    }
});
