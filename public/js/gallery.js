class GalleryRenderer {
    constructor() {
        this.container = document.getElementById('gallery-container');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.loadMoreContainer = document.getElementById('load-more-container');
        this.layoutBtns = document.querySelectorAll('.layout-btn');
        
        this.currentPage = 1;
        this.isLoading = false;
        this.hasMore = true;
        this.currentSlug = new URLSearchParams(window.location.search).get('slug') || null;
        
        this.bindEvents();
        this.loadGallery();
    }

    bindEvents() {
        // Layout Toggles
        this.layoutBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.layoutBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const layout = btn.dataset.layout;
                this.container.className = `gallery-container layout-${layout}`;
            });
        });

        // Load More
        if (this.loadMoreBtn) {
            this.loadMoreBtn.addEventListener('click', () => {
                if (!this.isLoading && this.hasMore) {
                    this.currentPage++;
                    this.loadImages();
                }
            });
        }
    }

    async loadGallery() {
        try {
            if (this.currentSlug) {
                // Load specific gallery
                const res = await window.utils.api.get(`/galleries/${this.currentSlug}`);
                this.renderGalleryHeader(res.gallery);
                this.renderImages(res.images, true);
                this.updatePagination(res.pagination);
            } else {
                // Load root galleries
                const res = await window.utils.api.get('/galleries');
                this.renderGalleries(res.galleries);
                this.updatePagination(res.pagination);
            }
        } catch (err) {
            this.container.innerHTML = `<div class="glass-panel text-center py-12" style="grid-column: 1 / -1;">
                <i data-lucide="alert-triangle" class="text-danger mb-4"></i>
                <p>${err.message || 'Failed to load gallery'}</p>
            </div>`;
            if (window.lucide) lucide.createIcons();
        }
    }

    async loadImages() {
        if (!this.currentSlug) return;
        this.isLoading = true;
        this.loadMoreBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Loading...';
        if (window.lucide) lucide.createIcons({ root: this.loadMoreBtn });

        try {
            const res = await window.utils.api.get(`/galleries/${this.currentSlug}?page=${this.currentPage}`);
            this.renderImages(res.images, false);
            this.updatePagination(res.pagination);
        } catch (err) {
            window.utils.showToast(err.message, 'error');
        } finally {
            this.isLoading = false;
            this.loadMoreBtn.innerHTML = 'Load More';
        }
    }

    renderGalleryHeader(gallery) {
        document.title = `${gallery.title} | PhotoVault`;
        const titleEl = document.getElementById('gallery-title');
        const descEl = document.getElementById('gallery-desc');
        if (titleEl) titleEl.textContent = gallery.title;
        if (descEl) descEl.textContent = gallery.description || '';
        
        // Update layout based on gallery setting if applicable
        if (gallery.layout_type) {
            const btn = document.querySelector(`.layout-btn[data-layout="${gallery.layout_type}"]`);
            if (btn) btn.click();
        }
    }

    renderGalleries(galleries) {
        if (galleries.length === 0) {
            this.container.innerHTML = '<div class="glass-panel text-center py-12 w-full" style="grid-column: 1 / -1;">No collections found.</div>';
            return;
        }

        const html = galleries.map(g => `
            <a href="/gallery?slug=${g.slug}" class="gallery-card animate-slide-up">
                <img src="${g.first_image ? '/uploads/' + g.first_image : 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?auto=format&fit=crop&w=800&q=80'}" alt="${g.title}" loading="lazy">
                <div class="gallery-card-overlay">
                    <h3>${g.title}</h3>
                    <p class="text-sm text-secondary"><i data-lucide="image" style="width:14px; height:14px; display:inline-block; vertical-align:middle;"></i> ${g.image_count} Photos</p>
                </div>
            </a>
        `).join('');

        this.container.innerHTML = html;
        if (window.lucide) lucide.createIcons({ root: this.container });
    }

    renderImages(images, clear = true) {
        if (clear) this.container.innerHTML = '';
        
        if (images.length === 0 && clear) {
            this.container.innerHTML = '<div class="glass-panel text-center py-12 w-full" style="grid-column: 1 / -1;">This collection is empty.</div>';
            return;
        }

        const html = images.map(img => {
            const user = window.App ? window.App.user : null;
            let canDownloadSub = false;
            if (user && user.subscription && user.subscription.plan_id) {
                const limit = user.subscription.downloads_limit;
                const used = user.subscription.downloads_used || 0;
                if (limit === -1 || limit > used) canDownloadSub = true;
            }

            return `
                <div class="photo-item animate-slide-up" data-id="${img.id}">
                    <img src="/api/images/${img.id}/thumbnail" alt="${img.title}" loading="lazy" onclick="window.location.href = '/image?id=${img.id}'">
                    
                    <div class="photo-overlay" onclick="window.location.href = '/image?id=${img.id}'">
                        <div class="photo-info">
                            <h4>${img.title}</h4>
                            ${canDownloadSub ? '' : `<p>${window.utils.formatCurrency(img.price)}</p>`}
                        </div>
                    </div>
                    
                    <div class="photo-actions">
                        <button class="action-btn favorite-btn ${img.is_favorited ? 'active' : ''}" data-image-id="${img.id}" title="Favorite">
                            <i data-lucide="heart" fill="${img.is_favorited ? 'currentColor' : 'none'}"></i>
                        </button>
                        ${canDownloadSub ? `
                            <button class="action-btn" title="Download with Subscription" onclick="window.location.href='/api/images/${img.id}/original'">
                                <i data-lucide="download"></i>
                            </button>
                        ` : `
                            <button class="action-btn add-to-cart-btn" data-image-id="${img.id}" title="Add to Cart">
                                <i data-lucide="shopping-cart"></i>
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');

        if (clear) {
            this.container.innerHTML = html;
        } else {
            this.container.insertAdjacentHTML('beforeend', html);
        }

        if (window.lucide) lucide.createIcons({ root: this.container });
    }

    updatePagination(pagination) {
        if (!pagination) return;
        this.hasMore = pagination.page < pagination.totalPages;
        
        if (this.loadMoreContainer) {
            if (this.hasMore) {
                this.loadMoreContainer.classList.remove('hidden');
            } else {
                this.loadMoreContainer.classList.add('hidden');
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (window.App && window.App._initPromise) {
        await window.App._initPromise;
    }
    new GalleryRenderer();
});

