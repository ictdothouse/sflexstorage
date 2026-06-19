class PageRenderer {
    constructor(rootId = 'cms-root') {
        this.root = document.getElementById(rootId);
    }

    async render(slug) {
        if (!this.root) return;
        this.root.innerHTML = '<div class="glass-panel text-center py-12" style="margin: 100px auto; max-width: 400px;"><i data-lucide="loader-2" class="spin"></i> Loading page...</div>';
        if (window.lucide) lucide.createIcons({ root: this.root });

        try {
            // Fetch page data
            const res = await fetch(`/api/pages/public/${slug}`);
            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Page not found');
            }

            const page = data.page;
            document.title = `${page.title} | PhotoVault`;

            // Parse layout data
            let layout = [];
            try {
                layout = JSON.parse(page.layout_data || '[]');
            } catch (e) {
                console.error('Invalid layout data');
            }

            this.root.innerHTML = ''; // Clear loading

            if (layout.length === 0) {
                this.root.innerHTML = '<div class="container py-12 text-center text-muted">This page is empty.</div>';
                return;
            }

            // Render each block
            for (const block of layout) {
                const blockEl = await this.renderBlock(block);
                if (blockEl) {
                    this.root.appendChild(blockEl);
                }
            }

            // Re-init icons
            if (window.lucide) lucide.createIcons({ root: this.root });

        } catch (error) {
            this.root.innerHTML = `
                <div class="container py-16 text-center">
                    <i data-lucide="alert-circle" style="width:64px;height:64px;color:var(--accent-danger);margin:0 auto 16px;"></i>
                    <h2>Oops!</h2>
                    <p class="text-muted">${error.message}</p>
                    <a href="/" class="btn btn-primary" style="margin-top:24px;">Go Home</a>
                </div>
            `;
            if (window.lucide) lucide.createIcons({ root: this.root });
        }
    }

    async renderBlock(block) {
        const wrapper = document.createElement('section');
        
        switch (block.type) {
            case 'hero':
                wrapper.className = 'cms-hero animate-slide-up';
                wrapper.innerHTML = `
                    <div class="cms-hero-bg"></div>
                    <div class="container relative">
                        <div class="cms-hero-content">
                            ${block.badge ? `<span class="badge badge-gold mb-8">${block.badge}</span>` : ''}
                            <h1>${block.title}</h1>
                            ${block.subtitle ? `<p style="font-size: 1.2rem; max-width: 600px; margin: 0 auto;">${block.subtitle}</p>` : ''}
                            
                            <div class="cms-hero-search">
                                <form action="/search" method="GET">
                                    <i data-lucide="search"></i>
                                    <input type="text" name="q" placeholder="Search for photos, events, or people..." required>
                                    <button type="submit" class="btn btn-primary btn-search">Search</button>
                                </form>
                            </div>
                        </div>
                    </div>
                `;
                break;

            case 'stats':
                wrapper.className = 'cms-stats';
                const itemsHtml = (block.items || []).map(item => `
                    <div class="cms-stat-item">
                        <h3>${item.value}</h3>
                        <p>${item.label}</p>
                    </div>
                `).join('');
                wrapper.innerHTML = `
                    <div class="container">
                        <div class="cms-stats-grid">
                            ${itemsHtml}
                        </div>
                    </div>
                `;
                break;

            case 'gallery_grid':
                wrapper.className = 'cms-gallery';
                wrapper.innerHTML = `
                    <div class="container">
                        <div class="flex justify-between items-center">
                            <h2>${block.title || 'Galleries'}</h2>
                            <a href="/gallery" class="btn btn-secondary">View All</a>
                        </div>
                        <div class="cms-gallery-grid" id="cms-gallery-${Date.now()}">
                            <div class="glass-panel text-center py-12" style="grid-column: 1 / -1;">
                                <i data-lucide="loader-2" class="spin"></i> Loading collections...
                            </div>
                        </div>
                    </div>
                `;
                
                // Fetch galleries for this block asynchronously
                setTimeout(async () => {
                    const grid = wrapper.querySelector('.cms-gallery-grid');
                    try {
                        const res = await fetch(`/api/galleries?limit=${block.limit || 6}`);
                        const data = await res.json();
                        
                        if (data.galleries && data.galleries.length > 0) {
                            grid.innerHTML = data.galleries.map(g => `
                                <a href="/gallery?slug=${g.slug}" class="cms-gallery-card animate-slide-up">
                                    <img src="${g.first_image ? '/uploads/' + g.first_image : 'https://images.unsplash.com/photo-1682687220742-aba13b6e50ba?auto=format&fit=crop&w=800&q=80'}" alt="${g.title}" loading="lazy">
                                    <div class="cms-gallery-card-overlay">
                                        <h3>${g.title}</h3>
                                        <div class="flex gap-4">
                                            <span class="text-sm text-secondary"><i data-lucide="image" style="width:14px; height:14px; display:inline-block; vertical-align:middle;"></i> ${g.image_count} Photos</span>
                                        </div>
                                    </div>
                                </a>
                            `).join('');
                            if (window.lucide) lucide.createIcons({ root: grid });
                        } else {
                            grid.innerHTML = `<div class="glass-panel text-center py-12" style="grid-column: 1 / -1;">No public galleries available yet.</div>`;
                        }
                    } catch (e) {
                        grid.innerHTML = `<div class="text-danger">Failed to load galleries</div>`;
                    }
                }, 0);
                break;

            case 'text':
                wrapper.className = 'container';
                wrapper.innerHTML = `
                    <div class="cms-text-block">
                        ${block.title ? `<h2 style="margin-bottom:24px;text-align:center;">${block.title}</h2>` : ''}
                        <div>${block.content || ''}</div>
                    </div>
                `;
                break;
                
            case 'web_banner':
                wrapper.className = 'cms-web-banner';
                const alignClass = block.align === 'left' ? 'text-left' : (block.align === 'right' ? 'text-right' : 'text-center');
                const overlayBg = block.overlay === 'light' ? 'rgba(255,255,255,0.7)' : (block.overlay === 'none' ? 'transparent' : 'rgba(0,0,0,0.6)');
                const textColor = block.overlay === 'light' ? '#000' : '#fff';
                
                wrapper.style.position = 'relative';
                wrapper.style.backgroundImage = `url('${block.image_url || ''}')`;
                wrapper.style.backgroundSize = 'cover';
                wrapper.style.backgroundPosition = 'center';
                wrapper.style.color = textColor;
                wrapper.style.padding = '100px 20px';
                
                wrapper.innerHTML = `
                    <div style="position:absolute; top:0; left:0; right:0; bottom:0; background: ${overlayBg};"></div>
                    <div class="container relative ${alignClass}" style="position:relative; z-index:1;">
                        ${block.title ? `<h1 style="font-size: 3rem; margin-bottom: 16px;">${block.title}</h1>` : ''}
                        ${block.subtitle ? `<p style="font-size: 1.2rem; margin-bottom: 32px; max-width: 800px; ${block.align === 'center' ? 'margin-left: auto; margin-right: auto;' : ''}">${block.subtitle}</p>` : ''}
                        ${block.cta_text ? `<a href="${block.cta_link || '#'}" class="btn btn-primary">${block.cta_text}</a>` : ''}
                    </div>
                `;
                break;

            case 'carousel':
                wrapper.className = 'cms-carousel';
                const slides = block.slides || [];
                const slidesHtml = slides.map((s, i) => `
                    <div class="carousel-slide" style="display: ${i === 0 ? 'block' : 'none'}; position: relative;">
                        <img src="${s.image_url}" alt="Slide ${i+1}" style="width: 100%; height: 500px; object-fit: cover; border-radius: 12px;">
                        ${s.caption ? `<div style="position:absolute; bottom: 20px; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.6); color: white; padding: 10px 20px; border-radius: 8px;">${s.caption}</div>` : ''}
                    </div>
                `).join('');
                
                wrapper.innerHTML = `
                    <div class="carousel-container container" style="position: relative; overflow: hidden; border-radius: 12px; margin: 40px auto; max-width: 1200px;">
                        ${slidesHtml}
                        ${slides.length > 1 ? `
                            <button class="btn btn-ghost carousel-prev" style="position: absolute; top: 50%; left: 10px; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border-radius: 50%; width: 40px; height: 40px; padding: 0; display:flex; align-items:center; justify-content:center;"><i data-lucide="chevron-left"></i></button>
                            <button class="btn btn-ghost carousel-next" style="position: absolute; top: 50%; right: 10px; transform: translateY(-50%); background: rgba(0,0,0,0.5); color: white; border-radius: 50%; width: 40px; height: 40px; padding: 0; display:flex; align-items:center; justify-content:center;"><i data-lucide="chevron-right"></i></button>
                        ` : ''}
                    </div>
                `;
                
                if (slides.length > 1) {
                    const uniqueId = 'carousel-' + Date.now() + Math.floor(Math.random()*1000);
                    wrapper.id = uniqueId;
                    setTimeout(() => {
                        const root = document.getElementById(uniqueId);
                        if (!root) return;
                        const slideEls = root.querySelectorAll('.carousel-slide');
                        let currentIdx = 0;
                        const showSlide = (idx) => {
                            slideEls.forEach((el, i) => el.style.display = i === idx ? 'block' : 'none');
                        };
                        root.querySelector('.carousel-prev')?.addEventListener('click', () => {
                            currentIdx = (currentIdx - 1 + slideEls.length) % slideEls.length;
                            showSlide(currentIdx);
                        });
                        root.querySelector('.carousel-next')?.addEventListener('click', () => {
                            currentIdx = (currentIdx + 1) % slideEls.length;
                            showSlide(currentIdx);
                        });
                        setInterval(() => {
                            currentIdx = (currentIdx + 1) % slideEls.length;
                            showSlide(currentIdx);
                        }, 5000);
                    }, 100);
                }
                break;

            case 'grid_row':
                wrapper.className = 'container cms-grid-row';
                wrapper.style.margin = '40px auto';
                const cols = block.columns || [];
                const colsHtml = cols.map(c => `
                    <div class="grid-col" style="flex: 1; min-width: 250px; padding: 24px; background: var(--bg-surface); border-radius: 12px; border: 1px solid var(--border-subtle);">
                        ${c.content || ''}
                    </div>
                `).join('');
                
                wrapper.innerHTML = `
                    <div style="display: flex; gap: 24px; flex-wrap: wrap;">
                        ${colsHtml}
                    </div>
                `;
                break;
                
            default:
                wrapper.innerHTML = `<div class="container py-8"><div class="glass-panel">Unknown block type: ${block.type}</div></div>`;
        }

        // Apply custom styles from the page builder
        if (block.styles) {
            const s = block.styles;
            if (s.marginTop) wrapper.style.marginTop = s.marginTop;
            if (s.marginBottom) wrapper.style.marginBottom = s.marginBottom;
            if (s.paddingTop) wrapper.style.paddingTop = s.paddingTop;
            if (s.paddingBottom) wrapper.style.paddingBottom = s.paddingBottom;
            if (s.backgroundColor) wrapper.style.backgroundColor = s.backgroundColor;
            if (s.textColor) wrapper.style.color = s.textColor;
            if (s.textAlign) wrapper.style.textAlign = s.textAlign;
            if (s.borderRadius) wrapper.style.borderRadius = s.borderRadius;
        }

        return wrapper;
    }
}
