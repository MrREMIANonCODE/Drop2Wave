/*
 * Reusable admin date-range filter.
 * Expects markup IDs:
 * d2wDateRangeRoot, d2wDateRangeTrigger, d2wDateRangeValue,
 * d2wDateRangePopup, d2wDateRangeSelection, d2wPrevMonth,
 * d2wNextMonth, d2wCalendarGrid, and .d2w-date-preset buttons.
 */
(function() {
    function pad(num) {
        return String(num).padStart(2, '0');
    }

    function toYmd(date) {
        if (!(date instanceof Date)) return '';
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function parseYmd(value) {
        const parts = String(value || '').split('-').map(Number);
        if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
        return new Date(parts[0], parts[1] - 1, parts[2]);
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

    window.createD2WDateRangeFilter = function(options) {
        const config = options || {};
        const root = document.getElementById(config.rootId || 'd2wDateRangeRoot');
        const trigger = document.getElementById(config.triggerId || 'd2wDateRangeTrigger');
        const valueEl = document.getElementById(config.valueId || 'd2wDateRangeValue');
        const popup = document.getElementById(config.popupId || 'd2wDateRangePopup');
        const selectionEl = document.getElementById(config.selectionId || 'd2wDateRangeSelection');
        const grid = document.getElementById(config.gridId || 'd2wCalendarGrid');
        const prevBtn = document.getElementById(config.prevId || 'd2wPrevMonth');
        const nextBtn = document.getElementById(config.nextId || 'd2wNextMonth');
        const presetSelector = config.presetSelector || '.d2w-date-preset';
        const presetButtons = Array.from(root ? root.querySelectorAll(presetSelector) : []);

        if (!root || !trigger || !valueEl || !popup || !selectionEl || !grid || !prevBtn || !nextBtn || !presetButtons.length) {
            return null;
        }

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const weekdayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

        const state = {
            viewMonth: startOfMonth(new Date()),
            startDate: null,
            endDate: null,
            selecting: 'start'
        };

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
            valueEl.textContent = `${toYmd(state.startDate)} -> ${toYmd(state.endDate)}`;
            trigger.classList.add('has-value');
        }

        function renderSelectionLabel() {
            if (state.startDate && !state.endDate) {
                selectionEl.textContent = `Start: ${toYmd(state.startDate)}  |  Select an end date`;
                return;
            }
            if (state.startDate && state.endDate) {
                if (state.selecting === 'end') {
                    selectionEl.textContent = `${toYmd(state.startDate)} -> ${toYmd(state.endDate)}  |  Select end date`;
                } else {
                    selectionEl.textContent = `${toYmd(state.startDate)} -> ${toYmd(state.endDate)}  |  Select start date`;
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

        function emitChange() {
            if (typeof config.onRangeChange === 'function') {
                config.onRangeChange(
                    state.startDate ? new Date(state.startDate) : null,
                    state.endDate ? new Date(state.endDate) : null
                );
            }
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

            emitChange();
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
                emitChange();
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

        if (typeof config.defaultPresetDays === 'number' && config.defaultPresetDays > 0) {
            const today = new Date();
            const defaultStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (config.defaultPresetDays - 1));
            applyRange(defaultStart, today, config.defaultPresetDays);
        } else {
            renderCalendars();
            renderSelectionLabel();
            renderValue();
        }

        return {
            getRange: function() {
                return {
                    startDate: state.startDate ? new Date(state.startDate) : null,
                    endDate: state.endDate ? new Date(state.endDate) : null
                };
            },
            setRange: function(startDate, endDate) {
                if (!(startDate instanceof Date) || !(endDate instanceof Date)) return;
                applyRange(startDate, endDate);
            },
            clearRange: function() {
                state.startDate = null;
                state.endDate = null;
                state.selecting = 'start';
                clearPresetActive();
                renderCalendars();
                renderSelectionLabel();
                renderValue();
                emitChange();
            }
        };
    };
})();
