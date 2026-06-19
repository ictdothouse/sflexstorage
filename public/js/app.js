// Global App State
const App = {
    user: null,
    cartCount: 0,
    
    async init() {
        // Render common header first
        this.renderHeader();

        // Initialize theme FIRST (no flash)
        this.initTheme();

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

        // Load branding (non-blocking)
        this.loadBranding();
    },

    renderHeader() {
        const headerPlaceholder = document.getElementById('app-header');
        if (!headerPlaceholder) return;
        
        // Find current path for active state
        const path = window.location.pathname;
        const isGallery = path.startsWith('/gallery');
        
        // Use cached branding if available to prevent flash of old name
        let siteName = '';
        let siteLogoHTML = '<i data-lucide="aperture" class="logo-icon"></i>';
        try {
            const cached = localStorage.getItem('pv-branding');
            if (cached) {
                const b = JSON.parse(cached);
                if (b.site_name) siteName = b.site_name;
                if (b.site_logo) siteLogoHTML = `<img src="${b.site_logo}" alt="${b.site_name || 'Logo'}" class="logo-img" style="height:36px; width:auto; object-fit:contain;">`;
            }
        } catch (e) {}
        
        headerPlaceholder.innerHTML = `
    <header class="site-header">
        <div class="container">
            <a href="/" class="logo">
                ${siteLogoHTML}
                <span id="site-title-display">${siteName}</span>
            </a>
            
            <nav class="nav-links">
                <a href="/gallery" class="${isGallery ? 'active' : ''}">Discover</a>
                <a href="/subscription">Pricing</a>
                
                <!-- Theme Toggle -->
                <button id="theme-toggle" class="btn btn-icon btn-ghost" title="Toggle theme" style="cursor:pointer;">
                    <i data-lucide="moon" id="theme-icon-dark"></i>
                    <i data-lucide="sun" id="theme-icon-light" style="display:none;"></i>
                </button>

                <!-- Guest Only -->
                <div class="guest-links flex gap-4 items-center">
                    <a href="/login" class="btn btn-ghost">Log In</a>
                    <a href="/register" class="btn btn-primary">Sign Up</a>
                </div>
                
                <!-- Auth Only -->
                <div class="auth-links flex gap-6 items-center hidden">
                    <a href="/cart" class="cart-icon" style="position: relative;">
                        <i data-lucide="shopping-cart"></i>
                        <span class="cart-count hidden" style="position: absolute; top: -8px; right: -12px; background: var(--accent-danger); color: white; font-size: 10px; padding: 2px 6px; border-radius: 10px; font-weight: bold;">0</span>
                    </a>
                    
                    <a href="/admin/" class="admin-links hidden badge badge-gold">Admin</a>
                    
                    <a href="/account" class="flex items-center gap-2">
                        <i data-lucide="user-circle"></i>
                        <span class="user-name-display">Account</span>
                    </a>
                </div>
            </nav>
        </div>
    </header>
        `;
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
    },

    // ─── THEME TOGGLE ───
    initTheme() {
        const saved = localStorage.getItem('pv-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', saved);
        this.updateThemeIcons(saved);

        // Bind toggle button
        setTimeout(() => {
            const btn = document.getElementById('theme-toggle');
            if (btn) {
                btn.addEventListener('click', () => this.toggleTheme());
            }
        }, 100);
    },

    toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme') || 'dark';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('pv-theme', next);
        this.updateThemeIcons(next);
    },

    updateThemeIcons(theme) {
        const darkIcon = document.getElementById('theme-icon-dark');
        const lightIcon = document.getElementById('theme-icon-light');
        if (darkIcon && lightIcon) {
            darkIcon.style.display = theme === 'dark' ? 'block' : 'none';
            lightIcon.style.display = theme === 'light' ? 'block' : 'none';
        }
    },

    // ─── BRANDING ───
    async loadBranding() {
        try {
            const res = await fetch('/api/branding');
            const data = await res.json();
            if (!data.success) return;
            const b = data.branding;
            
            // Cache for next initial load to prevent FOUC
            localStorage.setItem('pv-branding', JSON.stringify(b));

            // Site name
            if (b.site_name) {
                document.title = document.title.replace('PhotoVault', b.site_name);
                const siteTitles = document.querySelectorAll('#site-title-display, #site-title-footer');
                siteTitles.forEach(el => el.textContent = b.site_name);
            }

            // Logo
            if (b.site_logo) {
                const logoContainers = document.querySelectorAll('.logo');
                logoContainers.forEach(el => {
                    const icon = el.querySelector('.logo-icon');
                    if (icon) icon.style.display = 'none';
                    // Inject img if not already there
                    if (!el.querySelector('.logo-img')) {
                        const img = document.createElement('img');
                        img.src = b.site_logo;
                        img.alt = b.site_name || 'Logo';
                        img.className = 'logo-img';
                        img.style.cssText = 'height:36px; width:auto; object-fit:contain;';
                        el.prepend(img);
                    }
                });
            }

            // Primary color
            if (b.brand_color) {
                document.documentElement.style.setProperty('--accent-primary', b.brand_color);
                // Update gradient
                document.documentElement.style.setProperty('--gradient-brand', `linear-gradient(135deg, ${b.brand_color}, var(--accent-secondary))`);
                document.documentElement.style.setProperty('--shadow-glow', `0 0 20px ${b.brand_color}40`);
            }
            
            // Button color
            if (b.button_color) {
                document.documentElement.style.setProperty('--btn-color', b.button_color);
            }
            if (b.button_hover_color) {
                document.documentElement.style.setProperty('--btn-hover-color', b.button_hover_color);
            }

            // Footer text
            if (b.footer_text) {
                const footerEl = document.getElementById('footer-text');
                if (footerEl) footerEl.textContent = b.footer_text;
            }
        } catch (e) {
            // Branding is non-critical
        }
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
