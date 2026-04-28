/**
 * Admin Dashboard - Stats and navigation
 */

$(document).ready(async function() {
    // Check authentication
    if (!AdminStore.isAuthenticated()) {
        window.location.href = 'login.html';
        return;
    }
    
    let activeOrderDateRange = null;

    loadDashboardStats();
    setupLogout();
    setupDateRangePicker();

    // Do cloud sync in background so the dashboard paints immediately.
    Promise.resolve()
        .then(function() {
            return AdminStore.syncFromCloud();
        })
        .then(function() {
            loadDashboardStats(activeOrderDateRange);
        })
        .catch(function() {
            // Keep UI usable even if background sync fails.
        });

    function startOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function endOfDay(date) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
    }

    function getOrderDate(order) {
        if (!order || typeof order !== 'object') return null;

        const ts = Number(order.orderTimestamp || 0);
        if (Number.isFinite(ts) && ts > 0) {
            return new Date(ts);
        }

        if (order.orderDate) {
            const dt = new Date(order.orderDate);
            if (!Number.isNaN(dt.getTime())) return dt;
        }

        return null;
    }

    function normalizeOrderStatus(status) {
        const value = String(status || '').toLowerCase();
        const map = {
            confirmed: 'new',
            processing: 'complete',
            shipped: 'in_courier'
        };
        return map[value] || value;
    }

    function getOrderTotal(order) {
        const fromPricing = Number(order && order.pricing && order.pricing.total ? order.pricing.total : 0);
        if (Number.isFinite(fromPricing) && fromPricing > 0) return fromPricing;

        const fallback = Number(order && order.total ? order.total : 0);
        if (Number.isFinite(fallback) && fallback > 0) return fallback;

        return 0;
    }

    function formatTk(amount) {
        const value = Number.isFinite(amount) ? amount : 0;
        return `৳${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function getCustomerDisplayName(order) {
        if (!order || typeof order !== 'object') return 'Unknown';

        const candidates = [
            order.customerName,
            order.customer && order.customer.name,
            order.shipping && order.shipping.name,
            order.billing && order.billing.name,
            order.name,
            order.fullName
        ];

        const match = candidates.find(function(value) {
            return typeof value === 'string' && value.trim();
        });

        return match ? match.trim() : 'Unknown';
    }

    function isOrderInRange(order, range) {
        if (!range || !range.startDate || !range.endDate) return true;
        const orderDate = getOrderDate(order);
        if (!orderDate) return false;

        const start = startOfDay(range.startDate).getTime();
        const end = endOfDay(range.endDate).getTime();
        const time = orderDate.getTime();
        return time >= start && time <= end;
    }

    function loadDashboardStats(range) {
        // Load orders if OrderManager is available.
        let orders = [];
        if (typeof OrderManager !== 'undefined') {
            const allOrders = OrderManager.getAllOrders();
            orders = allOrders.filter(o => isOrderInRange(o, range || activeOrderDateRange));
        }

        const buckets = {
            all: { amount: 0, count: 0 },
            new: { amount: 0, count: 0 },
            complete: { amount: 0, count: 0 },
            in_courier: { amount: 0, count: 0 },
            no_response: { amount: 0, count: 0 },
            hold: { amount: 0, count: 0 }
        };

        const dayMs = 24 * 60 * 60 * 1000;
        const now = Date.now();
        let last24hCount = 0;
        let last12mCount = 0;

        orders.forEach(function(order) {
            const status = normalizeOrderStatus(order.status);
            const total = getOrderTotal(order);
            const dt = getOrderDate(order);

            buckets.all.count += 1;
            buckets.all.amount += total;

            if (status === 'new') {
                buckets.new.count += 1;
                buckets.new.amount += total;
            }
            if (status === 'complete') {
                buckets.complete.count += 1;
                buckets.complete.amount += total;
            }
            if (status === 'in_courier') {
                buckets.in_courier.count += 1;
                buckets.in_courier.amount += total;
            }
            if (status === 'no_response') {
                buckets.no_response.count += 1;
                buckets.no_response.amount += total;
            }
            if (status === 'hold') {
                buckets.hold.count += 1;
                buckets.hold.amount += total;
            }

            if (dt instanceof Date && !Number.isNaN(dt.getTime())) {
                const age = now - dt.getTime();
                if (age <= dayMs) {
                    last24hCount += 1;
                }
                if (age <= (365 * dayMs)) {
                    last12mCount += 1;
                }
            }
        });

        function writeAmount(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = formatTk(value);
        }

        function writeCount(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = `${value} orders`;
        }

        writeAmount('ovAllAmount', buckets.all.amount);
        writeCount('ovAllCount', buckets.all.count);

        writeAmount('ovNewAmount', buckets.new.amount);
        writeCount('ovNewCount', buckets.new.count);

        writeAmount('ovCompleteAmount', buckets.complete.amount);
        writeCount('ovCompleteCount', buckets.complete.count);

        writeAmount('ovCourierAmount', buckets.in_courier.amount);
        writeCount('ovCourierCount', buckets.in_courier.count);

        writeAmount('ovNoResponseAmount', buckets.no_response.amount);
        writeCount('ovNoResponseCount', buckets.no_response.count);

        writeAmount('ovHoldAmount', buckets.hold.amount);
        writeCount('ovHoldCount', buckets.hold.count);

        const stat24 = document.getElementById('ovLast24hCount');
        if (stat24) stat24.textContent = `${last24hCount} orders`;

        const stat12m = document.getElementById('ovLast12mCount');
        if (stat12m) stat12m.textContent = `${last12mCount} orders`;

        renderAnalyticsCharts(orders, now);
    }

    function formatHourLabel(date) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true }).replace(' ', ' ');
    }

    function formatMonthLabel(date) {
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    function monthKey(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }

    function renderAnalyticsCharts(orders, nowMs) {
        renderLast24HoursChart(orders, nowMs);
        renderLast12MonthsDonut(orders, nowMs);
        setupAnalyticsScrollButtons();
    }

    function renderLast24HoursChart(orders, nowMs) {
        const barsRoot = document.getElementById('d2w24hBars');
        const scrollRoot = document.getElementById('d2w24hScroll');
        if (!barsRoot || !scrollRoot) return;

        const hourMs = 60 * 60 * 1000;
        const nowDate = new Date(nowMs);
        const alignedNow = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate(), nowDate.getHours());
        const bucketMap = new Map();

        for (let i = 23; i >= 0; i -= 1) {
            const slotDate = new Date(alignedNow.getTime() - (i * hourMs));
            bucketMap.set(monthKey(slotDate) + '-' + slotDate.getDate() + '-' + slotDate.getHours(), {
                date: slotDate,
                count: 0
            });
        }

        orders.forEach(function (order) {
            const dt = getOrderDate(order);
            if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return;

            const age = nowMs - dt.getTime();
            if (age < 0 || age > (24 * hourMs)) return;

            const key = monthKey(dt) + '-' + dt.getDate() + '-' + dt.getHours();
            if (bucketMap.has(key)) {
                bucketMap.get(key).count += 1;
            }
        });

        const buckets = Array.from(bucketMap.values());
        const maxCount = Math.max(1, ...buckets.map(function (b) { return b.count; }));

        barsRoot.innerHTML = buckets.map(function (item) {
            const ratio = item.count / maxCount;
            const height = Math.max(6, Math.round(ratio * 100));
            return `
                <div class="d2w-hour-col">
                    <div class="d2w-hour-val">${item.count}</div>
                    <div class="d2w-hour-track">
                        <div class="d2w-hour-bar" style="height:${height}%;"></div>
                    </div>
                    <div class="d2w-hour-label">${formatHourLabel(item.date)}</div>
                </div>
            `;
        }).join('');

        if (!scrollRoot.dataset.initialized) {
            scrollRoot.scrollLeft = scrollRoot.scrollWidth;
            scrollRoot.dataset.initialized = '1';
        }
    }

    function renderLast12MonthsDonut(orders, nowMs) {
        const donut = document.getElementById('d2w12mDonut');
        const totalEl = document.getElementById('d2w12mTotal');
        const legendRoot = document.getElementById('d2w12mLegend');
        if (!donut || !totalEl || !legendRoot) return;

        const palette = ['#06b6d4', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#10b981', '#14b8a6', '#0ea5e9'];
        const months = [];
        const now = new Date(nowMs);

        for (let i = 11; i >= 0; i -= 1) {
            const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
            months.push({
                key: monthKey(dt),
                label: formatMonthLabel(dt),
                count: 0
            });
        }

        const monthMap = new Map(months.map(function (m) { return [m.key, m]; }));

        orders.forEach(function (order) {
            const dt = getOrderDate(order);
            if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return;
            const key = monthKey(dt);
            if (monthMap.has(key)) {
                monthMap.get(key).count += 1;
            }
        });

        const total = months.reduce(function (sum, m) { return sum + m.count; }, 0);
        totalEl.textContent = String(total);

        if (total <= 0) {
            donut.style.background = 'conic-gradient(#e2e8f0 0 100%)';
        } else {
            let cursor = 0;
            const segments = [];
            months.forEach(function (m, idx) {
                if (!m.count) return;
                const portion = (m.count / total) * 100;
                const next = cursor + portion;
                const color = palette[idx % palette.length];
                segments.push(`${color} ${cursor.toFixed(2)}% ${next.toFixed(2)}%`);
                cursor = next;
            });
            donut.style.background = `conic-gradient(${segments.join(', ')})`;
        }

        legendRoot.innerHTML = months.map(function (m, idx) {
            const color = palette[idx % palette.length];
            const pct = total > 0 ? Math.round((m.count / total) * 100) : 0;
            return `
                <div class="d2w-month-card">
                    <div class="d2w-month-head">
                        <span class="d2w-month-dot" style="background:${color};"></span>
                        <span>${m.label}</span>
                    </div>
                    <div class="d2w-month-meta">${m.count} (${pct}%)</div>
                </div>
            `;
        }).join('');
    }

    function setupAnalyticsScrollButtons() {
        bindHorizontalScroller('d2w24hLeftBtn', 'd2w24hRightBtn', 'd2w24hScroll', 260);
        bindHorizontalScroller('d2w12mLeftBtn', 'd2w12mRightBtn', 'd2w12mLegendScroll', 320);
    }

    function bindHorizontalScroller(leftId, rightId, scrollId, step) {
        const leftBtn = document.getElementById(leftId);
        const rightBtn = document.getElementById(rightId);
        const scrollEl = document.getElementById(scrollId);
        if (!leftBtn || !rightBtn || !scrollEl) return;

        function updateState() {
            const maxLeft = Math.max(0, scrollEl.scrollWidth - scrollEl.clientWidth);
            leftBtn.disabled = scrollEl.scrollLeft <= 1;
            rightBtn.disabled = scrollEl.scrollLeft >= (maxLeft - 1);
        }

        if (!leftBtn.dataset.bound) {
            leftBtn.addEventListener('click', function () {
                scrollEl.scrollBy({ left: -step, behavior: 'smooth' });
            });
            leftBtn.dataset.bound = '1';
        }

        if (!rightBtn.dataset.bound) {
            rightBtn.addEventListener('click', function () {
                scrollEl.scrollBy({ left: step, behavior: 'smooth' });
            });
            rightBtn.dataset.bound = '1';
        }

        if (!scrollEl.dataset.boundScroll) {
            scrollEl.addEventListener('scroll', updateState, { passive: true });
            scrollEl.dataset.boundScroll = '1';
        }

        updateState();
    }

    // Refresh counters if data changes in another tab.
    window.addEventListener('storage', function (event) {
        if (event.key === AdminStore.STORE_KEY) {
            loadDashboardStats(activeOrderDateRange);
        }
    });
    
    function setupLogout() {
        $(document).on('click', '#logoutBtn', function() {
            if (confirm('Are you sure you want to logout?')) {
                AdminStore.clearSession();
                window.location.href = 'login.html?logout=1';
            }
        });
    }

    function setupDateRangePicker() {
        const root = document.getElementById('d2wDateRangeRoot');
        const trigger = document.getElementById('d2wDateRangeTrigger');
        const valueEl = document.getElementById('d2wDateRangeValue');
        const popup = document.getElementById('d2wDateRangePopup');
        const selectionEl = document.getElementById('d2wDateRangeSelection');
        const grid = document.getElementById('d2wCalendarGrid');
        const prevBtn = document.getElementById('d2wPrevMonth');
        const nextBtn = document.getElementById('d2wNextMonth');
        const presetButtons = Array.from(document.querySelectorAll('.d2w-date-preset'));
        if (!root || !trigger || !valueEl || !popup || !selectionEl || !grid || !prevBtn || !nextBtn || !presetButtons.length) {
            return;
        }

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const weekdayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
        const state = {
            viewMonth: startOfMonth(new Date()),
            startDate: null,
            endDate: null,
            hoverDate: null,
            selecting: 'start'
        };

        function pad(n) {
            return String(n).padStart(2, '0');
        }

        function parseYmd(dateStr) {
            const parts = String(dateStr || '').split('-').map(Number);
            if (parts.length !== 3) return null;
            return new Date(parts[0], parts[1] - 1, parts[2]);
        }

        function toYmd(date) {
            if (!(date instanceof Date)) return '';
            return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        }

        function startOfMonth(date) {
            return new Date(date.getFullYear(), date.getMonth(), 1);
        }

        function addMonths(date, amount) {
            return new Date(date.getFullYear(), date.getMonth() + amount, 1);
        }

        function isSameDate(a, b) {
            return a instanceof Date && b instanceof Date && toYmd(a) === toYmd(b);
        }

        function isBetween(date, start, end) {
            const t = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
            const s = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
            const e = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
            return t > s && t < e;
        }

        function setPresetActive(days) {
            presetButtons.forEach(function(btn) {
                const btnDays = Number(btn.getAttribute('data-days') || 0);
                btn.classList.toggle('active', btnDays === Number(days));
            });
        }

        function clearPresetActive() {
            presetButtons.forEach(function(btn) {
                btn.classList.remove('active');
            });
        }

        function renderValue() {
            if (!state.startDate || !state.endDate) {
                valueEl.textContent = 'Select Date Range';
                trigger.classList.remove('has-value');
                return;
            }
            valueEl.textContent = `${toYmd(state.startDate)} \u2192 ${toYmd(state.endDate)}`;
            trigger.classList.add('has-value');
        }

        function renderSelectionLabel() {
            if (state.startDate && !state.endDate) {
                selectionEl.textContent = `Start: ${toYmd(state.startDate)}  |  Select an end date`;
                return;
            }
            if (state.startDate && state.endDate) {
                if (state.selecting === 'end') {
                    selectionEl.textContent = `${toYmd(state.startDate)} \u2192 ${toYmd(state.endDate)}  |  Select end date`;
                } else {
                    selectionEl.textContent = `${toYmd(state.startDate)} \u2192 ${toYmd(state.endDate)}  |  Select start date`;
                }
                return;
            }
            selectionEl.textContent = 'Pick start and end date';
        }

        function renderMonthCalendar(monthDate) {
            const year = monthDate.getFullYear();
            const month = monthDate.getMonth();
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            let daysHtml = '';
            for (let i = 0; i < firstDay; i += 1) {
                daysHtml += '<span class="d2w-day muted"></span>';
            }

            for (let day = 1; day <= daysInMonth; day += 1) {
                const date = new Date(year, month, day);
                const ymd = toYmd(date);
                const classes = ['d2w-day'];

                if (state.startDate && isSameDate(date, state.startDate)) classes.push('range-start');
                if (state.endDate && isSameDate(date, state.endDate)) classes.push('range-end');
                if (state.startDate && state.endDate && isBetween(date, state.startDate, state.endDate)) classes.push('in-range');
                daysHtml += `<button type="button" class="${classes.join(' ')}" data-date="${ymd}">${day}</button>`;
            }

            return `
                <div class="d2w-calendar">
                    <div class="d2w-calendar-title">${monthNames[month]} ${year}</div>
                    <div class="d2w-calendar-weekdays">${weekdayNames.map(function(d) { return `<span>${d}</span>`; }).join('')}</div>
                    <div class="d2w-calendar-days">${daysHtml}</div>
                </div>
            `;
        }

        function renderCalendars() {
            const firstMonth = state.viewMonth;
            const secondMonth = addMonths(firstMonth, 1);
            grid.innerHTML = renderMonthCalendar(firstMonth) + renderMonthCalendar(secondMonth);
        }

        function maybeActivateMatchedPreset() {
            if (!state.startDate || !state.endDate) {
                clearPresetActive();
                return;
            }
            const diffMs = new Date(state.endDate.getFullYear(), state.endDate.getMonth(), state.endDate.getDate()).getTime() -
                new Date(state.startDate.getFullYear(), state.startDate.getMonth(), state.startDate.getDate()).getTime();
            const days = Math.floor(diffMs / 86400000) + 1;
            const isTodayEnd = isSameDate(state.endDate, new Date());
            if (isTodayEnd && [7, 30, 90].includes(days)) {
                setPresetActive(days);
            } else {
                clearPresetActive();
            }
        }

        function applyRange(startDate, endDate, presetDays) {
            state.startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
            state.endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
            if (state.startDate.getTime() > state.endDate.getTime()) {
                const tmp = state.startDate;
                state.startDate = state.endDate;
                state.endDate = tmp;
            }
            state.selecting = 'start';
            state.viewMonth = startOfMonth(state.startDate);
            renderCalendars();
            renderValue();
            renderSelectionLabel();
            if (presetDays) {
                setPresetActive(presetDays);
            } else {
                maybeActivateMatchedPreset();
            }

            activeOrderDateRange = {
                startDate: new Date(state.startDate.getFullYear(), state.startDate.getMonth(), state.startDate.getDate()),
                endDate: new Date(state.endDate.getFullYear(), state.endDate.getMonth(), state.endDate.getDate())
            };
            loadDashboardStats(activeOrderDateRange);
        }

        function openPopup() {
            popup.classList.add('is-open');
            popup.setAttribute('aria-hidden', 'false');
            trigger.setAttribute('aria-expanded', 'true');
        }

        function closePopup() {
            popup.classList.remove('is-open');
            popup.setAttribute('aria-hidden', 'true');
            trigger.setAttribute('aria-expanded', 'false');
            state.hoverDate = null;
        }

        popup.addEventListener('click', function(event) {
            event.stopPropagation();
        });

        trigger.addEventListener('click', function(event) {
            event.stopPropagation();
            const isOpen = popup.classList.contains('is-open');
            if (isOpen) {
                closePopup();
            } else {
                openPopup();
                renderCalendars();
                renderSelectionLabel();
            }
        });

        prevBtn.addEventListener('click', function(event) {
            event.stopPropagation();
            state.viewMonth = addMonths(state.viewMonth, -1);
            renderCalendars();
        });

        nextBtn.addEventListener('click', function(event) {
            event.stopPropagation();
            state.viewMonth = addMonths(state.viewMonth, 1);
            renderCalendars();
        });

        presetButtons.forEach(function(btn) {
            btn.addEventListener('click', function(event) {
                event.stopPropagation();
                const days = Number(btn.getAttribute('data-days') || 0);
                if (!days) return;
                const end = new Date();
                const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
                applyRange(start, end, days);
            });
        });

        grid.addEventListener('click', function(event) {
            event.stopPropagation();
            const rawTarget = event.target;
            const baseEl = rawTarget instanceof Element
                ? rawTarget
                : (rawTarget && rawTarget.parentElement ? rawTarget.parentElement : null);
            const target = baseEl instanceof Element ? baseEl.closest('.d2w-day[data-date]') : null;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            const picked = parseYmd(target.getAttribute('data-date'));
            if (!picked) return;

            if (!state.startDate || state.selecting === 'start') {
                state.startDate = picked;
                state.endDate = null;
                state.selecting = 'end';
                clearPresetActive();
            } else {
                if (picked.getTime() === state.startDate.getTime()) {
                    selectionEl.textContent = `Start: ${toYmd(state.startDate)}  |  End date must be different`;
                    renderCalendars();
                    renderValue();
                    return;
                }

                if (picked.getTime() > state.startDate.getTime()) {
                    state.endDate = picked;
                } else {
                    state.endDate = state.startDate;
                    state.startDate = picked;
                }
                state.selecting = 'start';
                maybeActivateMatchedPreset();
            }
            renderCalendars();
            renderValue();
            renderSelectionLabel();
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape' && popup.classList.contains('is-open')) {
                closePopup();
            }
        });

        document.addEventListener('click', function(event) {
            if (!root.contains(event.target)) {
                closePopup();
            }
        });

        const today = new Date();
        const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29);
        applyRange(defaultStart, today, 30);
        renderSelectionLabel();
    }

    // Load and render latest orders
    function renderLatestOrders() {
        const tbody = document.getElementById('latestOrdersTableBody');
        if (!tbody) return;

        let orders = [];
        try {
            const stored = localStorage.getItem('drop2wave_orders_v1');
            if (stored) {
                const data = JSON.parse(stored);
                if (Array.isArray(data.orders)) {
                    orders = data.orders.slice().reverse(); // Most recent first
                }
            }
        } catch (e) {
            console.error('Error loading orders:', e);
        }

        // Show only latest 8 orders on dashboard
        const latestOrders = orders.slice(0, 8);
        
        if (latestOrders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px; color: #999;">No orders yet</td></tr>';
            return;
        }

        tbody.innerHTML = latestOrders.map(order => {
            const invoiceId = order.id || '#' + (order.orderId || 'N/A');
            const customerName = getCustomerDisplayName(order);
            const total = order.pricing && order.pricing.total ? order.pricing.total : (order.total || 0);
            const status = order.orderStatus || order.status || 'pending';
            const timestamp = order.orderTimestamp || order.orderDate || new Date().getTime();
            
            // Format date
            let dateStr = '';
            try {
                const date = new Date(Number(timestamp) || timestamp);
                dateStr = date.toLocaleString('en-GB', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false
                });
            } catch (e) {
                dateStr = 'N/A';
            }

            // Capitalize status
            const statusDisplay = status.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

            return `<tr>
                <td><a href="order/all.html?id=${encodeURIComponent(order.id)}" style="color: #0ea5e9; text-decoration: none;">${invoiceId}</a></td>
                <td>${customerName}</td>
                <td>৳${Number(total).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td>${statusDisplay}</td>
                <td>${dateStr}</td>
            </tr>`;
        }).join('');
    }

    // Initial load and setup listener
    renderLatestOrders();
    window.addEventListener('storage', function(event) {
        if (event.key === 'drop2wave_orders_v1') {
            renderLatestOrders();
        }
    });
});

