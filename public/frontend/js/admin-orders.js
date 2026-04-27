/**
 * Admin Orders - Performance-first rewrite
 * Single parse at startup, lazy detail rendering, no startup migrations.
 */

const ORDERS_KEY = 'drop2wave_orders_v1';

let allOrders = [];
let filteredOrders = [];
let ordersById = new Map();
let currentView = 'all';
let renderLimit = 30;
const renderStep = 30;
let activeDateRange = null;
let createOrderDraft = {
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerAddress: '',
    deliveryArea: 'dhaka-70',
    orderStatus: 'new',
    discountType: 'fixed',
    discountAmount: 0,
    customerNote: '',
    adminNote: '',
    items: []
};

function getViewFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        const view = String(params.get('view') || 'all').toLowerCase();
        const valid = new Set(['create', 'all', 'new', 'complete', 'no_response', 'cancelled', 'in_courier', 'hold']);
        return valid.has(view) ? view : 'all';
    } catch (e) {
        return 'all';
    }
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
    return map[status] || status;
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

function getInvoiceNumber(order) {
    const direct = String(order && order.invoiceNumber ? order.invoiceNumber : '').replace(/\D/g, '').slice(-6);
    if (direct) return direct;

    const fromOrderId = String(order && order.orderId ? order.orderId : '').replace(/\D/g, '').slice(-6);
    if (fromOrderId) return fromOrderId;

    return '-';
}

function generateUniqueInvoiceNumber(existingOrders) {
    const list = Array.isArray(existingOrders) ? existingOrders : [];
    const used = new Set(list.map(o => getInvoiceNumber(o)).filter(v => /^\d{6}$/.test(v)));

    for (let i = 0; i < 3000; i += 1) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        if (!used.has(candidate)) return candidate;
    }

    return String(Math.floor(100000 + Math.random() * 900000));
}

function getOrderKey(order) {
    return String((order && order.orderId) || (order && order.invoiceNumber) || '');
}

function readOrdersStoreFast() {
    try {
        const raw = localStorage.getItem(ORDERS_KEY);
        if (!raw) return { orders: [] };
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.orders)) return { orders: [] };
        return parsed;
    } catch (e) {
        console.warn('Could not parse orders store:', e);
        return { orders: [] };
    }
}

function saveOrdersStore(store) {
    try {
        localStorage.setItem(ORDERS_KEY, JSON.stringify(store));
        return true;
    } catch (e) {
        console.warn('Could not save orders store:', e);
        return false;
    }
}

function cloneStore(store) {
    try {
        return JSON.parse(JSON.stringify(store || { orders: [] }));
    } catch (e) {
        return { orders: [] };
    }
}

async function syncOrdersUniversalStrict(previousStore) {
    const hasUniversal = window.UniversalData && typeof window.UniversalData.pushOrdersFromLocal === 'function';
    if (!hasUniversal) {
        if (previousStore) saveOrdersStore(previousStore);
        alert('Universal sync is not available on this page. Order changes were not saved.');
        return false;
    }

    if (typeof window.UniversalData.ensureCloudReady === 'function') {
        const ready = await window.UniversalData.ensureCloudReady().catch(() => false);
        if (!ready) {
            if (previousStore) saveOrdersStore(previousStore);
            alert('Cloud connection failed. Order changes were not saved universally.');
            return false;
        }
    }

    const pushed = await window.UniversalData.pushOrdersFromLocal().catch(() => false);
    if (!pushed) {
        if (previousStore) saveOrdersStore(previousStore);
        alert('Could not sync to universal cloud storage. Please try again.');
        return false;
    }

    return true;
}

function loadOrders() {
    const store = readOrdersStoreFast();
    const list = Array.isArray(store.orders) ? store.orders : [];

    allOrders = list.map(order => ({
        ...order,
        status: normalizeStatus(order.status),
        _searchText: [
            String(getInvoiceNumber(order) || ''),
            String(order.customer?.name || ''),
            String(order.customer?.phone || '')
        ].join(' ').toLowerCase()
    }));

    allOrders.sort((a, b) => Number(b.orderTimestamp || 0) - Number(a.orderTimestamp || 0));
    ordersById = new Map(allOrders.map(o => [getOrderKey(o), o]));
}

function isOrderFromToday(order) {
    const ts = Number(order.orderTimestamp || 0);
    if (!Number.isFinite(ts) || ts <= 0) return false;

    const d = new Date(ts);
    const n = new Date();
    return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function getOrderDateValue(order) {
    const ts = Number(order && order.orderTimestamp ? order.orderTimestamp : 0);
    if (Number.isFinite(ts) && ts > 0) {
        return new Date(ts);
    }

    if (order && order.orderDate) {
        const dt = new Date(order.orderDate);
        if (!Number.isNaN(dt.getTime())) return dt;
    }

    return null;
}

function matchesDateRange(order) {
    if (!activeDateRange || !activeDateRange.startDate || !activeDateRange.endDate) {
        return true;
    }

    const dt = getOrderDateValue(order);
    if (!dt) return false;

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
    const current = dt.getTime();

    return current >= start && current <= end;
}

function getOrderViewTitle() {
    const titles = {
        create: 'Create Order',
        all: 'All Orders',
        new: 'New Orders',
        complete: 'Complete Orders',
        no_response: 'No Response Orders',
        cancelled: 'Cancel Orders',
        in_courier: 'In Courier Orders',
        hold: 'Hold Orders'
    };
    return titles[currentView] || 'All Orders';
}

function getOrderViewSubtitle() {
    const subtitles = {
        create: 'Create and submit customer orders directly from the admin panel.',
        all: 'Master control page: move orders between New, Complete, No Response, Hold, Cancel, In Courier, and Delivered.',
        new: 'New daily incoming customer orders.',
        complete: 'Verified orders confirmed by customer call.',
        no_response: 'Orders where customer did not answer.',
        cancelled: 'Orders cancelled after customer declined purchase.',
        in_courier: 'Orders handed over to courier.',
        hold: 'Orders currently on hold.'
    };
    return subtitles[currentView] || '';
}

function setupHeader() {
    const title = document.getElementById('ordersPageTitle');
    const subtitle = document.getElementById('ordersPageSubtitle');
    const filterSection = document.getElementById('filterSection');
    const statsRow = document.getElementById('statsRow');

    if (title) title.textContent = getOrderViewTitle();
    if (subtitle) subtitle.textContent = getOrderViewSubtitle();

    const hideMeta = currentView === 'create';
    if (filterSection) filterSection.style.display = hideMeta ? 'none' : '';
    if (statsRow) statsRow.style.display = hideMeta ? 'none' : '';
}

function setupEvents() {
    $('#filterStatus').on('change', applyFilters);

    let t = null;
    $('#searchOrders').on('input', function() {
        clearTimeout(t);
        t = setTimeout(applyFilters, 160);
    });

    $(document).on('click', '#logoutBtn', function() {
        if (confirm('Logout from admin panel?')) {
            if (typeof AdminStore !== 'undefined' && AdminStore.clearSession) {
                AdminStore.clearSession();
            }
                window.location.href = 'login.html?logout=1';
        }
    });

    window.addEventListener('storage', function(e) {
        if (e.key !== ORDERS_KEY) return;
        loadOrders();
        applyFilters();
        updateStats();
    });

    setInterval(function() {
        if (document.hidden) return;
        loadOrders();
        applyFilters();
        updateStats();
    }, 120000);
}

function matchesCurrentView(order) {
    if (currentView === 'all') return true;
    if (currentView === 'create') return false;
    if (currentView === 'new') return order.status === 'new' && isOrderFromToday(order);
    return order.status === currentView;
}

function applyFilters() {
    const statusFilter = String($('#filterStatus').val() || '').toLowerCase();
    const search = String($('#searchOrders').val() || '').toLowerCase().trim();

    filteredOrders = allOrders.filter(order => {
        if (!matchesCurrentView(order)) return false;
        if (!matchesDateRange(order)) return false;
        if (currentView === 'all' && statusFilter && order.status !== statusFilter) return false;
        if (search && !String(order._searchText || '').includes(search)) return false;
        return true;
    });

    renderLimit = renderStep;
    renderOrders();
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

            applyFilters();
            updateStats();
        }
    });
}

function renderCreateView() {
    const products = (typeof AdminStore !== 'undefined' && typeof AdminStore.getProducts === 'function'
        ? AdminStore.getProducts().filter(p => p && p.isActive !== false)
        : []);

    const options = ['<option value="">Select product</option>']
        .concat(products.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || 'Product')} (Tk ${Number(p.price || 0)})</option>`))
        .join('');

    $('#ordersContainer').html(`
        <div class="create-order-wrap">
            <div class="create-order-head d-flex justify-content-between align-items-center mb-3">
                <div>
                    <div class="text-muted" style="font-size:12px;">Orders</div>
                    <h5 class="mb-0">Create Order</h5>
                </div>
                <a href="orders.html?view=all" class="btn btn-outline-secondary btn-sm">Back to Orders</a>
            </div>

            <div class="row">
                <div class="col-lg-8 mb-3">
                    <div class="card-lite p-3 create-order-card">
                        <h6 class="mb-3">Customer & Shipping Information</h6>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="createCustomerName">Name</label>
                                <input type="text" class="form-control form-control-sm" id="createCustomerName" value="${escapeHtml(createOrderDraft.customerName)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label for="createCustomerPhone">Phone</label>
                                <input type="text" class="form-control form-control-sm" id="createCustomerPhone" value="${escapeHtml(createOrderDraft.customerPhone)}">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group col-md-12">
                                <label for="createCustomerEmail">Email</label>
                                <input type="text" class="form-control form-control-sm" id="createCustomerEmail" value="${escapeHtml(createOrderDraft.customerEmail)}">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group col-md-12">
                                <label for="createCustomerAddress">Address</label>
                                <input type="text" class="form-control form-control-sm" id="createCustomerAddress" value="${escapeHtml(createOrderDraft.customerAddress)}">
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="createDeliveryCharge">Delivery Charge Option</label>
                                <select class="form-control form-control-sm" id="createDeliveryCharge">
                                    <option value="dhaka-70" ${createOrderDraft.deliveryArea === 'dhaka-70' ? 'selected' : ''}>Inside Dhaka (70)</option>
                                    <option value="outside-130" ${createOrderDraft.deliveryArea === 'outside-130' ? 'selected' : ''}>Outside Dhaka (130)</option>
                                </select>
                            </div>
                            <div class="form-group col-md-6">
                                <label for="createOrderStatus">Order Status</label>
                                <select class="form-control form-control-sm" id="createOrderStatus">
                                    <option value="new" ${createOrderDraft.orderStatus === 'new' ? 'selected' : ''}>New</option>
                                    <option value="complete" ${createOrderDraft.orderStatus === 'complete' ? 'selected' : ''}>Complete</option>
                                    <option value="no_response" ${createOrderDraft.orderStatus === 'no_response' ? 'selected' : ''}>No Response</option>
                                    <option value="hold" ${createOrderDraft.orderStatus === 'hold' ? 'selected' : ''}>Hold</option>
                                    <option value="cancelled" ${createOrderDraft.orderStatus === 'cancelled' ? 'selected' : ''}>Cancelled</option>
                                    <option value="in_courier" ${createOrderDraft.orderStatus === 'in_courier' ? 'selected' : ''}>In Courier</option>
                                    <option value="delivered" ${createOrderDraft.orderStatus === 'delivered' ? 'selected' : ''}>Delivered</option>
                                </select>
                            </div>
                        </div>

                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label for="createDiscountType">Discount Type</label>
                                <select class="form-control form-control-sm" id="createDiscountType">
                                    <option value="fixed" ${createOrderDraft.discountType === 'fixed' ? 'selected' : ''}>Fixed Amount</option>
                                    <option value="percent" ${createOrderDraft.discountType === 'percent' ? 'selected' : ''}>Percentage</option>
                                </select>
                            </div>
                            <div class="form-group col-md-6">
                                <label for="createDiscountAmount">Discount Amount</label>
                                <input type="number" min="0" step="0.01" class="form-control form-control-sm" id="createDiscountAmount" value="${Number(createOrderDraft.discountAmount || 0)}">
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="createCustomerNote">Customer Note</label>
                            <textarea class="form-control form-control-sm" id="createCustomerNote" rows="2">${escapeHtml(createOrderDraft.customerNote)}</textarea>
                        </div>
                        <div class="form-group mb-3">
                            <label for="createAdminNote">Admin Note</label>
                            <textarea class="form-control form-control-sm" id="createAdminNote" rows="2">${escapeHtml(createOrderDraft.adminNote)}</textarea>
                        </div>

                        <div class="create-order-items">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <h6 class="mb-0">Order Items</h6>
                                <button type="button" class="btn btn-outline-primary btn-sm" id="addCustomItemBtn">Add Custom Item</button>
                            </div>
                            <div class="form-row align-items-end mb-2">
                                <div class="form-group col-md-7 mb-0">
                                    <label for="createProductSelect">Product</label>
                                    <select class="form-control form-control-sm" id="createProductSelect">${options}</select>
                                </div>
                                <div class="form-group col-md-2 mb-0">
                                    <label for="createProductQty">Qty</label>
                                    <input type="number" min="1" step="1" class="form-control form-control-sm" id="createProductQty" value="1">
                                </div>
                                <div class="form-group col-md-3 mb-0">
                                    <button type="button" class="btn btn-success btn-sm btn-block" id="addProductToOrderBtn">Add Product</button>
                                </div>
                            </div>

                            <div class="table-responsive admin-table-wrap">
                                <table class="table table-bordered table-sm mb-0 admin-record-table">
                                    <thead>
                                        <tr>
                                            <th>Product</th>
                                            <th>Qty</th>
                                            <th>Price</th>
                                            <th>Total</th>
                                            <th>Action</th>
                                        </tr>
                                    </thead>
                                    <tbody id="createItemsTbody"></tbody>
                                </table>
                            </div>
                        </div>

                        <div class="mt-3 d-flex justify-content-end">
                            <button type="button" class="btn btn-primary btn-sm" id="submitCreateOrderBtn">Create Order</button>
                        </div>
                    </div>
                </div>

                <div class="col-lg-4 mb-3">
                    <div class="card-lite p-3 create-summary-card">
                        <h6 class="mb-3">Order Summary</h6>
                        <div class="d-flex justify-content-between mb-1"><span class="text-muted">Subtotal</span><strong id="createSummarySubtotal">0.00</strong></div>
                        <div class="d-flex justify-content-between mb-1"><span class="text-muted">Shipping</span><strong id="createSummaryShipping">0.00</strong></div>
                        <div class="d-flex justify-content-between mb-1"><span class="text-muted">Discount</span><strong id="createSummaryDiscount">0.00</strong></div>
                        <hr>
                        <div class="d-flex justify-content-between"><span><strong>Total</strong></span><strong id="createSummaryTotal">0.00</strong></div>
                        <hr>
                        <div style="font-size:12px;color:#6b7280;">Products</div>
                        <div id="createSummaryProducts" class="mt-2 text-muted" style="font-size:12px;">No items selected</div>
                    </div>
                </div>
            </div>
        </div>
    `);

    bindCreateOrderEvents(products);
    renderCreateOrderItems();
    renderCreateOrderSummary();
}

function bindCreateOrderEvents(products) {
    const container = $('#ordersContainer');

    container.off('input change', '#createCustomerName, #createCustomerPhone, #createCustomerEmail, #createCustomerAddress, #createDeliveryCharge, #createOrderStatus, #createDiscountType, #createDiscountAmount, #createCustomerNote, #createAdminNote');
    container.on('input change', '#createCustomerName, #createCustomerPhone, #createCustomerEmail, #createCustomerAddress, #createDeliveryCharge, #createOrderStatus, #createDiscountType, #createDiscountAmount, #createCustomerNote, #createAdminNote', function() {
        createOrderDraft.customerName = String($('#createCustomerName').val() || '').trim();
        createOrderDraft.customerPhone = String($('#createCustomerPhone').val() || '').trim();
        createOrderDraft.customerEmail = String($('#createCustomerEmail').val() || '').trim();
        createOrderDraft.customerAddress = String($('#createCustomerAddress').val() || '').trim();
        createOrderDraft.deliveryArea = String($('#createDeliveryCharge').val() || 'dhaka-70');
        createOrderDraft.orderStatus = String($('#createOrderStatus').val() || 'new');
        createOrderDraft.discountType = String($('#createDiscountType').val() || 'fixed');
        createOrderDraft.discountAmount = Math.max(0, Number($('#createDiscountAmount').val() || 0) || 0);
        createOrderDraft.customerNote = String($('#createCustomerNote').val() || '').trim();
        createOrderDraft.adminNote = String($('#createAdminNote').val() || '').trim();
        renderCreateOrderSummary();
    });

    container.off('click', '#addProductToOrderBtn').on('click', '#addProductToOrderBtn', function() {
        const productId = String($('#createProductSelect').val() || '');
        const qty = Math.max(1, parseInt($('#createProductQty').val() || '1', 10) || 1);
        if (!productId) {
            alert('Please select a product first.');
            return;
        }

        const product = products.find(p => String(p.id) === productId);
        if (!product) {
            alert('Selected product not found.');
            return;
        }

        const existing = createOrderDraft.items.find(item => String(item.id) === String(product.id));
        if (existing) {
            existing.quantity = Number(existing.quantity || 0) + qty;
        } else {
            createOrderDraft.items.push({
                id: product.id,
                name: String(product.name || 'Product'),
                price: Number(product.price || 0),
                quantity: qty,
                image: String(product.image || product.coverImage || ''),
                categoryId: product.categoryId || ''
            });
        }

        $('#createProductSelect').val('');
        $('#createProductQty').val(1);
        renderCreateOrderItems();
        renderCreateOrderSummary();
    });

    container.off('click', '#addCustomItemBtn').on('click', '#addCustomItemBtn', function() {
        const name = String(prompt('Custom item name:') || '').trim();
        if (!name) return;
        const price = Math.max(0, Number(prompt('Custom item price:') || 0) || 0);
        const qty = Math.max(1, parseInt(prompt('Quantity:', '1') || '1', 10) || 1);

        createOrderDraft.items.push({
            id: 'custom_' + Date.now(),
            name,
            price,
            quantity: qty,
            image: '',
            categoryId: ''
        });

        renderCreateOrderItems();
        renderCreateOrderSummary();
    });

    container.off('click', '.remove-create-item').on('click', '.remove-create-item', function() {
        const idx = Number($(this).data('index'));
        if (!Number.isInteger(idx) || idx < 0 || idx >= createOrderDraft.items.length) return;
        createOrderDraft.items.splice(idx, 1);
        renderCreateOrderItems();
        renderCreateOrderSummary();
    });

    container.off('change', '.create-item-qty').on('change', '.create-item-qty', function() {
        const idx = Number($(this).data('index'));
        const qty = Math.max(1, parseInt($(this).val() || '1', 10) || 1);
        if (!Number.isInteger(idx) || idx < 0 || idx >= createOrderDraft.items.length) return;
        createOrderDraft.items[idx].quantity = qty;
        renderCreateOrderItems();
        renderCreateOrderSummary();
    });

    container.off('click', '#submitCreateOrderBtn').on('click', '#submitCreateOrderBtn', function() {
        submitCreateOrder();
    });
}

function getCreatePricing() {
    const subtotal = createOrderDraft.items.reduce((sum, item) => sum + ((Number(item.price || 0) || 0) * (Number(item.quantity || 0) || 0)), 0);
    const shipping = createOrderDraft.deliveryArea === 'outside-130' ? 130 : 70;
    const discountAmount = Math.max(0, Number(createOrderDraft.discountAmount || 0) || 0);

    let discount = 0;
    if (createOrderDraft.discountType === 'percent') {
        discount = subtotal * (discountAmount / 100);
    } else {
        discount = discountAmount;
    }
    discount = Math.min(discount, subtotal);

    const total = Math.max(0, subtotal + shipping - discount);
    return { subtotal, shipping, discount, total };
}

function renderCreateOrderItems() {
    const tbody = $('#createItemsTbody');
    if (!tbody.length) return;

    if (!createOrderDraft.items.length) {
        tbody.html('<tr><td colspan="5" class="text-center text-muted">No items added yet.</td></tr>');
        return;
    }

    const rows = createOrderDraft.items.map((item, idx) => {
        const qty = Math.max(1, Number(item.quantity || 1) || 1);
        const price = Number(item.price || 0) || 0;
        return `
            <tr>
                <td>${escapeHtml(item.name || '-')}</td>
                <td style="width:90px;"><input type="number" min="1" class="form-control form-control-sm create-item-qty" data-index="${idx}" value="${qty}"></td>
                <td>Tk ${price.toFixed(2)}</td>
                <td>Tk ${(price * qty).toFixed(2)}</td>
                <td><button type="button" class="btn btn-outline-danger btn-sm remove-create-item" data-index="${idx}">Remove</button></td>
            </tr>
        `;
    }).join('');

    tbody.html(rows);
}

function renderCreateOrderSummary() {
    const pricing = getCreatePricing();
    $('#createSummarySubtotal').text(pricing.subtotal.toFixed(2));
    $('#createSummaryShipping').text(pricing.shipping.toFixed(2));
    $('#createSummaryDiscount').text(pricing.discount.toFixed(2));
    $('#createSummaryTotal').text(pricing.total.toFixed(2));

    const summaryList = createOrderDraft.items.length
        ? createOrderDraft.items.map(item => `${escapeHtml(item.name || '-')}: ${Number(item.quantity || 0)} x Tk ${Number(item.price || 0)}`).join('<br>')
        : 'No items selected';
    $('#createSummaryProducts').html(summaryList);
}

async function submitCreateOrder() {
    createOrderDraft.customerName = String($('#createCustomerName').val() || '').trim();
    createOrderDraft.customerPhone = String($('#createCustomerPhone').val() || '').trim();
    createOrderDraft.customerEmail = String($('#createCustomerEmail').val() || '').trim();
    createOrderDraft.customerAddress = String($('#createCustomerAddress').val() || '').trim();
    createOrderDraft.deliveryArea = String($('#createDeliveryCharge').val() || 'dhaka-70');
    createOrderDraft.orderStatus = String($('#createOrderStatus').val() || 'new');
    createOrderDraft.discountType = String($('#createDiscountType').val() || 'fixed');
    createOrderDraft.discountAmount = Math.max(0, Number($('#createDiscountAmount').val() || 0) || 0);
    createOrderDraft.customerNote = String($('#createCustomerNote').val() || '').trim();
    createOrderDraft.adminNote = String($('#createAdminNote').val() || '').trim();

    if (!createOrderDraft.customerName || !createOrderDraft.customerPhone || !createOrderDraft.customerAddress) {
        alert('Name, phone, and address are required.');
        return;
    }

    if (!createOrderDraft.items.length) {
        alert('Please add at least one product item.');
        return;
    }

    const pricing = getCreatePricing();
    const now = Date.now();
    const store = readOrdersStoreFast();
    const invoiceNo = generateUniqueInvoiceNumber(store.orders || []);
    const orderId = invoiceNo;

    const statusNoteMap = {
        new: 'Order created from admin create page',
        complete: 'Order created and marked complete from admin create page',
        no_response: 'Order created and marked no response from admin create page',
        hold: 'Order created and marked hold from admin create page',
        cancelled: 'Order created and marked cancelled from admin create page',
        in_courier: 'Order created and marked in courier from admin create page',
        delivered: 'Order created and marked delivered from admin create page'
    };

    const order = {
        orderId,
        invoiceNumber: invoiceNo,
        orderDate: new Date(now).toISOString(),
        orderTimestamp: now,
        orderTime: new Date(now).toLocaleString('en-BD'),
        customer: {
            name: createOrderDraft.customerName,
            phone: createOrderDraft.customerPhone,
            email: createOrderDraft.customerEmail,
            address: createOrderDraft.customerAddress,
            deliveryArea: createOrderDraft.deliveryArea,
            specialNotes: createOrderDraft.customerNote
        },
        items: createOrderDraft.items.map(item => ({
            id: item.id,
            name: item.name,
            price: Number(item.price || 0) || 0,
            quantity: Number(item.quantity || 0) || 0,
            total: (Number(item.price || 0) || 0) * (Number(item.quantity || 0) || 0),
            image: item.image || '',
            categoryId: item.categoryId || ''
        })),
        pricing: {
            subtotal: pricing.subtotal,
            deliveryCharge: pricing.shipping,
            discountType: createOrderDraft.discountType,
            discountAmount: createOrderDraft.discountAmount,
            discountValue: pricing.discount,
            total: pricing.total
        },
        status: createOrderDraft.orderStatus,
        adminNote: createOrderDraft.adminNote,
        statusHistory: [
            {
                status: createOrderDraft.orderStatus,
                timestamp: new Date(now).toLocaleString('en-BD'),
                note: statusNoteMap[createOrderDraft.orderStatus] || 'Order created from admin create page'
            }
        ]
    };

    const previousStore = cloneStore(store);
    if (!Array.isArray(store.orders)) store.orders = [];
    store.orders.unshift(order);

    if (!saveOrdersStore(store)) {
        alert('Could not create order.');
        return;
    }

    const synced = await syncOrdersUniversalStrict(previousStore);
    if (!synced) {
        loadOrders();
        return;
    }

    createOrderDraft = {
        customerName: '',
        customerPhone: '',
        customerEmail: '',
        customerAddress: '',
        deliveryArea: 'dhaka-70',
        orderStatus: 'new',
        discountType: 'fixed',
        discountAmount: 0,
        customerNote: '',
        adminNote: '',
        items: []
    };

    alert('Order created successfully.');
    window.location.href = 'orders.html?view=all';
}

function formatOrderTime(order) {
    try {
        if (order.orderDate) {
            const dt = new Date(order.orderDate);
            if (!Number.isNaN(dt.getTime())) {
                return dt.toLocaleString('en-BD', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        }
    } catch (e) {
        // Fall through to stored label.
    }
    return String(order.orderTime || '-');
}

function formatOrderDateWithAge(order) {
    const dt = getOrderDateValue(order);
    if (!dt) return { primary: '-', secondary: '' };

    const primary = dt.toLocaleString('en-BD', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    const diffMs = Math.max(0, Date.now() - dt.getTime());
    const diffMin = Math.floor(diffMs / 60000);
    let secondary = '';

    if (diffMin < 1) {
        secondary = 'just now';
    } else if (diffMin < 60) {
        secondary = `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
    } else {
        const diffHr = Math.floor(diffMin / 60);
        if (diffHr < 24) {
            secondary = `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
        } else {
            const diffDay = Math.floor(diffHr / 24);
            secondary = `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
        }
    }

    return { primary, secondary };
}

function getOrderIpAddress(order) {
    const candidate = order && (
        order.ipAddress ||
        order.ip ||
        order.clientIp ||
        (order.meta && order.meta.ipAddress) ||
        (order.customer && order.customer.ipAddress)
    );
    return String(candidate || '-');
}

function getTrackingText(order) {
    const tracking = order && (
        order.trackingNumber ||
        order.trackingId ||
        order.tracking ||
        (order.courier && (order.courier.tracking || order.courier.trackingId))
    );
    return String(tracking || '-');
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

    // Most storefront image paths are relative to /public (e.g., uploads/foo.jpg, assets/x.png)
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

function getOrderMainImage(order) {
    const items = Array.isArray(order && order.items) ? order.items : [];
    for (let i = 0; i < items.length; i += 1) {
        const src = getBestOrderItemImage(items[i]);
        if (src) return src;
    }
    return '';
}

function promptNextStatus(currentStatus) {
    const allowed = ['new', 'complete', 'no_response', 'hold', 'cancelled', 'in_courier', 'delivered'];
    const input = prompt(
        'Set new status:\nnew, complete, no_response, hold, cancelled, in_courier, delivered',
        String(currentStatus || 'new')
    );
    if (input === null) return null;

    const next = String(input || '').trim().toLowerCase();
    if (!allowed.includes(next)) {
        alert('Invalid status. Use one of: new, complete, no_response, hold, cancelled, in_courier, delivered');
        return null;
    }
    return next;
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getItemSummary(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (!items.length) return '-';

    const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity || 0) || 0), 0);
    const first = items[0] && items[0].name ? items[0].name : 'Item';
    const extra = items.length > 1 ? ` +${items.length - 1} more` : '';
    return `${first}${extra} (${totalQty} qty)`;
}

function renderOrders() {
    if (currentView === 'create') {
        renderCreateView();
        return;
    }

    const container = $('#ordersContainer');
    if (!filteredOrders.length) {
        container.html(`
            <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <h3>No orders found</h3>
                <p>No orders matched this page criteria.</p>
            </div>
        `);
        return;
    }

    const shown = filteredOrders.slice(0, renderLimit);
    const remaining = filteredOrders.length - shown.length;

    const rows = shown.map((order, idx) => {
        const orderId = getOrderKey(order) || '-';
        const invoiceNo = getInvoiceNumber(order);
        const serial = idx + 1;
        const trackingText = getTrackingText(order);
        const imageSrc = getOrderMainImage(order);
        const statusText = getStatusText(order.status);
        const customerName = String(order.customer?.name || '-');
        const phone = String(order.customer?.phone || '-');
        const address = String(order.customer?.address || '-');
        const ipAddress = getOrderIpAddress(order);
        const total = Number(order.pricing?.total || 0).toLocaleString();
        const dateMeta = formatOrderDateWithAge(order);

        return `
            <tr>
                <td class="orders-col-sl">${serial}</td>
                <td class="orders-col-image">
                    ${imageSrc ? `<img src="${escapeHtml(imageSrc)}" alt="Order product" class="orders-thumb">` : '<div class="orders-thumb orders-thumb-placeholder"><i class="fas fa-image"></i></div>'}
                </td>
                <td class="orders-col-invoice"><strong>${escapeHtml(invoiceNo)}</strong></td>
                <td class="orders-col-tracking">${escapeHtml(trackingText)}</td>
                <td class="orders-col-date">
                    <div class="orders-date-main">${escapeHtml(dateMeta.primary)}</div>
                    <div class="orders-date-sub">${escapeHtml(dateMeta.secondary)}</div>
                </td>
                <td class="orders-col-customer">
                    <div class="orders-customer-name">${escapeHtml(customerName)}</div>
                    <div class="orders-customer-address">${escapeHtml(address)}</div>
                    <div class="orders-customer-phone">${escapeHtml(phone)}</div>
                </td>
                <td class="orders-col-ip">${escapeHtml(ipAddress)}</td>
                <td class="orders-col-amount"><strong>Tk ${total}</strong></td>
                <td class="orders-col-status"><span class="status-badge status-${order.status}">${statusText}</span></td>
                <td class="orders-col-action">
                    <div class="orders-actions-wrap">
                        <button class="orders-action-btn orders-action-invoice toggle-order-details" data-order-id="${escapeHtml(orderId)}" type="button"><i class="far fa-eye"></i> Invoice</button>
                        <button class="orders-action-btn orders-action-edit toggle-order-details" data-order-id="${escapeHtml(orderId)}" type="button"><i class="far fa-edit"></i> Edit</button>
                        <button class="orders-action-btn orders-action-update quick-update-btn" data-order-id="${escapeHtml(orderId)}" data-current-status="${escapeHtml(order.status)}" type="button"><i class="fas fa-sync-alt"></i> Update</button>
                        <button class="orders-action-btn orders-action-delete delete-order-btn" data-order-id="${escapeHtml(orderId)}" type="button"><i class="far fa-trash-alt"></i> Delete</button>
                    </div>
                </td>
            </tr>
            <tr class="order-detail-row d-none" data-order-id="${escapeHtml(orderId)}">
                <td colspan="10">
                    <div class="order-inline-detail">${renderOrderBody(order, true)}</div>
                </td>
            </tr>
        `;
    }).join('');

    container.html(`
        <div class="table-responsive admin-table-wrap orders-table-wrap">
            <table class="table table-hover table-bordered mb-0 admin-record-table orders-table">
                <thead>
                    <tr>
                        <th class="orders-col-sl">SL</th>
                        <th class="orders-col-image">Image</th>
                        <th class="orders-col-invoice">Invoice</th>
                        <th class="orders-col-tracking">Tracking</th>
                        <th class="orders-col-date">Date</th>
                        <th class="orders-col-customer">Customer</th>
                        <th class="orders-col-ip">IP Address</th>
                        <th class="orders-col-amount">Amount</th>
                        <th class="orders-col-status">Status</th>
                        <th class="orders-col-action">Action</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
        ${remaining > 0 ? `
            <div class="text-center mt-3">
                <button class="btn btn-outline-secondary btn-sm" id="loadMoreOrdersBtn">Load More (${remaining} remaining)</button>
            </div>
        ` : ''}
    `);

    container.off('click', '#loadMoreOrdersBtn').on('click', '#loadMoreOrdersBtn', function() {
        renderLimit += renderStep;
        renderOrders();
    });

    container.off('click', '.toggle-order-details').on('click', '.toggle-order-details', function() {
        const $row = $(this).closest('tr').next('.order-detail-row');
        const open = !$row.hasClass('d-none');

        if (open) {
            $row.addClass('d-none');
            $(this).text('Details');
        } else {
            $row.removeClass('d-none');
            $(this).text('Hide');
        }
    });

    container.off('click', '.apply-status').on('click', '.apply-status', function() {
        const orderId = String($(this).data('order-id') || '');
        const next = String($(this).closest('td').find('.quick-status').val() || '');
        if (!next) return;
        updateOrderStatus(orderId, next);
    });

    container.off('click', '.quick-update-btn').on('click', '.quick-update-btn', function() {
        const orderId = String($(this).data('order-id') || '');
        const currentStatus = String($(this).data('current-status') || 'new');
        if (!orderId) return;
        const nextStatus = promptNextStatus(currentStatus);
        if (!nextStatus || nextStatus === currentStatus) return;
        updateOrderStatus(orderId, nextStatus);
    });

    container.off('click', '.delete-order-btn').on('click', '.delete-order-btn', function() {
        const orderId = String($(this).data('order-id') || '');
        if (!orderId) return;
        deleteOrder(orderId);
    });
}

function renderOrderBody(order, compactMode) {
    const compact = compactMode === true;
    const canControl = currentView === 'all';
    const statusText = getStatusText(order.status);

    const controlBlock = canControl ? `
        <div class="order-section">
            <div class="section-title"><i class="fas fa-random"></i> Move Order (All Orders Control)</div>
            <div class="status-update-section">
                <div style="font-size:12px;color:#6b7280;margin-bottom:10px;">Current: <strong>${statusText}</strong></div>
                <div class="status-controls">
                    ${renderStatusBtn(order, 'new', 'bell', 'New')}
                    ${renderStatusBtn(order, 'complete', 'check-circle', 'Complete')}
                    ${renderStatusBtn(order, 'no_response', 'phone-slash', 'No Response')}
                    ${renderStatusBtn(order, 'hold', 'pause-circle', 'Hold')}
                    ${renderStatusBtn(order, 'cancelled', 'times-circle', 'Cancel')}
                    ${renderStatusBtn(order, 'in_courier', 'shipping-fast', 'In Courier')}
                    ${renderStatusBtn(order, 'delivered', 'box', 'Delivered')}
                </div>
            </div>
        </div>
    ` : '';

    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];

    const actionBlock = compact ? '' : `
        <div class="order-section">
            <div class="action-buttons">
                <button class="btn-action btn-delete" onclick="deleteOrder('${order.orderId}')"><i class="fas fa-trash"></i> Delete Order</button>
            </div>
        </div>
    `;

    return `
        <div class="order-section">
            <div class="section-title"><i class="fas fa-user"></i> Customer</div>
            <div class="info-row"><span class="info-label">Name:</span><span class="info-value">${order.customer?.name || '-'}</span></div>
            <div class="info-row"><span class="info-label">Phone:</span><span class="info-value"><a href="tel:${order.customer?.phone || ''}">${order.customer?.phone || '-'}</a></span></div>
            <div class="info-row"><span class="info-label">Address:</span><span class="info-value">${order.customer?.address || '-'}</span></div>
            <div class="info-row"><span class="info-label">Area:</span><span class="info-value">${getDeliveryAreaText(order.customer?.deliveryArea || '')}</span></div>
            ${order.customer?.specialNotes ? `<div class="info-row"><span class="info-label">Note:</span><span class="info-value">${order.customer.specialNotes}</span></div>` : ''}
        </div>

        <div class="order-section">
            <div class="section-title"><i class="fas fa-box"></i> Items</div>
            ${(order.items || []).map(item => {
                const itemImage = getBestOrderItemImage(item);
                return `
                <div class="product-item">
                    ${itemImage ? `<div class="product-image"><img src="${itemImage}" alt="${item.name}" loading="lazy" onerror="this.style.display='none'"></div>` : `<div class="product-image"><i class="fas fa-image" style="color:#999;font-size:20px;"></i></div>`}
                    <div class="product-info">
                        <div class="product-name">${item.name}</div>
                        <div class="product-meta">Qty: <strong>${item.quantity}</strong> | Price: <strong>Tk ${item.price}</strong> | Total: <span class="product-price">Tk ${(Number(item.price || 0) * Number(item.quantity || 0)).toLocaleString()}</span></div>
                    </div>
                </div>
            `;
            }).join('')}
        </div>

        <div class="order-section">
            <div class="section-title"><i class="fas fa-receipt"></i> Pricing</div>
            <div class="info-row"><span class="info-label">Subtotal:</span><span class="info-value">Tk ${Number(order.pricing?.subtotal || 0).toLocaleString()}</span></div>
            <div class="info-row"><span class="info-label">Delivery:</span><span class="info-value">Tk ${Number(order.pricing?.deliveryCharge || 0).toLocaleString()}</span></div>
            <div class="info-row" style="font-size:14px;font-weight:700;padding:12px 8px;border:1px solid #f0f0f0;border-radius:4px;"><span class="info-label">Total:</span><span class="info-value" style="color:#f85606;font-size:16px;">Tk ${Number(order.pricing?.total || 0).toLocaleString()}</span></div>
        </div>

        ${controlBlock}

        <div class="order-section">
            <div class="section-title"><i class="fas fa-history"></i> History</div>
            <div style="font-size:12px;">
                ${history.map(h => `
                    <div style="padding:8px;border-left:3px solid #f85606;margin-bottom:8px;background:#f9fafb;padding-left:10px;">
                        <strong>${getStatusText(normalizeStatus(h.status))}</strong> - ${h.timestamp || '-'}
                        <div style="color:#6b7280;font-size:11px;margin-top:2px;">${h.note || ''}</div>
                    </div>
                `).join('')}
            </div>
        </div>

        ${actionBlock}
    `;
}

function renderStatusBtn(order, status, icon, label) {
    const active = order.status === status ? 'active' : '';
    return `<button class="btn-status ${active}" onclick="updateOrderStatus('${order.orderId}', '${status}')"><i class="fas fa-${icon}"></i> ${label}</button>`;
}

async function updateOrderStatus(orderId, newStatus) {
    const notes = {
        new: 'New order received',
        complete: 'Customer verified and order confirmed',
        no_response: 'Customer did not answer call',
        cancelled: 'Customer cancelled the order',
        in_courier: 'Order handed over to courier',
        hold: 'Order put on hold',
        delivered: 'Order delivered successfully'
    };

    const store = readOrdersStoreFast();
    const previousStore = cloneStore(store);
    const order = (store.orders || []).find(o => getOrderKey(o) === String(orderId));
    if (!order) return;

    order.status = newStatus;
    const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
    history.push({
        status: newStatus,
        timestamp: new Date().toLocaleString('en-BD'),
        note: notes[newStatus] || 'Status updated'
    });
    order.statusHistory = history;

    if (!saveOrdersStore(store)) {
        alert('Could not update order status.');
        return;
    }

    const synced = await syncOrdersUniversalStrict(previousStore);
    if (!synced) {
        loadOrders();
        applyFilters();
        updateStats();
        return;
    }

    loadOrders();
    applyFilters();
    updateStats();
}

async function deleteOrder(orderId) {
    if (!confirm('Delete this order permanently?')) return;

    const store = readOrdersStoreFast();
    const previousStore = cloneStore(store);
    const before = (store.orders || []).length;
    store.orders = (store.orders || []).filter(o => getOrderKey(o) !== String(orderId));

    if (store.orders.length === before) return;
    if (!saveOrdersStore(store)) {
        alert('Could not delete order.');
        return;
    }

    const synced = await syncOrdersUniversalStrict(previousStore);
    if (!synced) {
        loadOrders();
        applyFilters();
        updateStats();
        return;
    }

    loadOrders();
    applyFilters();
    updateStats();
}

function updateStats() {
    const source = allOrders.filter(o => matchesCurrentView(o) && matchesDateRange(o));
    const total = source.length;
    const newCount = source.filter(o => o.status === 'new').length;
    const completeCount = source.filter(o => o.status === 'complete').length;
    const inCourierCount = source.filter(o => o.status === 'in_courier').length;

    $('#totalOrders').text(total);
    $('#confirmedOrders').text(newCount);
    $('#shippedOrders').text(completeCount);
    $('#deliveredOrders').text(inCourierCount);
}

function init() {
    if (typeof AdminStore !== 'undefined' && AdminStore.isAuthenticated && !AdminStore.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    currentView = getViewFromUrl();
    setupHeader();
    setupDateRangeFilter();
    setupEvents();

    $('#ordersContainer').html(`
        <div class="empty-state">
            <i class="fas fa-spinner fa-spin"></i>
            <h3>Loading orders...</h3>
            <p>Please wait.</p>
        </div>
    `);

    requestAnimationFrame(async function() {
        if (window.UniversalData && typeof window.UniversalData.pullOrdersToLocal === 'function') {
            await window.UniversalData.pullOrdersToLocal().catch(() => {});
        }

        loadOrders();
        $('#filterStatus').val('');
        applyFilters();
        updateStats();

        if (window.UniversalData && typeof window.UniversalData.subscribeToOrders === 'function') {
            window.UniversalData.subscribeToOrders(function() {
                loadOrders();
                applyFilters();
                updateStats();
            }).catch(() => {});
        }
    });
}

$(document).ready(init);
