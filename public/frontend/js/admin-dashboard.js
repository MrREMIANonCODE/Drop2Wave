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
            delivered: { amount: 0, count: 0 },
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
            if (status === 'delivered') {
                buckets.delivered.count += 1;
                buckets.delivered.amount += total;
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

        writeAmount('ovFbSentAmount', buckets.delivered.amount);
        writeCount('ovFbSentCount', buckets.delivered.count);

        writeAmount('ovHoldAmount', buckets.hold.amount);
        writeCount('ovHoldCount', buckets.hold.count);

        const stat24 = document.getElementById('ovLast24hCount');
        if (stat24) stat24.textContent = `${last24hCount} orders`;

        const stat12m = document.getElementById('ovLast12mCount');
        if (stat12m) stat12m.textContent = `${last12mCount} orders`;
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
});

