const D2W_ORDERS_KEY = 'drop2wave_orders_v1';

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

function parseOrderIdFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        return String(params.get('id') || params.get('orderId') || '').trim();
    } catch (err) {
        return '';
    }
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

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

function getDeliveryAreaText(area) {
    const map = {
        'dhaka-70': 'Inside Dhaka (70)',
        'dhaka-60': 'Inside Dhaka (70)',
        '70': 'Inside Dhaka (70)',
        '60': 'Inside Dhaka (70)',
        'outside-130': 'Outside Dhaka (130)',
        '130': 'Outside Dhaka (130)'
    };
    return map[String(area || '')] || String(area || '-');
}

function formatInvoiceDate(order) {
    const direct = order && (order.orderDate || order.orderTime || order.createdAt);
    const dt = direct ? new Date(direct) : null;
    if (dt && !Number.isNaN(dt.getTime())) {
        return dt.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
    }
    const fallback = Number(order && order.orderTimestamp ? order.orderTimestamp : 0);
    if (fallback) {
        return new Date(fallback).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit'
        });
    }
    return '-';
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

function getOrderById(orderId) {
    if (!orderId) return null;
    const store = readOrdersStore();
    return (store.orders || []).find(order => getOrderKey(order) === String(orderId)) || null;
}

function renderInvoice(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    const subtotal = Number(order.pricing?.subtotal || 0) || 0;
    const shipping = Number(order.pricing?.deliveryCharge || 0) || 0;
    const discount = Number(order.pricing?.discountValue || order.pricing?.discountAmount || 0) || 0;
    const total = Number(order.pricing?.total || subtotal + shipping - discount) || 0;
    const customer = order.customer || {};

    $('#invoiceNumber').text(`#${escapeHtml(getInvoiceNumber(order))}`);
    $('#invoiceDate').text(formatInvoiceDate(order));
    $('#invoiceCustomerName').text(String(customer.name || '-'));
    $('#invoiceCustomerAddress').text(String(customer.address || '-'));
    $('#invoiceCustomerPhone').text(String(customer.phone || '-'));
    $('#invoiceCustomerArea').text(getDeliveryAreaText(customer.deliveryArea || ''));

    const rows = items.length
        ? items.map((item, idx) => {
            const qty = Math.max(1, Number(item.quantity || 1) || 1);
            const price = Math.max(0, Number(item.price || 0) || 0);
            const lineTotal = qty * price;
            const image = getBestOrderItemImage(item);
            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>
                        <div class="invoice-item-product">
                            ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.name || 'Product')}" class="invoice-item-thumb" loading="lazy">` : '<div class="invoice-item-thumb invoice-item-thumb-placeholder"><i class="fas fa-image"></i></div>'}
                            <div class="invoice-item-name">${escapeHtml(item.name || '-')}</div>
                        </div>
                    </td>
                    <td>৳${price.toFixed(2)}</td>
                    <td>${qty}</td>
                    <td>৳${lineTotal.toFixed(2)}</td>
                </tr>
            `;
        }).join('')
        : '<tr><td colspan="5" class="text-center text-muted">No items found</td></tr>';

    $('#invoiceItemsTbody').html(rows);
    $('#invoiceSubtotal').text(`৳${subtotal.toFixed(2)}`);
    $('#invoiceShipping').text(`৳${shipping.toFixed(2)}`);
    $('#invoiceDiscount').text(`৳${discount.toFixed(2)}`);
    $('#invoiceTotal').text(`৳${total.toFixed(2)}`);
}

function renderMissingInvoice() {
    $('#invoicePageRoot').html(`
        <div class="invoice-page-toolbar">
            <a href="orders.html?view=all" class="invoice-back-link"><i class="fas fa-arrow-left"></i> Back To Order</a>
        </div>
        <div class="invoice-stage">
            <div class="invoice-sheet invoice-empty-sheet">
                <div class="invoice-empty-title">Invoice not found</div>
                <p class="invoice-empty-text">The order you requested could not be loaded.</p>
                <a href="orders.html?view=all" class="invoice-print-btn invoice-empty-btn">Back To Orders</a>
            </div>
        </div>
    `);
}

function initInvoicePage() {
    if (typeof AdminStore !== 'undefined' && typeof AdminStore.isAuthenticated === 'function' && !AdminStore.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    const orderId = parseOrderIdFromUrl();
    const order = getOrderById(orderId);
    if (!order) {
        renderMissingInvoice();
        return;
    }

    document.title = `Invoice #${getInvoiceNumber(order)} - Drop2Wave Admin`;
    renderInvoice(order);

    $('#invoicePrintBtn').on('click', function() {
        window.print();
    });
}

$(initInvoicePage);
