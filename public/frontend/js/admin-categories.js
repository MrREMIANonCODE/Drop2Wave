/**
 * Admin Categories Management
 */

$(document).ready(async function() {
    const isNestedProductsPage = window.location.pathname.toLowerCase().indexOf('/admin/products/') !== -1;
    const loginPath = isNestedProductsPage ? '../login.html' : 'login.html';

    // Check authentication
    if (!AdminStore.isAuthenticated()) {
        window.location.href = loginPath;
        return;
    }
    
    const $form = $('#categoryForm');
    const $status = $('#statusMessage');
    const $categoryName = $('#categoryName');
    const $categorySlug = $('#categorySlug');
    const $categoryImage = $('#categoryImage');
    const $categoryDescription = $('#categoryDescription');
    const $categorySortOrder = $('#categorySortOrder');
    const $categoryIsActive = $('#categoryIsActive');
    
    let editingCategoryId = null;
    
    await AdminStore.syncFromCloud();

    loadCategories();
    setupFormHandler();
    setupLogout();
    startLiveStoreListener();
    startOrdersListener();

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
                loadCategories();
            }, (err) => {
                console.warn('Live categories listener failed.', err);
            });
        } catch (err) {
            console.warn('Unable to start live categories listener.', err);
        }
    }

    // Listen for order changes to update category order counts
    function startOrdersListener() {
        window.addEventListener('storage', (e) => {
            if (e.key === 'drop2wave_orders_v1') {
                loadCategories();
            }
        });
        
        // Also check for orders changes every 5 seconds
        setInterval(() => {
            loadCategories();
        }, 5000);
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
    
    function loadCategories() {
        const categories = AdminStore.getCategories().slice().sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
        const products = AdminStore.getProducts();
        const $table = $('#categoryTableBody');
        
        // Get orders from localStorage - handle both formats
        let allOrders = [];
        try {
            const ordersRaw = localStorage.getItem('drop2wave_orders_v1');
            if (ordersRaw) {
                const parsed = JSON.parse(ordersRaw);
                // Handle both { orders: [...] } and [...] formats
                if (Array.isArray(parsed)) {
                    allOrders = parsed;
                } else if (parsed && Array.isArray(parsed.orders)) {
                    allOrders = parsed.orders;
                }
            }
        } catch (e) {
            console.warn('Error reading orders:', e);
            allOrders = [];
        }
        
        if (!$table.length) return;
        
        if (categories.length === 0) {
            $table.html('<tr><td colspan="8" class="text-center text-muted">No categories yet</td></tr>');
            return;
        }
        
        $table.html(categories.map((cat, idx) => {
            const productsInCat = products.filter(p => String(p.categoryId) === String(cat.id)).length;
            
            // Count orders for this category by checking order items
            let ordersInCat = 0;
            allOrders.forEach(order => {
                if (order && Array.isArray(order.items)) {
                    order.items.forEach(item => {
                        if (String(item.categoryId) === String(cat.id)) {
                            ordersInCat += Number(item.quantity || 1);
                        }
                    });
                }
            });
            
            const statusStyle = cat.isActive === false 
                ? 'background:#f3f4f6;color:#6b7280;' 
                : 'background:#d1fae5;color:#047857;';
            const statusText = cat.isActive === false ? 'Inactive' : 'Active';
            
            return `
            <tr>
                <td>${idx + 1}</td>
                <td>${cat.image ? `<img src="${cat.image}" alt="${cat.name}" style="width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;background:#f8fafc;">` : '<span style="color:#d1d5db;font-size:12px;">No image</span>'}</td>
                <td><strong style="color:#111827;">${cat.name}</strong></td>
                <td><code style="background:#f3f4f6;padding:3px 6px;border-radius:4px;color:#64748b;font-size:11px;">${cat.slug || '-'}</code></td>
                <td><span style="background:#dbeafe;color:#1e40af;padding:4px 8px;border-radius:6px;font-weight:600;font-size:12px;">${productsInCat}</span></td>
                <td><span style="background:#fef3c7;color:#92400e;padding:4px 8px;border-radius:6px;font-weight:600;font-size:12px;">${ordersInCat}</span></td>
                <td><span style="${statusStyle}padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600;display:inline-block;">${statusText}</span></td>
                <td>
                    <div class="admin-action-group">
                        <button class="admin-category-btn admin-category-btn-edit edit-btn" data-id="${cat.id}" title="Edit category">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="admin-category-btn admin-category-btn-delete delete-btn" data-id="${cat.id}" title="Delete category">
                            <i class="fas fa-trash-alt"></i> Delete
                        </button>
                    </div>
                </td>
            </tr>
        `;
        }).join(''));
    }
    
    function setupFormHandler() {
        if (!$form.length) return;
        
        $form.on('submit', function(e) {
            e.preventDefault();
            
            const name = $categoryName.val().trim();
            const slug = $categorySlug.val().trim() || name.toLowerCase().replace(/\s+/g, '-');
            
            if (!name) {
                showStatus('Category name is required', 'danger');
                return;
            }
            
            try {
                if (editingCategoryId) {
                    // Update existing category
                    AdminStore.updateCategory(editingCategoryId, {
                        name: name,
                        slug: slug,
                        image: $categoryImage.val().trim(),
                        description: $categoryDescription.val().trim(),
                        sortOrder: parseInt($categorySortOrder.val(), 10) || 0,
                        isActive: $categoryIsActive.is(':checked')
                    });
                    showStatus('Category updated successfully!', 'success');
                    editingCategoryId = null;
                } else {
                    // Add new category
                    const category = {
                        id: 'cat_' + Date.now(),
                        name: name,
                        slug: slug,
                        image: $categoryImage.val().trim(),
                        description: $categoryDescription.val().trim(),
                        sortOrder: parseInt($categorySortOrder.val(), 10) || 0,
                        isActive: $categoryIsActive.is(':checked')
                    };
                    AdminStore.addCategory(category);
                    showStatus('Category added successfully!', 'success');
                }
                $form[0].reset();
                $categoryIsActive.prop('checked', true);
                $('#categoryImagePreview').hide();
                $('#cancelCategoryBtn').addClass('d-none');
                loadCategories();
            } catch (err) {
                if (isQuotaExceededError(err)) {
                    showStatus('Storage is full. Please delete some products/categories with images and try again.', 'danger');
                    return;
                }
                showStatus('Could not save category due to an unexpected error.', 'danger');
            }
        });
    }
    
    $(document).on('click', '.delete-btn', function() {
        if (confirm('Are you sure you want to delete this category?')) {
            const id = $(this).data('id');
            AdminStore.deleteCategory(id);
            showStatus('Category deleted', 'info');
            loadCategories();
        }
    });

    $(document).on('click', '.edit-btn', function() {
        const id = $(this).data('id');
        const categories = AdminStore.getCategories();
        const category = categories.find(c => String(c.id) === String(id));
        
        if (!category) {
            showStatus('Category not found', 'danger');
            return;
        }
        
        editingCategoryId = id;
        $categoryName.val(category.name || '');
        $categorySlug.val(category.slug || '');
        $categoryDescription.val(category.description || '');
        $categorySortOrder.val(category.sortOrder || 0);
        $categoryIsActive.prop('checked', category.isActive !== false);
        $categoryImage.val(category.image || '');
        
        if (category.image) {
            $('#categoryImagePreviewImg').attr('src', category.image);
            $('#categoryImagePreview').show();
        } else {
            $('#categoryImagePreview').hide();
        }
        
        // Show cancel button and scroll to form
        $('#cancelCategoryBtn').removeClass('d-none');
        if ($form[0]) {
            $form[0].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        $categoryName.focus();
        showStatus('Editing category - update and save', 'info');
    });

    $(document).on('click', '#cancelCategoryBtn', function() {
        editingCategoryId = null;
        $form[0].reset();
        $categoryIsActive.prop('checked', true);
        $('#categoryImagePreview').hide();
        $('#cancelCategoryBtn').addClass('d-none');
        showStatus('Edit cancelled', 'info');
    });
    
    // Image Upload Handler for Categories
    $(document).on('click', '#uploadCategoryImageBtn', async function() {
        const fileInput = document.getElementById('categoryImageFile');
        const file = fileInput.files[0];
        
        if (!file) {
            showStatus('Please select an image file first', 'warning');
            return;
        }
        
        try {
            const imageDataUrl = await compressImageFile(file);
            $('#categoryImage').val(imageDataUrl);
            
            // Show preview
            $('#categoryImagePreviewImg').attr('src', imageDataUrl);
            $('#categoryImagePreview').show();
            
            showStatus('Image optimized and uploaded! Click Save Category.', 'success');
        } catch (err) {
            showStatus('Error reading image file', 'danger');
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
        
        if (type === 'success') {
            setTimeout(() => $status.fadeOut().addClass('d-none'), 3000);
        }
    }
});

