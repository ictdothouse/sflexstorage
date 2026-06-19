// --- API Wrappers ---
const api = {
    async request(endpoint, options = {}) {
        const url = `/api${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        try {
            const fetchOptions = {
                credentials: 'include',
                ...options,
                headers
            };
            const response = await fetch(url, fetchOptions);
            const data = await response.json();
            
            if (!response.ok) {
                if (response.status === 401 && !url.includes('/auth/me')) {
                    // Redirect to login if unauthorized
                    window.location.href = '/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
                }
                throw new Error(data.error || 'API Request Failed');
            }
            return data;
        } catch (error) {
            console.error(`API Error (${endpoint}):`, error);
            throw error;
        }
    },

    get(endpoint) { return this.request(endpoint, { method: 'GET' }); },
    post(endpoint, body) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) }); },
    put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }); },
    delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); }
};

// --- Toast Notifications ---
function showToast(message, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    // Add icon based on type
    const icon = type === 'success' ? 'check-circle' : 'alert-circle';
    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    
    // Initialize icons if lucide is available
    if (window.lucide) lucide.createIcons({ root: toast });

    // Show animation
    setTimeout(() => toast.classList.add('show'), 10);

    // Remove after 3s
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// --- Formatters ---
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-MY', {
        style: 'currency',
        currency: 'MYR'
    }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return '';
    return new Intl.DateTimeFormat('en-MY', {
        year: 'numeric', month: 'short', day: 'numeric'
    }).format(new Date(dateString));
}

// --- Lightbox ---
class Lightbox {
    constructor() {
        this.createDOM();
        this.bindEvents();
    }

    createDOM() {
        this.overlay = document.createElement('div');
        this.overlay.className = 'modal-overlay';
        this.overlay.innerHTML = `
            <div class="lightbox-content" style="position: relative; max-width: 90vw; max-height: 90vh;">
                <button class="lightbox-close" style="position: absolute; top: -40px; right: 0; background: none; border: none; color: white; cursor: pointer;">
                    <i data-lucide="x" style="width: 32px; height: 32px;"></i>
                </button>
                <img src="" style="max-width: 100%; max-height: 90vh; border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
            </div>
        `;
        document.body.appendChild(this.overlay);
    }

    bindEvents() {
        const closeBtn = this.overlay.querySelector('.lightbox-close');
        closeBtn.addEventListener('click', () => this.close());
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) this.close();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
        });
    }

    open(imageUrl) {
        const img = this.overlay.querySelector('img');
        img.src = imageUrl;
        this.overlay.classList.add('active');
        if (window.lucide) lucide.createIcons({ root: this.overlay });
    }

    close() {
        this.overlay.classList.remove('active');
        setTimeout(() => {
            this.overlay.querySelector('img').src = '';
        }, 300);
    }
}

// Initialize global utils
window.utils = {
    api,
    showToast,
    formatCurrency,
    formatDate,
    Lightbox,
    lightbox: null
};

// Prevent Right Click Globally
document.addEventListener('contextmenu', event => {
    if (event.target.tagName === 'IMG') {
        event.preventDefault();
        showToast('Right-click is disabled to protect images.', 'error');
    }
});
