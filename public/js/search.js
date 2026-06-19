class SearchPage {
    constructor() {
        this.form = document.getElementById('search-form');
        this.filterForm = document.getElementById('filter-form');
        this.qInput = document.getElementById('search-q');
        this.container = document.getElementById('results-container');
        this.stats = document.getElementById('search-stats');
        this.loadMoreBtn = document.getElementById('load-more-btn');
        this.loadMoreContainer = document.getElementById('load-more-container');
        this.gallerySelect = document.getElementById('filter-gallery');

        this.page = 1;
        this.isLoading = false;
        this.hasMore = false;

        // Parse initial URL params
        const params = new URLSearchParams(window.location.search);
        this.qInput.value = params.get('q') || '';
        if (params.get('sort')) document.getElementById('filter-sort').value = params.get('sort');
        if (params.get('orientation')) document.getElementById('filter-orientation').value = params.get('orientation');
        
        this.bindEvents();
        if (this.qInput.value.trim() !== '') {
            this.performSearch(true);
        }
    }

    bindEvents() {
        this.form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateUrl();
            this.performSearch(true);
        });

        this.filterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateUrl();
            this.performSearch(true);
        });

        this.loadMoreBtn.addEventListener('click', () => {
            if (!this.isLoading && this.hasMore) {
                this.page++;
                this.performSearch(false);
            }
        });
    }

    updateUrl() {
        const params = new URLSearchParams();
        const q = this.qInput.value.trim();
        if (q) params.set('q', q);
        
        const sort = document.getElementById('filter-sort').value;
        if (sort !== 'relevance') params.set('sort', sort);
        
        const orientation = document.getElementById('filter-orientation').value;
        if (orientation) params.set('orientation', orientation);
        
        const gallery = this.gallerySelect.value;
        if (gallery) params.set('gallery_id', gallery);

        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
    }

    async performSearch(isNewSearch = true) {
        if (isNewSearch) {
            this.page = 1;
            this.container.innerHTML = '<div class="glass-panel text-center py-12" style="grid-column:1/-1;"><i data-lucide="loader-2" class="spin"></i> Searching...</div>';
            if (window.lucide) lucide.createIcons();
        } else {
            this.loadMoreBtn.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Loading...';
            if (window.lucide) lucide.createIcons({ root: this.loadMoreBtn });
        }

        this.isLoading = true;

        try {
            const params = new URLSearchParams(window.location.search);
            params.set('page', this.page);
            
            const res = await window.utils.api.get(`/search?${params.toString()}`);
            
            this.stats.innerHTML = `Found <strong class="text-white">${res.pagination.total}</strong> results for "${res.query || 'all'}"`;
            
            // Populate filters if first load
            if (isNewSearch && res.filters && res.filters.galleries) {
                const currentVal = this.gallerySelect.value;
                this.gallerySelect.innerHTML = '<option value="">All Collections</option>' + 
                    res.filters.galleries.map(g => `<option value="${g.id}">${g.title}</option>`).join('');
                if (currentVal) this.gallerySelect.value = currentVal;
            }

            this.renderResults(res.images, isNewSearch);
            
            this.hasMore = res.pagination.page < res.pagination.totalPages;
            if (this.hasMore) {
                this.loadMoreContainer.classList.remove('hidden');
                this.loadMoreBtn.innerHTML = 'Load More Results';
            } else {
                this.loadMoreContainer.classList.add('hidden');
            }

        } catch (error) {
            this.stats.textContent = 'Search failed';
            if (isNewSearch) {
                this.container.innerHTML = `<div class="glass-panel text-center py-12 text-danger" style="grid-column:1/-1;">${error.message}</div>`;
            } else {
                window.utils.showToast(error.message, 'error');
                this.loadMoreBtn.innerHTML = 'Load More Results';
            }
        } finally {
            this.isLoading = false;
        }
    }

    renderResults(images, clear) {
        if (clear) this.container.innerHTML = '';
        
        if (images.length === 0 && clear) {
            this.container.innerHTML = '<div class="glass-panel text-center py-12" style="grid-column:1/-1;">No photos found matching your criteria. Try different keywords or filters.</div>';
            return;
        }

        const html = images.map(img => `
            <div class="photo-item animate-slide-up" data-id="${img.id}">
                <img src="/api/images/${img.id}/thumbnail" alt="${img.title}" loading="lazy" onclick="window.location.href = '/image?id=${img.id}'">
                
                <div class="photo-overlay" onclick="window.location.href = '/image?id=${img.id}'">
                    <div class="photo-info">
                        <h4>${img.title}</h4>
                        <p>${window.utils.formatCurrency(img.price)}</p>
                        ${img.camera_model ? `<p style="font-size:10px; margin-top:4px;"><i data-lucide="camera" style="width:10px; height:10px; display:inline-block"></i> ${img.camera_model}</p>` : ''}
                    </div>
                </div>
                
                <div class="photo-actions">
                    <button class="action-btn favorite-btn ${img.is_favorited ? 'active' : ''}" data-image-id="${img.id}" title="Favorite">
                        <i data-lucide="heart" fill="${img.is_favorited ? 'currentColor' : 'none'}"></i>
                    </button>
                    <button class="action-btn add-to-cart-btn" data-image-id="${img.id}" title="Add to Cart">
                        <i data-lucide="shopping-cart"></i>
                    </button>
                </div>
            </div>
        `).join('');

        if (clear) {
            this.container.innerHTML = html;
        } else {
            this.container.insertAdjacentHTML('beforeend', html);
        }

        if (window.lucide) lucide.createIcons({ root: this.container });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SearchPage();
});
