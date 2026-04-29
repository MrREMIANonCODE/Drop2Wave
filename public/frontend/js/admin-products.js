/**
 * Admin Products Management - Split into New Products and Total Products sections
 */

$(document).ready(async function() {
    const isNestedProductsPage = window.location.pathname.toLowerCase().indexOf('/admin/products/') !== -1;
    const loginPath = isNestedProductsPage ? '../login.html' : 'login.html';

    // Check authentication
    if (!AdminStore.isAuthenticated()) {
        window.location.href = loginPath;
        return;
    }
    
    const $newProdForm = $('#newProductForm');
    const $totalProdForm = $('#totalProductForm');
    const $productForm = $('#productForm');
    const $productFormPanel = $('#productFormPanel');
    const $openProductFormBtn = $('#openProductFormBtn');
    const $closeProductFormBtn = $('#closeProductFormBtn');
    const $productSearchInput = $('#productSearchInput');
    const $status = $('#statusMessage');
    const editState = {
        productId: null,
        isNew: null
    };
    
    await AdminStore.syncFromCloud();

    loadCategoryOptions();
    loadNewProducts();
    loadTotalProducts();
    initRichTextEditors();
    setupProductPanelToggle();
    setupProductSearch();
    initEditModeFromUrl();
    if ($productForm.length) {
        setupUnifiedProductHandler();
    } else {
        setupNewProductHandler();
        setupTotalProductHandler();
    }
    setupLogout();
    startLiveStoreListener();

    function getProductSearchTerm() {
        return String($productSearchInput.val() || '').trim().toLowerCase();
    }

    function productMatchesSearch(product, searchTerm) {
        if (!searchTerm) return true;

        const haystack = [
            product.name,
            product.id,
            product.categoryId,
            getCategoryNameById(product.categoryId),
            product.productUrl,
            product.brand,
            product.slug,
            product.sku,
            product.description,
            product.price,
            product.oldPrice,
            product.sortOrder,
            product.stock,
            product.quantity
        ].map(value => String(value || '').toLowerCase()).join(' ');

        return haystack.includes(searchTerm);
    }

    function setupProductPanelToggle() {
        if (!$productFormPanel.length) return;

        const setPanelState = (isOpen) => {
            $productFormPanel.toggleClass('d-none', !isOpen);
            $openProductFormBtn.attr('aria-expanded', String(isOpen));
            if (isOpen) {
                const firstField = $productFormPanel.find('input, select, textarea').filter(':visible').first();
                window.requestAnimationFrame(() => {
                    $productFormPanel[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
                    if (firstField.length) firstField.trigger('focus');
                });
            }
        };

        $(document).on('click', '#openProductFormBtn', function() {
            setPanelState(true);
        });

        $(document).on('click', '#closeProductFormBtn', function() {
            setPanelState(false);
        });

        if (window.location.hash === '#newProductForm' || window.location.hash === '#totalProductForm') {
            setPanelState(true);
        }
    }

    function setupProductSearch() {
        if (!$productSearchInput.length) return;

        $(document).on('input', '#productSearchInput', function() {
            loadNewProducts();
            loadTotalProducts();
        });
    }

    async function startLiveStoreListener() {
        try {
            const ready = await AdminStore.ensureCloudReady();
            if (!ready) return;

            const ref = AdminStore.getCloudDocRef();
            if (!ref) return;

            ref.onSnapshot((snap) => {
                if (!snap || !snap.exists) return;
                const payload = snap.data() || {};
                const cloudStore = AdminStore.normalizeStoreShape(payload.store || {});
                const localStore = AdminStore.getStore();

                // Prevent stale/empty cloud snapshots from wiping current products.
                if (!AdminStore.shouldPreferCloudStore(localStore, cloudStore)) {
                    // If local is newer, push it back so cloud catches up.
                    if (AdminStore.hasMeaningfulStoreData(localStore)) {
                        AdminStore.syncToCloud().catch(() => {});
                    }
                    return;
                }

                localStorage.setItem(AdminStore.STORE_KEY, JSON.stringify(cloudStore));
                loadCategoryOptions();
                loadNewProducts();
                loadTotalProducts();
            }, (err) => {
                console.warn('Live product listener failed.', err);
            });
        } catch (err) {
            console.warn('Unable to start live product listener.', err);
        }
    }

    function isQuotaExceededError(err) {
        if (!err) return false;
        const name = String(err.name || '');
        const message = String(err.message || '');
        return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED' || message.includes('exceeded the quota');
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
                    // Keep image reasonably small for localStorage.
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

    function normalizeOptionalUrl(rawUrl) {
        const value = String(rawUrl || '').trim();
        if (!value) return '';

        // Accept full URLs or auto-prefix hostnames for admin convenience.
        const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
        try {
            const parsed = new URL(withProtocol);
            return parsed.href;
        } catch (err) {
            return null;
        }
    }

    function cleanEditorHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = String(html || '');

        template.content.querySelectorAll('script,style').forEach(node => node.remove());
        template.content.querySelectorAll('*').forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (/^on/i.test(attr.name)) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        return template.innerHTML.trim();
    }

    function syncEditorToHidden(editorEl) {
        const $wrap = $(editorEl).closest('.d2w-editor-wrap');
        const targetSelector = String($wrap.data('target') || '');
        if (!targetSelector) return;

        const html = cleanEditorHtml(editorEl.innerHTML);
        $(targetSelector).val(html);
    }

    function setEditorHtmlByTarget(targetSelector, html) {
        const $editor = $(`.d2w-editor-wrap[data-target="${targetSelector}"] .d2w-editor-content`);
        if (!$editor.length) return;

        $editor.html(cleanEditorHtml(html || ''));
        $(targetSelector).val(cleanEditorHtml(html || ''));
    }

    function initRichTextEditors() {
        $('.d2w-editor-wrap').each(function() {
            const targetSelector = String($(this).data('target') || '');
            if (!targetSelector) return;
            const $hidden = $(targetSelector);
            const $editor = $(this).find('.d2w-editor-content');
            if (!$hidden.length || !$editor.length) return;

            $editor.html(cleanEditorHtml($hidden.val() || ''));
            $hidden.val(cleanEditorHtml($editor.html() || ''));
        });

        $(document).on('input blur', '.d2w-editor-content', function() {
            syncEditorToHidden(this);
        });

        $(document).on('click', '.d2w-editor-btn', function() {
            const cmd = $(this).data('cmd');
            const editor = $(this).closest('.d2w-editor-wrap').find('.d2w-editor-content')[0];
            if (!editor || !cmd) return;

            editor.focus();
            document.execCommand('styleWithCSS', false, true);
            document.execCommand(cmd, false, null);
            syncEditorToHidden(editor);
        });

        $(document).on('change', '.d2w-editor-size', function() {
            const editor = $(this).closest('.d2w-editor-wrap').find('.d2w-editor-content')[0];
            if (!editor) return;

            editor.focus();
            document.execCommand('styleWithCSS', false, true);
            document.execCommand('fontSize', false, String($(this).val() || '3'));
            syncEditorToHidden(editor);
        });

        $(document).on('input change', '.d2w-editor-color', function() {
            const editor = $(this).closest('.d2w-editor-wrap').find('.d2w-editor-content')[0];
            if (!editor) return;

            editor.focus();
            document.execCommand('styleWithCSS', false, true);
            document.execCommand('foreColor', false, String($(this).val() || '#111111'));
            syncEditorToHidden(editor);
        });

        $(document).on('click', '.d2w-editor-clear', function() {
            const editor = $(this).closest('.d2w-editor-wrap').find('.d2w-editor-content')[0];
            if (!editor) return;

            editor.focus();
            document.execCommand('removeFormat', false, null);
            document.execCommand('unlink', false, null);
            syncEditorToHidden(editor);
        });
    }

    function getGalleryList(hiddenSelector) {
        try {
            const parsed = JSON.parse($(hiddenSelector).val() || '[]');
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (e) {
            return [];
        }
    }

    function setGalleryList(hiddenSelector, list) {
        $(hiddenSelector).val(JSON.stringify(Array.isArray(list) ? list : []));
    }

    function renderGalleryPreview(previewSelector, hiddenSelector) {
        const $preview = $(previewSelector);
        if (!$preview.length) return;

        const items = getGalleryList(hiddenSelector);
        if (!items.length) {
            $preview.empty().hide();
            return;
        }

        const html = items.map((src, idx) => `
            <div style="position:relative;display:inline-block;">
                <img src="${src}" alt="Gallery ${idx + 1}" style="width:62px;height:62px;object-fit:cover;border-radius:6px;border:1px solid #d1d5db;">
                <button type="button" class="btn btn-sm btn-danger d2w-remove-gallery" data-hidden="${hiddenSelector}" data-preview="${previewSelector}" data-index="${idx}" style="position:absolute;top:-8px;right:-8px;line-height:1;padding:2px 6px;">&times;</button>
            </div>
        `).join('');

        $preview.html(html).css('display', 'flex');
    }

    async function appendGalleryImages(fileInputId, hiddenSelector, previewSelector) {
        const input = document.getElementById(fileInputId);
        const files = input && input.files ? Array.from(input.files) : [];
        if (!files.length) {
            showStatus('Please select one or more gallery images first', 'warning');
            return;
        }

        const current = getGalleryList(hiddenSelector);
        const uploaded = [];

        for (const file of files) {
            try {
                const imageDataUrl = await compressImageFile(file);
                uploaded.push(imageDataUrl);
            } catch (err) {
                console.warn('Skipping invalid gallery image file', err);
            }
        }

        const merged = current.concat(uploaded);
        setGalleryList(hiddenSelector, merged);
        renderGalleryPreview(previewSelector, hiddenSelector);
        if (input) input.value = '';
        showStatus('Gallery images uploaded!', 'success');
    }
    
    function getCategoryNameById(categoryId) {
        const categories = AdminStore.getCategories();
        const found = categories.find(c => String(c.id) === String(categoryId));
        return found ? found.name : '-';
    }

    function getProductById(productId) {
        return AdminStore.getProducts().find(p => String(p.id) === String(productId)) || null;
    }

    function getProductEditTarget(product) {
        return product && product.isNew === true ? 'new' : 'total';
    }

    function getEditParamProductId() {
        try {
            const params = new URLSearchParams(window.location.search || '');
            return String(params.get('edit') || '').trim();
        } catch (err) {
            return '';
        }
    }

    function setEditMode(product) {
        if ($productForm.length) {
            editState.productId = String(product.id);
            editState.isNew = product.isNew === true;

            $('#productType').val(editState.isNew ? 'new' : 'total');
            $('#productName').val(product.name || '');
            $('#productCategoryId').val(String(product.categoryId || ''));
            $('#productPrice').val(Number(product.price || 0) || '');
            $('#productOldPrice').val(Number(product.oldPrice || 0) || '');
            $('#productWholesalePrice').val(Number(product.wholesalePrice || 0) || '');
            $('#productStock').val(Number(product.stock || 0) || 0);
            $('#productSortOrder').val(Number(product.sortOrder || 0) || 0);
            $('#productUrl').val(product.productUrl || '');
            $('#productIsActive').prop('checked', product.isActive !== false);
            $('#productDescription').val(product.description || '');
            setEditorHtmlByTarget('#productDescription', product.description || '');

            if (product.image) {
                $('#productImage').val(product.image);
                $('#productImagePreviewImg').attr('src', product.image);
                $('#productImagePreview').show();
            }

            setGalleryList('#productGalleryImages', Array.isArray(product.galleryImages) ? product.galleryImages : []);
            renderGalleryPreview('#productGalleryPreview', '#productGalleryImages');

            $('#productFormTitle').html(`<i class="fas fa-pen text-primary mr-1"></i> Edit ${editState.isNew ? 'New' : 'All'} Product`);
            $('#productSaveLabel').text(`Update ${editState.isNew ? 'New' : 'All'} Product`);
            $('#productCancelBtn').removeClass('d-none');
            return;
        }

        const target = getProductEditTarget(product);
        editState.productId = String(product.id);
        editState.isNew = target === 'new';

        const prefix = editState.isNew ? '#newProduct' : '#totalProduct';
        const formTitle = editState.isNew ? 'Edit New Product' : 'Edit Total Product';
        const saveLabel = editState.isNew ? 'Update New Product' : 'Update Total Product';

        const formPanel = editState.isNew ? $('#newProductForm').closest('.d2w-add-card') : $('#totalProductForm').closest('.d2w-add-card');
        const saveLabelEl = editState.isNew ? $('#newProductSaveLabel') : $('#totalProductSaveLabel');
        const cancelBtn = editState.isNew ? $('#newProductCancelBtn') : $('#totalProductCancelBtn');

        if (formPanel.length) {
            formPanel.find('h6').first().text(formTitle);
        }

        if (saveLabelEl.length) saveLabelEl.text(saveLabel);
        if (cancelBtn.length) cancelBtn.removeClass('d-none');

        $(prefix + 'Name').val(product.name || '');
        $(prefix + 'CategoryId').val(String(product.categoryId || ''));
        $(prefix + 'Price').val(Number(product.price || 0) || '');
        $(prefix + 'OldPrice').val(Number(product.oldPrice || 0) || '');
        $(prefix + 'SortOrder').val(Number(product.sortOrder || 0) || 0);
        $(prefix + 'Url').val(product.productUrl || '');
        $(prefix + 'IsActive').prop('checked', product.isActive !== false);
        $(prefix + 'Description').val(product.description || '');
        setEditorHtmlByTarget(prefix + 'Description', product.description || '');

        const imageField = prefix + 'Image';
        const imagePreview = prefix + 'ImagePreview';
        const imagePreviewImg = prefix + 'ImagePreviewImg';
        if (product.image) {
            $(imageField).val(product.image);
            $(imagePreviewImg).attr('src', product.image);
            $(imagePreview).show();
        }

        const gallerySelector = prefix + 'GalleryImages';
        const galleryPreview = prefix + 'GalleryPreview';
        setGalleryList(gallerySelector, Array.isArray(product.galleryImages) ? product.galleryImages : []);
        renderGalleryPreview(galleryPreview, gallerySelector);

        window.requestAnimationFrame(() => {
            const top = formPanel.length ? formPanel.offset().top - 12 : 0;
            if (top > 0) window.scrollTo({ top, behavior: 'smooth' });
        });
    }

    function clearEditMode() {
        editState.productId = null;
        editState.isNew = null;
        if ($productForm.length) {
            $productForm[0].reset();
            $('#productType').val('new');
            $('#productIsActive').prop('checked', true);
            $('#productStock').val('');
            $('#productWholesalePrice').val('');
            $('#productSaveLabel').text('Save Product');
            $('#productCancelBtn').addClass('d-none');
            $('#productFormTitle').html('<i class="fas fa-layer-group text-primary mr-1"></i> Product Upload');
            setEditorHtmlByTarget('#productDescription', '');
            $('#productImage').val('');
            $('#productImagePreview').hide();
            setGalleryList('#productGalleryImages', []);
            renderGalleryPreview('#productGalleryPreview', '#productGalleryImages');
            return;
        }
        $('#newProductForm, #totalProductForm')[0].reset();
        $('#newProductIsActive, #totalProductIsActive').prop('checked', true);
        $('#newProductSaveLabel').text('Save New Product');
        $('#totalProductSaveLabel').text('Save Total Product');
        $('#newProductCancelBtn, #totalProductCancelBtn').addClass('d-none');
        $('h6:contains("Edit New Product"), h6:contains("Edit Total Product")').each(function() {
            if ($(this).text().indexOf('New Product') !== -1) {
                $(this).html('<i class="fas fa-rocket text-primary mr-1"></i> New Products Upload');
            } else if ($(this).text().indexOf('Total Product') !== -1 || $(this).text().indexOf('Products') !== -1) {
                $(this).html('<i class="fas fa-boxes text-success mr-1"></i> All Products Upload');
            }
        });
    }

    function initEditModeFromUrl() {
        const editId = getEditParamProductId();
        if (!editId) return;

        const product = getProductById(editId);
        if (!product) {
            showStatus('The product to edit could not be found.', 'warning');
            return;
        }

        setEditMode(product);
    }

    function formatProductPrice(value) {
        const amount = Number(value || 0);
        return `৳${amount.toFixed(2)}`;
    }

    function getProductStatusLabel(product) {
        return product.isActive === false ? 'Inactive' : 'Active';
    }

    function getProductStatusClass(product) {
        return product.isActive === false ? 'is-inactive' : 'is-active';
    }

    function getProductDetailUrl(productId) {
        return `../product-details.html?id=${encodeURIComponent(productId)}`;
    }

    function getProductEditUrl(productId) {
        return `products/add.html?edit=${encodeURIComponent(productId)}`;
    }

    function renderProductActions(prod) {
        const viewUrl = `products/view.html?id=${encodeURIComponent(prod.id)}`;
        const editUrl = getProductEditUrl(prod.id);

        return `
            <div class="admin-action-group" aria-label="Product actions">
                <a class="admin-action-link admin-action-view" href="${viewUrl}" title="View product" aria-label="View product">
                    <i class="far fa-eye"></i>
                </a>
                <a class="admin-action-link admin-action-edit" href="${editUrl}" title="Edit product" aria-label="Edit product">
                    <i class="far fa-edit"></i>
                </a>
                <button type="button" class="admin-action-btn admin-action-delete del-product" data-id="${prod.id}" title="Delete product" aria-label="Delete product">
                    <i class="far fa-trash-alt"></i>
                </button>
            </div>
        `;
    }

    function loadCategoryOptions() {
        const categories = AdminStore.getCategories();
        const option = '<option value="">Select a category</option>' + 
            categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('');
        
        $('#newProductCategoryId').html(option);
        $('#totalProductCategoryId').html(option);
        $('#productCategoryId').html(option);
    }



    function loadCategoryOptions() {
        const categories = AdminStore.getCategories();
        const option = '<option value="">Select a category</option>' + 
            categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('');
        
        $('#newProductCategoryId').html(option);
        $('#totalProductCategoryId').html(option);
        $('#productCategoryId').html(option);
    }
    
    function loadNewProducts() {
        const searchTerm = getProductSearchTerm();
        const products = AdminStore.getProducts()
            .filter(p => p.isNew === true)
            .filter(p => productMatchesSearch(p, searchTerm))
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const $table = $('#newProductTableBody');
        
        if (!$table.length) return;
        
        if (products.length === 0) {
            $table.html('<tr><td colspan="9" class="text-center text-muted">No new products yet</td></tr>');
            return;
        }
        
        $table.html(products.map((prod, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${prod.image ? `<img src="${prod.image}" alt="${prod.name}" class="admin-product-thumb">` : '-'}</td>
                <td><div class="admin-product-name">${prod.name || '-'}</div>${prod.sku ? `<span class="admin-product-sku">SKU: ${prod.sku}</span>` : ''}</td>
                <td>${getCategoryNameById(prod.categoryId)}</td>
                <td>
                    <div class="admin-product-price">
                        <span class="admin-product-price-now">${formatProductPrice(prod.price)}</span>
                        ${Number(prod.oldPrice || 0) > 0 ? `<span class="admin-product-price-old">${formatProductPrice(prod.oldPrice)}</span>` : ''}
                    </div>
                </td>
                <td><span class="badge badge-info">Yes</span></td>
                <td><span class="admin-status-pill ${getProductStatusClass(prod)}">${getProductStatusLabel(prod)}</span></td>
                <td>${prod.sortOrder || 0}</td>
                <td>${renderProductActions(prod)}</td>
            </tr>
        `).join(''));
    }
    
    function loadTotalProducts() {
        const searchTerm = getProductSearchTerm();
        const products = AdminStore.getProducts()
            .filter(p => p.isNew !== true)
            .filter(p => productMatchesSearch(p, searchTerm))
            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const $table = $('#totalProductTableBody');
        
        if (!$table.length) return;
        
        if (products.length === 0) {
            $table.html('<tr><td colspan="9" class="text-center text-muted">No total products yet</td></tr>');
            return;
        }
        
        $table.html(products.map((prod, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${prod.image ? `<img src="${prod.image}" alt="${prod.name}" class="admin-product-thumb">` : '-'}</td>
                <td><div class="admin-product-name">${prod.name || '-'}</div>${prod.sku ? `<span class="admin-product-sku">SKU: ${prod.sku}</span>` : ''}</td>
                <td>${getCategoryNameById(prod.categoryId)}</td>
                <td>
                    <div class="admin-product-price">
                        <span class="admin-product-price-now">${formatProductPrice(prod.price)}</span>
                        ${Number(prod.oldPrice || 0) > 0 ? `<span class="admin-product-price-old">${formatProductPrice(prod.oldPrice)}</span>` : ''}
                    </div>
                </td>
                <td><span class="badge badge-secondary">No</span></td>
                <td><span class="admin-status-pill ${getProductStatusClass(prod)}">${getProductStatusLabel(prod)}</span></td>
                <td>${prod.sortOrder || 0}</td>
                <td>${renderProductActions(prod)}</td>
            </tr>
        `).join(''));
    }

    function saveUnifiedProduct() {
        const name = $('#productName').val().trim();
        const categoryId = $('#productCategoryId').val();
        const price = parseFloat($('#productPrice').val());
        const normalizedUrl = normalizeOptionalUrl($('#productUrl').val());
        const isNewTarget = String($('#productType').val() || 'new') === 'new';

        if (!name || !categoryId) {
            showStatus('Product name and category are required', 'danger');
            return;
        }
        if (!Number.isFinite(price) || price <= 0) {
            showStatus('Please enter a valid price greater than 0', 'danger');
            return;
        }
        if (normalizedUrl === null) {
            showStatus('Product URL is invalid. Use a valid URL or leave it blank.', 'danger');
            return;
        }

        const product = {
            id: editState.productId ? editState.productId : 'prod_' + Date.now(),
            name,
            categoryId,
            price,
            oldPrice: parseFloat($('#productOldPrice').val()) || 0,
            wholesalePrice: parseFloat($('#productWholesalePrice').val()) || 0,
            stock: parseInt($('#productStock').val(), 10) || 0,
            sortOrder: parseInt($('#productSortOrder').val(), 10) || 0,
            productUrl: normalizedUrl || '',
            description: $('#productDescription').val().trim(),
            image: $('#productImage').val().trim(),
            coverImage: $('#productImage').val().trim(),
            galleryImages: getGalleryList('#productGalleryImages'),
            isNew: isNewTarget,
            isActive: $('#productIsActive').is(':checked')
        };

        try {
            localStorage.setItem('drop2wave_bootstrap_disabled', 'true');
            if (editState.productId) {
                AdminStore.updateProduct(editState.productId, product);
                showStatus('Product updated successfully!', 'success');
            } else {
                AdminStore.addProduct(product);
                showStatus('Product added successfully!', 'success');
            }
            clearEditMode();
            loadNewProducts();
            loadTotalProducts();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                try {
                    const fallbackProduct = { ...product, image: '', coverImage: '', galleryImages: [] };
                    if (editState.productId) {
                        AdminStore.updateProduct(editState.productId, fallbackProduct);
                    } else {
                        AdminStore.addProduct(fallbackProduct);
                    }
                    showStatus('Storage full: product saved without images. Re-upload after cleanup.', 'warning');
                    clearEditMode();
                    loadNewProducts();
                    loadTotalProducts();
                } catch (fallbackErr) {
                    showStatus('Storage is full. Please delete some image-heavy data and try again.', 'danger');
                }
                return;
            }
            showStatus('Could not save product due to an unexpected error.', 'danger');
        }
    }

    function setupUnifiedProductHandler() {
        if (!$productForm.length) return;
        $productForm.on('submit', function(e) {
            e.preventDefault();
            saveUnifiedProduct();
        });

        $(document).on('click', '#productSaveBtn', function(e) {
            e.preventDefault();
            saveUnifiedProduct();
        });
    }
    
    function saveNewProduct() {
        const name = $('#newProductName').val().trim();
        const categoryId = $('#newProductCategoryId').val();
        const price = parseFloat($('#newProductPrice').val());
        const normalizedUrl = normalizeOptionalUrl($('#newProductUrl').val());

        if (!name || !categoryId) {
            showStatus('Product name and category are required', 'danger');
            return;
        }

        if (!Number.isFinite(price) || price <= 0) {
            showStatus('Please enter a valid price greater than 0', 'danger');
            return;
        }

        if (normalizedUrl === null) {
            showStatus('Product URL is invalid. Use a valid URL or leave it blank.', 'danger');
            return;
        }

        const product = {
            id: editState.productId && editState.isNew === true ? editState.productId : 'prod_' + Date.now(),
            name,
            categoryId,
            price,
            oldPrice: parseFloat($('#newProductOldPrice').val()) || 0,
            sortOrder: parseInt($('#newProductSortOrder').val(), 10) || 0,
            productUrl: normalizedUrl || '',
            description: $('#newProductDescription').val().trim(),
            image: $('#newProductImage').val().trim(),
            coverImage: $('#newProductImage').val().trim(),
            galleryImages: getGalleryList('#newProductGalleryImages'),
            isNew: true,
            isActive: $('#newProductIsActive').is(':checked')
        };

        try {
            localStorage.setItem('drop2wave_bootstrap_disabled', 'true');
            if (editState.productId && editState.isNew === true) {
                AdminStore.updateProduct(editState.productId, product);
                showStatus('New product updated successfully!', 'success');
            } else {
                AdminStore.addProduct(product);
                showStatus('New product added successfully!', 'success');
            }
            $newProdForm[0].reset();
            $('#newProductIsActive').prop('checked', true);
            setEditorHtmlByTarget('#newProductDescription', '');
            $('#newProductImagePreview').hide();
            setGalleryList('#newProductGalleryImages', []);
            renderGalleryPreview('#newProductGalleryPreview', '#newProductGalleryImages');
            clearEditMode();
            loadNewProducts();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                // Final fallback: save product without image rather than blocking save completely.
                try {
                    const fallbackProduct = { ...product, image: '', coverImage: '', galleryImages: [] };
                    if (editState.productId && editState.isNew === true) {
                        AdminStore.updateProduct(editState.productId, fallbackProduct);
                        showStatus('Storage full: product updated without image. Delete old image-heavy items and re-upload image.', 'warning');
                    } else {
                        AdminStore.addProduct(fallbackProduct);
                        showStatus('Storage full: product saved without image. Delete old image-heavy items and re-upload image.', 'warning');
                    }
                    $newProdForm[0].reset();
                    $('#newProductIsActive').prop('checked', true);
                    setEditorHtmlByTarget('#newProductDescription', '');
                    $('#newProductImagePreview').hide();
                    setGalleryList('#newProductGalleryImages', []);
                    renderGalleryPreview('#newProductGalleryPreview', '#newProductGalleryImages');
                    clearEditMode();
                    loadNewProducts();
                } catch (fallbackErr) {
                    showStatus('Storage is full. Please delete some products/categories with images and try again.', 'danger');
                }
                return;
            }
            showStatus('Could not save product due to an unexpected error.', 'danger');
        }
    }

    function setupNewProductHandler() {
        if (!$newProdForm.length) return;

        // Fallback for Enter-key submit.
        $newProdForm.on('submit', function(e) {
            e.preventDefault();
            saveNewProduct();
        });

        // Primary save path.
        $(document).on('click', '#newProductSaveBtn', function(e) {
            e.preventDefault();
            saveNewProduct();
        });
    }
    
    function saveTotalProduct() {
        const name = $('#totalProductName').val().trim();
        const categoryId = $('#totalProductCategoryId').val();
        const price = parseFloat($('#totalProductPrice').val());
        const normalizedUrl = normalizeOptionalUrl($('#totalProductUrl').val());

        if (!name || !categoryId) {
            showStatus('Product name and category are required', 'danger');
            return;
        }

        if (!Number.isFinite(price) || price <= 0) {
            showStatus('Please enter a valid price greater than 0', 'danger');
            return;
        }

        if (normalizedUrl === null) {
            showStatus('Product URL is invalid. Use a valid URL or leave it blank.', 'danger');
            return;
        }

        const product = {
            id: editState.productId && editState.isNew === false ? editState.productId : 'prod_' + Date.now(),
            name,
            categoryId,
            price,
            oldPrice: parseFloat($('#totalProductOldPrice').val()) || 0,
            sortOrder: parseInt($('#totalProductSortOrder').val(), 10) || 0,
            productUrl: normalizedUrl || '',
            description: $('#totalProductDescription').val().trim(),
            image: $('#totalProductImage').val().trim(),
            coverImage: $('#totalProductImage').val().trim(),
            galleryImages: getGalleryList('#totalProductGalleryImages'),
            isNew: false,
            isActive: $('#totalProductIsActive').is(':checked')
        };

        try {
            localStorage.setItem('drop2wave_bootstrap_disabled', 'true');
            if (editState.productId && editState.isNew === false) {
                AdminStore.updateProduct(editState.productId, product);
                showStatus('Total product updated successfully!', 'success');
            } else {
                AdminStore.addProduct(product);
                showStatus('Total product added successfully!', 'success');
            }
            $totalProdForm[0].reset();
            $('#totalProductIsActive').prop('checked', true);
            setEditorHtmlByTarget('#totalProductDescription', '');
            $('#totalProductImagePreview').hide();
            setGalleryList('#totalProductGalleryImages', []);
            renderGalleryPreview('#totalProductGalleryPreview', '#totalProductGalleryImages');
            clearEditMode();
            loadTotalProducts();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                try {
                    const fallbackProduct = { ...product, image: '', coverImage: '', galleryImages: [] };
                    if (editState.productId && editState.isNew === false) {
                        AdminStore.updateProduct(editState.productId, fallbackProduct);
                        showStatus('Storage full: product updated without image. Delete old image-heavy items and re-upload image.', 'warning');
                    } else {
                        AdminStore.addProduct(fallbackProduct);
                        showStatus('Storage full: product saved without image. Delete old image-heavy items and re-upload image.', 'warning');
                    }
                    $totalProdForm[0].reset();
                    $('#totalProductIsActive').prop('checked', true);
                    setEditorHtmlByTarget('#totalProductDescription', '');
                    $('#totalProductImagePreview').hide();
                    setGalleryList('#totalProductGalleryImages', []);
                    renderGalleryPreview('#totalProductGalleryPreview', '#totalProductGalleryImages');
                    clearEditMode();
                    loadTotalProducts();
                } catch (fallbackErr) {
                    showStatus('Storage is full. Please delete some products/categories with images and try again.', 'danger');
                }
                return;
            }
            showStatus('Could not save product due to an unexpected error.', 'danger');
        }
    }

    function setupTotalProductHandler() {
        if (!$totalProdForm.length) return;

        // Fallback for Enter-key submit.
        $totalProdForm.on('submit', function(e) {
            e.preventDefault();
            saveTotalProduct();
        });

        // Primary save path.
        $(document).on('click', '#totalProductSaveBtn', function(e) {
            e.preventDefault();
            saveTotalProduct();
        });
    }

    $(document).on('click', '#newProductCancelBtn', function() {
        clearEditMode();
        loadNewProducts();
    });

    $(document).on('click', '#totalProductCancelBtn', function() {
        clearEditMode();
        loadTotalProducts();
    });

    $(document).on('click', '#productCancelBtn', function() {
        clearEditMode();
        loadNewProducts();
        loadTotalProducts();
    });

    $(document).on('click', '.edit-product', function(e) {
        e.preventDefault();
        const id = String($(this).data('id') || '');
        const product = getProductById(id);
        if (!product) {
            showStatus('Product not found for editing.', 'warning');
            return;
        }

        setEditMode(product);
    });

    function pickProductFromForm(isNewTarget) {
        if ($productForm.length) {
            const typedName = String($('#productName').val() || '').trim();
            const categoryId = String($('#productCategoryId').val() || '').trim();
            const typedPrice = parseFloat($('#productPrice').val());
            const targetIsNew = String($('#productType').val() || 'new') === 'new';

            if (!typedName || !categoryId) {
                showStatus('Enter product name and category first to delete a specific product.', 'warning');
                return null;
            }

            let matches = AdminStore.getProducts().filter(p => {
                return (p.isNew === true) === targetIsNew &&
                    String(p.name || '').trim().toLowerCase() === typedName.toLowerCase() &&
                    String(p.categoryId || '') === categoryId;
            });

            if (Number.isFinite(typedPrice) && typedPrice > 0) {
                const byPrice = matches.filter(p => Number(p.price || 0) === typedPrice);
                if (byPrice.length) matches = byPrice;
            }

            if (!matches.length) {
                showStatus('No matching product found from current form values.', 'warning');
                return null;
            }

            matches.sort((a, b) => {
                const aId = Number(String(a.id || '').replace(/\D/g, '')) || 0;
                const bId = Number(String(b.id || '').replace(/\D/g, '')) || 0;
                return bId - aId;
            });
            return matches[0];
        }

        const prefix = isNewTarget ? '#newProduct' : '#totalProduct';
        const typedName = String($(prefix + 'Name').val() || '').trim();
        const categoryId = String($(prefix + 'CategoryId').val() || '').trim();
        const typedPrice = parseFloat($(prefix + 'Price').val());

        if (!typedName || !categoryId) {
            showStatus('Enter product name and category first to delete a specific product.', 'warning');
            return null;
        }

        let matches = AdminStore.getProducts().filter(p => {
            return (p.isNew === true) === isNewTarget &&
                String(p.name || '').trim().toLowerCase() === typedName.toLowerCase() &&
                String(p.categoryId || '') === categoryId;
        });

        if (Number.isFinite(typedPrice) && typedPrice > 0) {
            const byPrice = matches.filter(p => Number(p.price || 0) === typedPrice);
            if (byPrice.length) matches = byPrice;
        }

        if (!matches.length) {
            showStatus('No matching product found from current form values.', 'warning');
            return null;
        }

        // When duplicates exist, prefer the latest created entry.
        matches.sort((a, b) => {
            const aId = Number(String(a.id || '').replace(/\D/g, '')) || 0;
            const bId = Number(String(b.id || '').replace(/\D/g, '')) || 0;
            return bId - aId;
        });

        return matches[0];
    }
    
    // New Products deletion
    $(document).on('click', '.del-new-prod', function() {
        const id = $(this).data('id');
        if (confirm('Delete this new product?')) {
            AdminStore.deleteProduct(id);
            showStatus('New product deleted', 'info');
            loadNewProducts();
        }
    });

    $(document).on('click', '.del-product', function() {
        const id = $(this).data('id');
        if (confirm('Delete this product?')) {
            AdminStore.deleteProduct(id);
            showStatus('Product deleted', 'info');
            loadNewProducts();
            loadTotalProducts();
        }
    });

    $(document).on('click', '#deleteNewProductBtn', function() {
        const selected = pickProductFromForm(true);
        if (!selected) return;

        const ok = confirm(`Delete this product?\n\n${selected.name} (৳${Number(selected.price || 0).toFixed(2)})`);
        if (!ok) return;

        AdminStore.deleteProduct(selected.id);
        showStatus('Specific new product deleted.', 'info');
        loadNewProducts();
    });
    
    // Total Products deletion
    $(document).on('click', '.del-total-prod', function() {
        const id = $(this).data('id');
        if (confirm('Delete this total product?')) {
            AdminStore.deleteProduct(id);
            showStatus('Total product deleted', 'info');
            loadTotalProducts();
        }
    });

    $(document).on('click', '#deleteTotalProductBtn', function() {
        const selected = pickProductFromForm(false);
        if (!selected) return;

        const ok = confirm(`Delete this product?\n\n${selected.name} (৳${Number(selected.price || 0).toFixed(2)})`);
        if (!ok) return;

        AdminStore.deleteProduct(selected.id);
        showStatus('Specific total product deleted.', 'info');
        loadTotalProducts();
    });

    $(document).on('click', '#deleteProductBtn', function() {
        const selected = pickProductFromForm(true);
        if (!selected) return;

        const ok = confirm(`Delete this product?\n\n${selected.name} (৳${Number(selected.price || 0).toFixed(2)})`);
        if (!ok) return;

        AdminStore.deleteProduct(selected.id);
        showStatus('Product deleted.', 'info');
        clearEditMode();
        loadNewProducts();
        loadTotalProducts();
    });
    
    // Image Upload Handler for New Products
    $(document).on('click', '#uploadNewImageBtn', async function() {
        const fileInput = document.getElementById('newProductImageFile');
        const file = fileInput.files[0];
        
        if (!file) {
            showStatus('Please select an image file first', 'warning');
            return;
        }
        
        try {
            const imageDataUrl = await compressImageFile(file);
            $('#newProductImage').val(imageDataUrl);
            
            // Show preview
            $('#newProductImagePreviewImg').attr('src', imageDataUrl);
            $('#newProductImagePreview').show();
            
            showStatus('Image optimized and uploaded! Click Save New Product.', 'success');
        } catch (err) {
            showStatus('Error reading image file', 'danger');
        }
    });
    
    // Image Upload Handler for Total Products
    $(document).on('click', '#uploadTotalImageBtn', async function() {
        const fileInput = document.getElementById('totalProductImageFile');
        const file = fileInput.files[0];
        
        if (!file) {
            showStatus('Please select an image file first', 'warning');
            return;
        }
        
        try {
            const imageDataUrl = await compressImageFile(file);
            $('#totalProductImage').val(imageDataUrl);
            
            // Show preview
            $('#totalProductImagePreviewImg').attr('src', imageDataUrl);
            $('#totalProductImagePreview').show();
            
            showStatus('Image optimized and uploaded! Click Save Total Product.', 'success');
        } catch (err) {
            showStatus('Error reading image file', 'danger');
        }
    });

    $(document).on('click', '#uploadProductImageBtn', async function() {
        const fileInput = document.getElementById('productImageFile');
        const file = fileInput && fileInput.files ? fileInput.files[0] : null;

        if (!file) {
            showStatus('Please select an image file first', 'warning');
            return;
        }

        try {
            const imageDataUrl = await compressImageFile(file);
            $('#productImage').val(imageDataUrl);
            $('#productImagePreviewImg').attr('src', imageDataUrl);
            $('#productImagePreview').show();
            showStatus('Image optimized and uploaded! Click Save Product.', 'success');
        } catch (err) {
            showStatus('Error reading image file', 'danger');
        }
    });

    $(document).on('click', '#uploadNewGalleryBtn', async function() {
        await appendGalleryImages('newProductGalleryFiles', '#newProductGalleryImages', '#newProductGalleryPreview');
    });

    $(document).on('click', '#uploadTotalGalleryBtn', async function() {
        await appendGalleryImages('totalProductGalleryFiles', '#totalProductGalleryImages', '#totalProductGalleryPreview');
    });

    $(document).on('click', '#uploadProductGalleryBtn', async function() {
        await appendGalleryImages('productGalleryFiles', '#productGalleryImages', '#productGalleryPreview');
    });

    $(document).on('click', '.d2w-remove-gallery', function() {
        const hiddenSelector = $(this).data('hidden');
        const previewSelector = $(this).data('preview');
        const idx = parseInt($(this).data('index'), 10);
        const list = getGalleryList(hiddenSelector);
        if (Number.isInteger(idx) && idx >= 0 && idx < list.length) {
            list.splice(idx, 1);
            setGalleryList(hiddenSelector, list);
            renderGalleryPreview(previewSelector, hiddenSelector);
        }
    });
    
    function setupLogout() {
        $(document).on('click', '#logoutBtn', function() {
            if (confirm('Logout from admin panel?')) {
                AdminStore.clearSession();
                window.location.href = loginPath + '?logout=1';
            }
        });
    }
    
    function showStatus(message, type) {
        if (!$status.length) return;
        
        $status
            .removeClass('d-none')
            .removeClass('alert-success alert-danger alert-info alert-warning')
            .addClass('alert-' + type)
            .text(message)
            .fadeIn();
        
        if (type === 'success' || type === 'info') {
            setTimeout(() => $status.fadeOut().addClass('d-none'), 3000);
        }
    }


});



