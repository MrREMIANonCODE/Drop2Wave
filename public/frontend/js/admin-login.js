/**
 * Admin Login Management - Local file-mode authentication
 */

$(document).ready(function() {
    let forcedLogout = false;
    try {
        const params = new URLSearchParams(window.location.search || '');
        forcedLogout = params.get('logout') === '1';
    } catch (err) {
        forcedLogout = false;
    }

    if (forcedLogout) {
        AdminStore.clearSession();
        try {
            window.history.replaceState(null, '', window.location.pathname);
        } catch (err) {
            // Ignore URL cleanup failures.
        }
    }

    let recentlyLoggedOut = false;
    try {
        const ts = Number(sessionStorage.getItem('drop2wave_admin_recent_logout') || 0);
        recentlyLoggedOut = Number.isFinite(ts) && ts > 0 && (Date.now() - ts) < 15000;
    } catch (err) {
        recentlyLoggedOut = false;
    }

    // Check if already logged in
    if (!forcedLogout && !recentlyLoggedOut && AdminStore.isAuthenticated()) {
        window.location.href = 'index.html';
        return;
    }

    try {
        sessionStorage.removeItem('drop2wave_admin_recent_logout');
    } catch (err) {
        // Ignore storage cleanup failures.
    }
    
    const $form = $('#adminLoginForm');
    const $email = $('#adminEmail');
    const $password = $('#adminPassword');
    const $status = $('#statusMessage');
    
    // Hardcoded admin credentials (file-mode)
    const ADMIN_EMAIL = 'admin@drop2wave.com';
    const ADMIN_EMAIL_ALIASES = ['admin@gmail.com'];
    const ADMIN_PASSWORD = 'admin123';
    
    // Login form handler
    if ($form.length) {
        $form.on('submit', function(e) {
            e.preventDefault();
            
            const email = $email.val().trim().toLowerCase();
            const password = $password.val().trim();
            
            if (!email || !password) {
                showStatus('Please fill in all fields', 'danger');
                return;
            }
            
            // Validate credentials
            const allowedEmails = [ADMIN_EMAIL, ...ADMIN_EMAIL_ALIASES].map(e => e.toLowerCase());

            if (allowedEmails.includes(email) && password === ADMIN_PASSWORD) {
                AdminStore.createSession(email);
                showStatus('Login successful! Redirecting...', 'success');
                setTimeout(() => {
                    window.location.href = 'index.html';
                }, 1000);
            } else {
                showStatus('Invalid email or password', 'danger');
            }
        });
    }
    
    // Logout functionality
    $(document).on('click', '#logoutBtn', function() {
        AdminStore.clearSession();
        window.location.href = 'login.html?logout=1';
    });
    
    function showStatus(message, type) {
        if (!$status.length) return;
        
        $status
            .removeClass('d-none')
            .removeClass('alert-success alert-danger alert-warning')
            .addClass('alert-' + type)
            .text(message)
            .fadeIn();
        
        if (type === 'success') {
            setTimeout(() => $status.fadeOut().addClass('d-none'), 3000);
        }
    }
});
