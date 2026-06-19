// Global App State
const App = {
    user: null,
    cartCount: 0,
    
    async init() {
        // Initialize Lucide icons
        if (window.lucide) {
            lucide.createIcons();
        }

        // Initialize Lightbox
        if (window.utils && !window.utils.lightbox) {
            window.utils.lightbox = new window.utils.Lightbox();
        }

        await this.checkAuth();
        this.updateNavUI();
        
        if (this.user) {
            await this.updateCartCount();
        }

        this.bindGlobalEvents();
    },

    async checkAuth() {
        try {
            console.log('[App] Checking auth...');
            const res = await window.utils.api.get('/auth/me');
            console.log('[App] Auth response:', res);
            if (res.authenticated) {
                this.user = res.user;
                console.log('[App] User authenticated:', this.user.username);
            } else {
                console.log('[App] Not authenticated');
            }
        } catch (e) {
            console.error('[App] Auth check failed:', e);
        }
    },

    async updateCartCount() {
        try {
            const res = await window.utils.api.get('/cart/count');
            this.cartCount = res.count;
            
            const badges = document.querySelectorAll('.cart-count');
            badges.forEach(badge => {
                badge.textContent = this.cartCount;
                if (this.cartCount > 0) {
                    badge.classList.remove('hidden');
                } else {
                    badge.classList.add('hidden');
                }
            });
        } catch (e) {
            // ignore
        }
    },

    updateNavUI() {
        const authLinks = document.querySelectorAll('.auth-links');
        const guestLinks = document.querySelectorAll('.guest-links');
        const adminLinks = document.querySelectorAll('.admin-links');
        const userNameDisplays = document.querySelectorAll('.user-name-display');

        if (this.user) {
            guestLinks.forEach(el => el.classList.add('hidden'));
            authLinks.forEach(el => el.classList.remove('hidden'));
            
            if (this.user.role === 'admin') {
                adminLinks.forEach(el => el.classList.remove('hidden'));
            } else {
                adminLinks.forEach(el => el.classList.add('hidden'));
            }

            userNameDisplays.forEach(el => {
                el.textContent = this.user.full_name || this.user.username;
            });
        } else {
            authLinks.forEach(el => el.classList.add('hidden'));
            adminLinks.forEach(el => el.classList.add('hidden'));
            guestLinks.forEach(el => el.classList.remove('hidden'));
        }
    },

    bindGlobalEvents() {
        // Global Logout handler
        const logoutBtns = document.querySelectorAll('.btn-logout');
        logoutBtns.forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await window.utils.api.post('/auth/logout');
                    window.location.href = '/index';
                } catch (e) {
                    window.utils.showToast('Failed to logout', 'error');
                }
            });
        });

        // Global Add to Cart handler
        document.body.addEventListener('click', async (e) => {
            const btn = e.target.closest('.add-to-cart-btn');
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            if (!this.user) {
                window.location.href = '/login';
                return;
            }

            const imageId = btn.dataset.imageId;
            try {
                const res = await window.utils.api.post('/cart/add', { image_id: imageId });
                if (res.success) {
                    this.cartCount = res.cartCount;
                    this.updateCartCount();
                    window.utils.showToast('Added to cart');
                    btn.classList.add('active');
                }
            } catch (err) {
                window.utils.showToast(err.message, 'error');
            }
        });

        // Global Favorite handler
        document.body.addEventListener('click', async (e) => {
            const btn = e.target.closest('.favorite-btn');
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            if (!this.user) {
                window.location.href = '/login';
                return;
            }

            const imageId = btn.dataset.imageId;
            try {
                const res = await window.utils.api.post(`/images/${imageId}/favorite`);
                if (res.success) {
                    const icon = btn.querySelector('i');
                    if (res.favorited) {
                        btn.classList.add('active');
                        icon.setAttribute('fill', 'currentColor');
                        window.utils.showToast('Added to favorites');
                    } else {
                        btn.classList.remove('active');
                        icon.setAttribute('fill', 'none');
                        window.utils.showToast('Removed from favorites');
                    }
                }
            } catch (err) {
                window.utils.showToast('Failed to update favorites', 'error');
            }
        });
    }
};
// Robust initialization
App._initPromise = new Promise((resolve) => {
    const startApp = async () => {
        try {
            await App.init();
        } catch (err) {
            console.error('[App] Failed to initialize:', err);
        } finally {
            resolve(); // Always resolve so others don't hang
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startApp);
    } else {
        startApp();
    }
});
