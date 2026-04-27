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
    
    await AdminStore.syncFromCloud();

    loadCategories();
    setupFormHandler();
    setupLogout();
    startLiveStoreListener();

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
        const $table = $('#categoryTableBody');
        
        if (!$table.length) return;
        
        if (categories.length === 0) {
            $table.html('<tr><td colspan="7" class="text-center text-muted">No categories yet</td></tr>');
            return;
        }
        
        $table.html(categories.map((cat, idx) => `
            <tr>
                <td>${idx + 1}</td>
                <td>${cat.image ? `<img src="${cat.image}" alt="${cat.name}" style="width:52px;height:52px;object-fit:cover;border-radius:8px;">` : '-'}</td>
                <td>${cat.name}</td>
                <td>${cat.slug || '-'}</td>
                <td>${cat.sortOrder || 0}</td>
                <td><span class="badge badge-${cat.isActive === false ? 'secondary' : 'success'}">${cat.isActive === false ? 'Inactive' : 'Active'}</span></td>
                <td>
                    <button class="btn btn-sm btn-warning edit-btn" data-id="${cat.id}">Edit</button>
                    <button class="btn btn-sm btn-danger delete-btn" data-id="${cat.id}">Delete</button>
                </td>
            </tr>
        `).join(''));
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
            
            const category = {
                id: 'cat_' + Date.now(),
                name: name,
                slug: slug,
                image: $categoryImage.val().trim(),
                description: $categoryDescription.val().trim(),
                sortOrder: parseInt($categorySortOrder.val(), 10) || 0,
                isActive: $categoryIsActive.is(':checked')
            };
            
            try {
                AdminStore.addCategory(category);
                showStatus('Category added successfully!', 'success');
                $form[0].reset();
                $categoryIsActive.prop('checked', true);
                $('#categoryImagePreview').hide();
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

