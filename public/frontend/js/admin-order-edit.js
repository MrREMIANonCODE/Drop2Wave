const D2W_ORDERS_KEY = 'drop2wave_orders_v1';

const editState = {
    orderId: '',
    products: [],
    items: []
};
let searchDebounceTimer = null;

function readOrdersStore() {
    try {
        const raw = localStorage.getItem(D2W_ORDERS_KEY);
        const parsed = raw ? JSON.parse(raw) : { orders: [] };
        return parsed && Array.isArray(parsed.orders) ? parsed : { orders: [] };
    } catch (err) {
        console.warn('Failed to read orders store', err);
        return { orders: [] };
    }
}

function saveOrdersStore(store) {
    try {
        localStorage.setItem(D2W_ORDERS_KEY, JSON.stringify(store));
        return true;
    } catch (err) {
        console.warn('Failed to save orders store', err);
        return false;
    }
}

function cloneStore(store) {
    try {
        return JSON.parse(JSON.stringify(store || { orders: [] }));
    } catch (err) {
        return { orders: [] };
    }
}

async function syncOrdersUniversalStrict(previousStore) {
    if (!window.UniversalData || typeof window.UniversalData.pushOrdersFromLocal !== 'function') {
        if (previousStore) saveOrdersStore(previousStore);
        alert('Universal sync is not available. Changes were not saved.');
        return false;
    }

    if (typeof window.UniversalData.ensureCloudReady === 'function') {
        const ready = await window.UniversalData.ensureCloudReady().catch(() => false);
        if (!ready) {
            if (previousStore) saveOrdersStore(previousStore);
            alert('Cloud connection failed. Please try again.');
            return false;
        }
    }

    const pushed = await window.UniversalData.pushOrdersFromLocal().catch(() => false);
    if (!pushed) {
        if (previousStore) saveOrdersStore(previousStore);
        alert('Could not sync order update to cloud.');
        return false;
    }

    return true;
}

function normalizeStatus(status) {
    const s = String(status || '').toLowerCase();
    const map = {
        confirmed: 'new',
        processing: 'complete',
        shipped: 'in_courier',
        cancelled: 'cancelled',
        delivered: 'delivered'
    };
    return map[s] || s || 'new';
}

function getStatusText(status) {
    const map = {
        new: 'New',
        complete: 'Complete',
        no_response: 'No Response',
        cancelled: 'Cancelled',
        in_courier: 'In Courier',
        hold: 'Hold',
        delivered: 'Delivered'
    };
    return map[normalizeStatus(status)] || String(status || '-');
}

function getOrderKey(order) {
    return String((order && order.orderId) || (order && order.invoiceNumber) || '');
}

function getInvoiceNumber(order) {
    const direct = String(order && order.invoiceNumber ? order.invoiceNumber : '').replace(/\D/g, '').slice(-6);
    if (direct) return direct;
    const fallback = String(order && order.orderId ? order.orderId : '').replace(/\D/g, '').slice(-6);
    return fallback || '-';
}

function parseOrderIdFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        return String(params.get('id') || params.get('orderId') || '').trim();
    } catch (err) {
        return '';
    }
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getProductsCatalog() {
    if (typeof AdminStore !== 'undefined' && typeof AdminStore.getProducts === 'function') {
        return AdminStore.getProducts().filter(p => p && p.isActive !== false);
    }
    return [];
}

function mapDeliveryArea(value) {
    const v = String(value || '').toLowerCase();
    if (v === 'outside-130' || v === '130') return 'outside-130';
    return 'dhaka-70';
}

function resolveImageUrlForAdmin(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value) return '';

    if (/^(https?:)?\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:')) {
        return value;
    }

    if (value.startsWith('/')) {
        return value;
    }

    if (value.startsWith('./')) {
        return `../${value.slice(2)}`;
    }

    if (value.startsWith('../')) {
        return value;
    }

    return `../${value}`;
}

function getProductCatalogImage(item) {
    if (typeof AdminStore === 'undefined' || typeof AdminStore.getProducts !== 'function') {
        return '';
    }

    const products = AdminStore.getProducts() || [];
    const itemId = String(item && item.id ? item.id : '').trim();
    const itemName = String(item && item.name ? item.name : '').trim().toLowerCase();

    let product = null;
    if (itemId) {
        product = products.find(p => String(p && p.id ? p.id : '') === itemId) || null;
    }

    if (!product && itemName) {
        product = products.find(p => String(p && p.name ? p.name : '').trim().toLowerCase() === itemName) || null;
    }

    if (!product) return '';

    const candidate =
        product.image ||
        product.coverImage ||
        product.thumbnail ||
        (Array.isArray(product.galleryImages) ? product.galleryImages.find(Boolean) : '') ||
        '';

    return resolveImageUrlForAdmin(candidate);
}

function getBestOrderItemImage(item) {
    const direct =
        (item && item.image) ||
        (item && item.productImage) ||
        (item && item.coverImage) ||
        (item && item.thumbnail) ||
        '';

    const directResolved = resolveImageUrlForAdmin(direct);
    if (directResolved) return directResolved;

    return getProductCatalogImage(item);
}

function renderProductsSelect() {
    const search = String($('#editSearchProduct').val() || '').trim().toLowerCase();
    const list = editState.products.filter(p => {
        if (!search) return true;
        const hay = `${p.name || ''} ${p.sku || ''}`.toLowerCase();
        return hay.includes(search);
    });

    const html = ['<option value="">Select product</option>']
        .concat(list.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || 'Product')} (Tk ${Number(p.price || 0)})</option>`))
        .join('');

    $('#editProductSelect').html(html);

    const metaEl = $('#editProductSearchMeta');
    const total = editState.products.length;
    if (!search) {
        metaEl.text(`Showing all ${total} products`).removeClass('is-empty');
    } else if (!list.length) {
        metaEl.text(`No products found for "${search}"`).addClass('is-empty');
    } else {
        metaEl.text(`${list.length} match${list.length === 1 ? '' : 'es'} from ${total} products`).removeClass('is-empty');
    }

    if (list.length === 1) {
        $('#editProductSelect').val(String(list[0].id));
    }

    renderSelectedProductPreview();
}

function renderSelectedProductPreview() {
    const selectedId = String($('#editProductSelect').val() || '').trim();
    const preview = $('#editProductPreview');

    if (!selectedId) {
        preview.html('<div class="order-product-preview-empty">Select a product to preview details before adding.</div>');
        return;
    }

    const product = editState.products.find(p => String(p.id) === selectedId);
    if (!product) {
        preview.html('<div class="order-product-preview-empty">Selected product is unavailable.</div>');
        return;
    }

    const thumb = resolveImageUrlForAdmin(product.image || product.coverImage || product.thumbnail || '');
    preview.html(`
        <div class="order-product-preview-content">
            ${thumb
                ? `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(product.name || 'Product')}" class="order-product-preview-thumb" loading="lazy">`
                : '<span class="order-product-preview-thumb order-item-thumb placeholder"><i class="fas fa-image"></i></span>'}
            <div>
                <div class="order-product-preview-title">${escapeHtml(product.name || 'Product')}</div>
                <div class="order-product-preview-sub">SKU: ${escapeHtml(product.sku || '-')} | Price: Tk ${Number(product.price || 0).toFixed(2)}</div>
            </div>
        </div>
    `);
}

function addSelectedProductToItems() {
    const id = String($('#editProductSelect').val() || '').trim();
    if (!id) {
        alert('Select a product first.');
        return;
    }

    const qtyInput = Math.max(1, Number($('#editAddQty').val() || 1) || 1);
    $('#editAddQty').val(qtyInput);

    const product = editState.products.find(p => String(p.id) === id);
    if (!product) {
        alert('Selected product not found.');
        return;
    }

    const existing = editState.items.find(it => String(it.id) === String(product.id));
    if (existing) {
        existing.quantity = Number(existing.quantity || 0) + qtyInput;
    } else {
        editState.items.push({
            id: product.id,
            name: String(product.name || 'Product'),
            quantity: qtyInput,
            price: Number(product.price || 0) || 0,
            image: String(product.image || product.coverImage || product.thumbnail || ''),
            categoryId: product.categoryId || ''
        });
    }

    $('#editProductSelect').val('');
    $('#editAddQty').val(1);
    renderItemsTable();
    renderSelectedProductPreview();
}

function renderItemsTable() {
    const tbody = $('#editItemsTbody');
    if (!editState.items.length) {
        tbody.html('<tr><td colspan="5" class="text-center text-muted">No items in this order.</td></tr>');
        updateItemsMeta();
        renderSummary();
        return;
    }

    const rows = editState.items.map((item, idx) => {
        const qty = Math.max(1, Number(item.quantity || 1) || 1);
        const price = Math.max(0, Number(item.price || 0) || 0);
        const total = qty * price;
        const itemId = String(item.id || '-');
        const imageSrc = getBestOrderItemImage(item);
        return `
            <tr>
                <td>
                    <div class="order-item-product">
                        ${imageSrc
                            ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(item.name || 'Item')}" class="order-item-thumb" loading="lazy">`
                            : '<span class="order-item-thumb placeholder"><i class="fas fa-image"></i></span>'}
                        <div>
                            <span class="order-item-name">${escapeHtml(item.name || '-')}</span>
                            <span class="order-item-id">ID: ${escapeHtml(itemId)}</span>
                        </div>
                    </div>
                </td>
                <td><input type="number" min="1" class="form-control form-control-sm edit-item-qty" data-index="${idx}" value="${qty}"></td>
                <td><input type="number" min="0" step="0.01" class="form-control form-control-sm edit-item-price" data-index="${idx}" value="${price}"></td>
                <td><span class="order-item-line-total">Tk ${total.toFixed(2)}</span></td>
                <td><button type="button" class="order-item-remove-btn edit-remove-item" data-index="${idx}">Remove</button></td>
            </tr>
        `;
    }).join('');

    tbody.html(rows);
    updateItemsMeta();
    renderSummary();
}

function updateItemsMeta() {
    const itemCount = editState.items.reduce((sum, item) => sum + (Math.max(1, Number(item.quantity || 1) || 1)), 0);
    const subtotal = editState.items.reduce((sum, item) => {
        const qty = Math.max(1, Number(item.quantity || 1) || 1);
        const price = Math.max(0, Number(item.price || 0) || 0);
        return sum + (qty * price);
    }, 0);

    $('#editItemsCount').text(itemCount);
    $('#editItemsSubtotal').text(`Tk ${subtotal.toFixed(2)}`);
}

function computePricing() {
    const subtotal = editState.items.reduce((sum, item) => {
        const q = Math.max(1, Number(item.quantity || 1) || 1);
        const p = Math.max(0, Number(item.price || 0) || 0);
        return sum + (q * p);
    }, 0);

    const shipping = Math.max(0, Number($('#editDeliveryCharge').val() || 0) || 0);
    const discountType = String($('#editDiscountType').val() || 'fixed');
    const discountAmount = Math.max(0, Number($('#editDiscountAmount').val() || 0) || 0);
    let discountValue = discountType === 'percent'
        ? (subtotal * discountAmount / 100)
        : discountAmount;

    discountValue = Math.min(discountValue, subtotal);
    const total = Math.max(0, subtotal + shipping - discountValue);

    return { subtotal, shipping, discountType, discountAmount, discountValue, total };
}

function renderSummary() {
    const p = computePricing();
    $('#summarySubtotal').text(`৳${p.subtotal.toFixed(2)}`);
    $('#summaryShipping').text(`৳${p.shipping.toFixed(2)}`);
    $('#summaryDiscountType').text(p.discountType === 'percent' ? 'Percent' : 'Fixed');
    $('#summaryDiscount').text(`- ৳${p.discountValue.toFixed(2)}`);
    $('#summaryTotal').text(`৳${p.total.toFixed(2)}`);

    const list = editState.items.length
        ? editState.items.map(item => `${escapeHtml(item.name)} <span>x${Number(item.quantity || 1)}</span>`).join('<br>')
        : 'No items';
    $('#summaryProducts').html(list);
}

function bindEvents() {
    $('#editCityArea').on('change', function() {
        const area = String($(this).val() || 'dhaka-70');
        if (!Number($('#editDeliveryCharge').val())) {
            $('#editDeliveryCharge').val(area === 'outside-130' ? 130 : 70);
        }
        renderSummary();
    });

    $('#editDiscountType, #editDiscountAmount, #editDeliveryCharge').on('input change', renderSummary);

    $('#editSearchProduct').on('input', function() {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(renderProductsSelect, 130);
    });

    $('#editSearchProduct').on('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            if (!String($('#editProductSelect').val() || '').trim()) {
                const first = $('#editProductSelect option').eq(1).val();
                if (first) {
                    $('#editProductSelect').val(String(first));
                }
            }
            addSelectedProductToItems();
            return;
        }

        if (event.key === 'ArrowDown') {
            $('#editProductSelect').focus();
        }
    });

    $('#editSearchClearBtn').on('click', function() {
        $('#editSearchProduct').val('');
        renderProductsSelect();
        $('#editSearchProduct').focus();
    });

    $('#editProductSelect').on('change', renderSelectedProductPreview);

    $('#editAddProductBtn').on('click', addSelectedProductToItems);

    $('#editAddCustomItemBtn').on('click', function() {
        const name = String(prompt('Custom item name:') || '').trim();
        if (!name) return;
        const price = Math.max(0, Number(prompt('Custom item price:') || 0) || 0);
        const qty = Math.max(1, Number(prompt('Quantity:', '1') || 1) || 1);

        editState.items.push({
            id: `custom_${Date.now()}`,
            name,
            quantity: qty,
            price,
            image: '',
            categoryId: ''
        });
        renderItemsTable();
    });

    $('#editItemsTbody').on('change input', '.edit-item-qty', function() {
        const idx = Number($(this).data('index'));
        if (!Number.isInteger(idx) || !editState.items[idx]) return;
        editState.items[idx].quantity = Math.max(1, Number($(this).val() || 1) || 1);
        renderItemsTable();
    });

    $('#editItemsTbody').on('change input', '.edit-item-price', function() {
        const idx = Number($(this).data('index'));
        if (!Number.isInteger(idx) || !editState.items[idx]) return;
        editState.items[idx].price = Math.max(0, Number($(this).val() || 0) || 0);
        renderItemsTable();
    });

    $('#editItemsTbody').on('click', '.edit-remove-item', function() {
        const idx = Number($(this).data('index'));
        if (!Number.isInteger(idx) || !editState.items[idx]) return;
        editState.items.splice(idx, 1);
        renderItemsTable();
    });

    $('#editSaveOrderBtn').on('click', saveEditedOrder);
}

function loadOrderIntoForm(order) {
    editState.orderId = getOrderKey(order);
    editState.items = (Array.isArray(order.items) ? order.items : []).map(item => ({
        id: item.id,
        name: String(item.name || 'Product'),
        quantity: Math.max(1, Number(item.quantity || 1) || 1),
        price: Math.max(0, Number(item.price || 0) || 0),
        image: String(item.image || item.productImage || item.coverImage || item.thumbnail || ''),
        categoryId: item.categoryId || ''
    }));

    $('#orderEditInvoice').text(`Invoice #${escapeHtml(getInvoiceNumber(order))}`);
    $('#editCustomerName').val(String(order.customer?.name || ''));
    $('#editCustomerPhone').val(String(order.customer?.phone || ''));
    $('#editCustomerAddress').val(String(order.customer?.address || ''));
    $('#editCustomerNote').val(String(order.customer?.specialNotes || ''));
    $('#editAdminNote').val(String(order.adminNote || ''));

    const deliveryArea = mapDeliveryArea(order.customer?.deliveryArea || order.pricing?.deliveryCharge);
    $('#editCityArea').val(deliveryArea);
    $('#editDiscountType').val(String(order.pricing?.discountType || 'fixed'));
    $('#editDiscountAmount').val(Number(order.pricing?.discountAmount || 0) || 0);
    $('#editOrderStatus').val(normalizeStatus(order.status));

    const fallbackShipping = deliveryArea === 'outside-130' ? 130 : 70;
    $('#editDeliveryCharge').val(Number(order.pricing?.deliveryCharge || fallbackShipping) || fallbackShipping);

    renderItemsTable();
}

async function saveEditedOrder() {
    const name = String($('#editCustomerName').val() || '').trim();
    const phone = String($('#editCustomerPhone').val() || '').trim();
    const address = String($('#editCustomerAddress').val() || '').trim();

    if (!name || !phone || !address) {
        alert('Name, phone and address are required.');
        return;
    }

    if (!editState.items.length) {
        alert('Please keep at least one item in order.');
        return;
    }

    const store = readOrdersStore();
    const idx = store.orders.findIndex(o => getOrderKey(o) === editState.orderId);
    if (idx === -1) {
        alert('Order not found to update.');
        return;
    }

    const previousStore = cloneStore(store);
    const existing = store.orders[idx] || {};
    const pricing = computePricing();
    const nowLabel = new Date().toLocaleString('en-BD');
    const nextStatus = normalizeStatus($('#editOrderStatus').val());
    const prevStatus = normalizeStatus(existing.status);
    const statusHistory = Array.isArray(existing.statusHistory) ? existing.statusHistory.slice() : [];

    if (nextStatus !== prevStatus) {
        statusHistory.push({
            status: nextStatus,
            timestamp: nowLabel,
            note: `Status changed from ${getStatusText(prevStatus)} to ${getStatusText(nextStatus)} from edit page`
        });
    } else {
        statusHistory.push({
            status: nextStatus,
            timestamp: nowLabel,
            note: 'Order details updated from edit page'
        });
    }

    store.orders[idx] = {
        ...existing,
        customer: {
            ...(existing.customer || {}),
            name,
            phone,
            address,
            deliveryArea: String($('#editCityArea').val() || 'dhaka-70'),
            specialNotes: String($('#editCustomerNote').val() || '').trim()
        },
        items: editState.items.map(item => {
            const qty = Math.max(1, Number(item.quantity || 1) || 1);
            const price = Math.max(0, Number(item.price || 0) || 0);
            return {
                id: item.id,
                name: item.name,
                quantity: qty,
                price,
                total: qty * price,
                image: item.image || '',
                categoryId: item.categoryId || ''
            };
        }),
        pricing: {
            subtotal: pricing.subtotal,
            deliveryCharge: pricing.shipping,
            discountType: pricing.discountType,
            discountAmount: pricing.discountAmount,
            discountValue: pricing.discountValue,
            total: pricing.total
        },
        status: nextStatus,
        adminNote: String($('#editAdminNote').val() || '').trim(),
        statusHistory
    };

    if (!saveOrdersStore(store)) {
        alert('Could not save order changes.');
        return;
    }

    const synced = await syncOrdersUniversalStrict(previousStore);
    if (!synced) return;

    alert('Order updated successfully.');
    window.location.href = 'orders.html?view=all';
}

async function initOrderEditPage() {
    if (typeof AdminStore !== 'undefined' && typeof AdminStore.isAuthenticated === 'function' && !AdminStore.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    if (window.UniversalData && typeof window.UniversalData.pullOrdersToLocal === 'function') {
        await window.UniversalData.pullOrdersToLocal().catch(() => {});
    }

    const orderId = parseOrderIdFromUrl();
    if (!orderId) {
        alert('Missing order id.');
        window.location.href = 'orders.html?view=all';
        return;
    }

    const store = readOrdersStore();
    const order = (store.orders || []).find(o => getOrderKey(o) === orderId);
    if (!order) {
        alert('Order not found.');
        window.location.href = 'orders.html?view=all';
        return;
    }

    editState.products = getProductsCatalog();
    renderProductsSelect();
    loadOrderIntoForm(order);
    renderSelectedProductPreview();
    bindEvents();
}

$(document).ready(initOrderEditPage);
