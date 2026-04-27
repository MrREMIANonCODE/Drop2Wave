/**
 * Lightweight OrderManager for admin dashboard.
 * Avoids loading checkout.js on dashboard pages.
 */
(function() {
    function readOrdersRaw() {
        try {
            const raw = localStorage.getItem('drop2wave_orders_v1');
            const parsed = raw ? JSON.parse(raw) : { orders: [] };
            return parsed && Array.isArray(parsed.orders) ? parsed : { orders: [] };
        } catch (e) {
            return { orders: [] };
        }
    }

    class DashboardOrderManager {
        static getAllOrders() {
            return readOrdersRaw().orders || [];
        }

        static getOrderById(orderId) {
            const list = this.getAllOrders();
            return list.find(function(order) {
                return String(order && order.orderId) === String(orderId);
            }) || null;
        }
    }

    if (!window.OrderManager || typeof window.OrderManager.getAllOrders !== 'function') {
        window.OrderManager = DashboardOrderManager;
    }
})();
