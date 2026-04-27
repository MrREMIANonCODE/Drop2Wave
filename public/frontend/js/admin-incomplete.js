$(document).ready(function() {
    const INCOMPLETE_KEY = 'drop2wave_incomplete_orders_v1';
    const $status = $('#statusMessage');
    let activeDateRange = null;

    if (!AdminStore.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }

    setupDateRangeFilter();
    loadIncomplete();
    setupEvents();

    if (window.UniversalData && typeof window.UniversalData.pullIncompleteToLocal === 'function') {
        window.UniversalData.pullIncompleteToLocal().then(() => {
            loadIncomplete();
        }).catch(() => {});
    }

    if (window.UniversalData && typeof window.UniversalData.subscribeToIncomplete === 'function') {
        window.UniversalData.subscribeToIncomplete(function() {
            loadIncomplete();
        }).catch(() => {});
    }

    function readList() {
        try {
            const parsed = JSON.parse(localStorage.getItem(INCOMPLETE_KEY) || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (err) {
            return [];
        }
    }

    function writeList(list) {
        localStorage.setItem(INCOMPLETE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    }

    async function syncIncompleteUniversalStrict(previousList) {
        const hasUniversal = window.UniversalData && typeof window.UniversalData.pushIncompleteFromLocal === 'function';
        if (!hasUniversal) {
            writeList(previousList || []);
            alert('Universal sync is not available on this page. Changes were not saved.');
            return false;
        }

        if (typeof window.UniversalData.ensureCloudReady === 'function') {
            const ready = await window.UniversalData.ensureCloudReady().catch(() => false);
            if (!ready) {
                writeList(previousList || []);
                alert('Cloud connection failed. Changes were not saved universally.');
                return false;
            }
        }

        const pushed = await window.UniversalData.pushIncompleteFromLocal().catch(() => false);
        if (!pushed) {
            writeList(previousList || []);
            alert('Could not sync incomplete data to universal storage. Please try again.');
            return false;
        }

        return true;
    }

    function esc(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function fmt(ts) {
        const d = new Date(Number(ts || Date.now()));
        return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('en-BD');
    }

    function getEntryTimestamp(entry) {
        const updated = Number(entry && entry.updatedAt ? entry.updatedAt : 0);
        if (Number.isFinite(updated) && updated > 0) return updated;
        const created = Number(entry && entry.createdAt ? entry.createdAt : 0);
        if (Number.isFinite(created) && created > 0) return created;
        return 0;
    }

    function inDateRange(timestamp) {
        if (!activeDateRange || !activeDateRange.startDate || !activeDateRange.endDate) return true;
        if (!Number.isFinite(timestamp) || timestamp <= 0) return false;

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

        return timestamp >= start && timestamp <= end;
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
                loadIncomplete();
            }
        });
    }

    function loadIncomplete() {
        const list = readList()
            .filter(entry => inDateRange(getEntryTimestamp(entry)))
            .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
        $('#incompleteCount').text(list.length);

        if (!list.length) {
            $('#incompleteList').html('<div class="text-muted">No incomplete checkout attempts found.</div>');
            return;
        }

        const rows = list.map((entry, idx) => {
            const c = entry.customer || {};
            const items = Array.isArray(entry.items) ? entry.items : [];
            const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity || 0) || 0), 0);
            const firstItem = items.length ? String(items[0].name || 'Item') : '-';
            const itemText = items.length ? `${firstItem}${items.length > 1 ? ` +${items.length - 1} more` : ''} (${totalQty} qty)` : '-';
            const hasMissing = [];
            if (!String(c.name || '').trim()) hasMissing.push('name');
            if (!String(c.phone || '').trim()) hasMissing.push('phone');
            if (!String(c.address || '').trim()) hasMissing.push('address');
            if (!items.length) hasMissing.push('items');

            return `
                <tr>
                    <td>${idx + 1}</td>
                    <td>${esc(c.name || '-')}</td>
                    <td>${esc(c.phone || '-')}</td>
                    <td style="max-width:260px;">${esc(c.address || '-')}</td>
                    <td style="min-width:220px;">${esc(itemText)}</td>
                    <td><span class="badge badge-warning">${hasMissing.length ? esc(hasMissing.join(', ')) : 'none'}</span></td>
                    <td>${esc(fmt(entry.updatedAt))}</td>
                    <td>${esc(fmt(entry.createdAt))}</td>
                    <td>
                        <button class="btn btn-outline-danger btn-sm delete-incomplete" data-id="${esc(entry.id)}"><i class="fas fa-trash"></i> Delete</button>
                    </td>
                </tr>
            `;
        }).join('');

        $('#incompleteList').html(`
            <div class="table-responsive admin-table-wrap">
                <table class="table table-hover table-bordered mb-0 admin-record-table">
                    <thead>
                        <tr>
                            <th>SL</th>
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Address</th>
                            <th>Products</th>
                            <th>Missing</th>
                            <th>Last Updated</th>
                            <th>Started</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="text-muted mt-2" style="font-size:12px;">Source: checkout form closed or left before confirm.</div>
        `);
    }

    function setupEvents() {
        $(document).on('click', '.delete-incomplete', async function() {
            const id = String($(this).data('id') || '');
            const previousList = readList();
            const list = previousList.filter(item => String(item.id) !== id);
            writeList(list);
            const synced = await syncIncompleteUniversalStrict(previousList);
            if (!synced) {
                loadIncomplete();
                return;
            }
            loadIncomplete();
            showStatus('Incomplete attempt deleted.', 'info');
        });

        $(document).on('click', '#clearIncompleteBtn', async function() {
            if (!confirm('Clear all incomplete attempts?')) return;
            const previousList = readList();
            writeList([]);
            const synced = await syncIncompleteUniversalStrict(previousList);
            if (!synced) {
                loadIncomplete();
                return;
            }
            loadIncomplete();
            showStatus('All incomplete attempts cleared.', 'success');
        });

        $(document).on('click', '#logoutBtn', function() {
            if (confirm('Logout from admin panel?')) {
                AdminStore.clearSession();
                    window.location.href = 'login.html?logout=1';
            }
        });

        window.addEventListener('storage', function(e) {
            if (e.key === INCOMPLETE_KEY) {
                loadIncomplete();
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
            setTimeout(() => $status.fadeOut().addClass('d-none'), 2400);
        }
    }
});
