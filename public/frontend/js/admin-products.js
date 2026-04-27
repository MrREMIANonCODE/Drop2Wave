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
    const $productFormPanel = $('#productFormPanel');
    const $openProductFormBtn = $('#openProductFormBtn');
    const $closeProductFormBtn = $('#closeProductFormBtn');
    const $productSearchInput = $('#productSearchInput');
    const $status = $('#statusMessage');
    
    await AdminStore.syncFromCloud();

    loadCategoryOptions();
    loadNewProducts();
    loadTotalProducts();
    initRichTextEditors();
    setupProductPanelToggle();
    setupProductSearch();
    setupNewProductHandler();
    setupTotalProductHandler();
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

    function loadCategoryOptions() {
        const categories = AdminStore.getCategories();
        const option = '<option value="">Select a category</option>' + 
            categories.map(cat => `<option value="${cat.id}">${cat.name}</option>`).join('');
        
        $('#newProductCategoryId').html(option);
        $('#totalProductCategoryId').html(option);
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
                <td>${prod.image ? `<img src="${prod.image}" alt="${prod.name}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;">` : '-'}</td>
                <td>${prod.name || '-'}</td>
                <td>${getCategoryNameById(prod.categoryId)}</td>
                <td>৳${Number(prod.price || 0).toFixed(2)}</td>
                <td><span class="badge badge-info">Yes</span></td>
                <td><span class="badge badge-${prod.isActive === false ? 'secondary' : 'success'}">${prod.isActive === false ? 'Inactive' : 'Active'}</span></td>
                <td>${prod.sortOrder || 0}</td>
                <td>
                    <button class="btn btn-sm btn-danger del-new-prod" data-id="${prod.id}">Delete</button>
                </td>
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
                <td>${prod.image ? `<img src="${prod.image}" alt="${prod.name}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;">` : '-'}</td>
                <td>${prod.name || '-'}</td>
                <td>${getCategoryNameById(prod.categoryId)}</td>
                <td>৳${Number(prod.price || 0).toFixed(2)}</td>
                <td><span class="badge badge-secondary">No</span></td>
                <td><span class="badge badge-${prod.isActive === false ? 'secondary' : 'success'}">${prod.isActive === false ? 'Inactive' : 'Active'}</span></td>
                <td>${prod.sortOrder || 0}</td>
                <td>
                    <button class="btn btn-sm btn-danger del-total-prod" data-id="${prod.id}">Delete</button>
                </td>
            </tr>
        `).join(''));
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
            id: 'prod_' + Date.now(),
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
            AdminStore.addProduct(product);
            showStatus('New product added successfully!', 'success');
            $newProdForm[0].reset();
            $('#newProductIsActive').prop('checked', true);
            setEditorHtmlByTarget('#newProductDescription', '');
            $('#newProductImagePreview').hide();
            setGalleryList('#newProductGalleryImages', []);
            renderGalleryPreview('#newProductGalleryPreview', '#newProductGalleryImages');
            loadNewProducts();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                // Final fallback: save product without image rather than blocking save completely.
                try {
                    const fallbackProduct = { ...product, image: '', coverImage: '', galleryImages: [] };
                    AdminStore.addProduct(fallbackProduct);
                    showStatus('Storage full: product saved without image. Delete old image-heavy items and re-upload image.', 'warning');
                    $newProdForm[0].reset();
                    $('#newProductIsActive').prop('checked', true);
                    setEditorHtmlByTarget('#newProductDescription', '');
                    $('#newProductImagePreview').hide();
                    setGalleryList('#newProductGalleryImages', []);
                    renderGalleryPreview('#newProductGalleryPreview', '#newProductGalleryImages');
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
            id: 'prod_' + Date.now(),
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
            AdminStore.addProduct(product);
            showStatus('Total product added successfully!', 'success');
            $totalProdForm[0].reset();
            $('#totalProductIsActive').prop('checked', true);
            setEditorHtmlByTarget('#totalProductDescription', '');
            $('#totalProductImagePreview').hide();
            setGalleryList('#totalProductGalleryImages', []);
            renderGalleryPreview('#totalProductGalleryPreview', '#totalProductGalleryImages');
            loadTotalProducts();
        } catch (err) {
            if (isQuotaExceededError(err)) {
                try {
                    const fallbackProduct = { ...product, image: '', coverImage: '', galleryImages: [] };
                    AdminStore.addProduct(fallbackProduct);
                    showStatus('Storage full: product saved without image. Delete old image-heavy items and re-upload image.', 'warning');
                    $totalProdForm[0].reset();
                    $('#totalProductIsActive').prop('checked', true);
                    setEditorHtmlByTarget('#totalProductDescription', '');
                    $('#totalProductImagePreview').hide();
                    setGalleryList('#totalProductGalleryImages', []);
                    renderGalleryPreview('#totalProductGalleryPreview', '#totalProductGalleryImages');
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

    function pickProductFromForm(isNewTarget) {
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

    $(document).on('click', '#uploadNewGalleryBtn', async function() {
        await appendGalleryImages('newProductGalleryFiles', '#newProductGalleryImages', '#newProductGalleryPreview');
    });

    $(document).on('click', '#uploadTotalGalleryBtn', async function() {
        await appendGalleryImages('totalProductGalleryFiles', '#totalProductGalleryImages', '#totalProductGalleryPreview');
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



