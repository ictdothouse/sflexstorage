/**
 * Visual Page Builder (Elementor-lite)
 * Drag-and-drop, wireframe/live preview, per-block styling
 */
class PageBuilder {
    constructor() {
        this.pageId = null;
        this.blocks = [];
        this.selectedBlockId = null;
        this.mode = 'wireframe'; // wireframe | live
        this.dragType = null;
        this.dragBlockId = null;
    }

    async init() {
        // Get page ID from URL
        const params = new URLSearchParams(window.location.search);
        this.pageId = params.get('id');

        if (!this.pageId) {
            alert('No page ID specified');
            window.location.href = '/admin/';
            return;
        }

        this.canvas = document.getElementById('pb-canvas');
        this.inspector = document.getElementById('pb-inspector');

        this.bindToolbar();
        this.bindDragDrop();
        this.bindCanvasEvents();

        await this.loadPage();
    }

    // ─── TOOLBAR ───
    bindToolbar() {
        // Mode toggle
        document.querySelectorAll('.pb-mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.mode = btn.dataset.mode;
                document.querySelectorAll('.pb-mode-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.canvas.className = `pb-canvas ${this.mode}`;
                this.renderBlocks();
            });
        });

        // Settings
        document.getElementById('pb-btn-settings').addEventListener('click', () => {
            document.getElementById('pb-settings-modal').style.display = 'flex';
        });

        // Preview
        document.getElementById('pb-btn-preview').addEventListener('click', () => {
            const slug = document.getElementById('pb-settings-slug').value || 'preview';
            window.open(`/?slug=${slug}`, '_blank');
        });

        // Save
        document.getElementById('pb-btn-save').addEventListener('click', () => this.savePage());
    }

    // ─── LOAD PAGE ───
    async loadPage() {
        try {
            const res = await fetch(`/api/pages/${this.pageId}`, {
                headers: { 'Content-Type': 'application/json' }
            });
            const data = await res.json();
            if (!data.success || !data.page) throw new Error('Page not found');

            const page = data.page;
            document.getElementById('pb-page-title').textContent = page.title;
            document.getElementById('pb-settings-title').value = page.title;
            document.getElementById('pb-settings-slug').value = page.slug;
            document.getElementById('pb-settings-published').checked = page.is_published === 1;
            document.getElementById('pb-settings-homepage').checked = page.is_homepage === 1;
            document.title = `${page.title} — Page Builder`;

            try {
                this.blocks = JSON.parse(page.layout_data || '[]');
            } catch (e) {
                this.blocks = [];
            }

            // Ensure each block has an ID and styles
            this.blocks.forEach(b => {
                if (!b.id) b.id = this.uid();
                if (!b.styles) b.styles = {};
            });

            this.renderBlocks();
        } catch (err) {
            console.error(err);
            alert('Failed to load page: ' + err.message);
        }
    }

    // ─── SAVE PAGE ───
    async savePage() {
        const btn = document.getElementById('pb-btn-save');
        btn.disabled = true;
        btn.textContent = 'Saving...';

        try {
            const payload = {
                title: document.getElementById('pb-settings-title').value,
                slug: document.getElementById('pb-settings-slug').value,
                is_published: document.getElementById('pb-settings-published').checked,
                is_homepage: document.getElementById('pb-settings-homepage').checked,
                layout_data: this.blocks
            };

            const res = await fetch(`/api/pages/${this.pageId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!res.ok) throw new Error('Save failed');
            document.getElementById('pb-page-title').textContent = payload.title;
            this.toast('Page saved!');
        } catch (err) {
            this.toast('Save failed: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="save" style="width:16px;"></i> Save';
            if (window.lucide) lucide.createIcons({ root: btn });
        }
    }

    applySettings() {
        document.getElementById('pb-settings-modal').style.display = 'none';
        document.getElementById('pb-page-title').textContent = document.getElementById('pb-settings-title').value;
        this.toast('Settings applied. Click Save to persist.');
    }

    // ─── DRAG & DROP ───
    bindDragDrop() {
        // Palette blocks → drag start
        document.querySelectorAll('.pb-block-btn[draggable]').forEach(btn => {
            btn.addEventListener('dragstart', (e) => {
                this.dragType = 'new';
                e.dataTransfer.setData('text/plain', btn.dataset.blockType);
                e.dataTransfer.effectAllowed = 'copy';
            });
        });

        // Canvas drop events
        this.canvas.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = this.dragType === 'new' ? 'copy' : 'move';
            this.canvas.classList.add('drag-over');
            this.updateDropIndicator(e);
        });

        this.canvas.addEventListener('dragleave', () => {
            this.canvas.classList.remove('drag-over');
            this.clearDropIndicators();
        });

        this.canvas.addEventListener('drop', (e) => {
            e.preventDefault();
            this.canvas.classList.remove('drag-over');
            this.clearDropIndicators();

            const dropIndex = this.getDropIndex(e);

            if (this.dragType === 'new') {
                const type = e.dataTransfer.getData('text/plain');
                const newBlock = this.createDefaultBlock(type);
                this.blocks.splice(dropIndex, 0, newBlock);
                this.selectedBlockId = newBlock.id;
            } else if (this.dragType === 'reorder' && this.dragBlockId) {
                const oldIndex = this.blocks.findIndex(b => b.id === this.dragBlockId);
                if (oldIndex !== -1 && oldIndex !== dropIndex) {
                    const [block] = this.blocks.splice(oldIndex, 1);
                    const insertAt = dropIndex > oldIndex ? dropIndex - 1 : dropIndex;
                    this.blocks.splice(insertAt, 0, block);
                }
            }

            this.dragType = null;
            this.dragBlockId = null;
            this.renderBlocks();
            this.renderInspector();
        });
    }

    updateDropIndicator(e) {
        this.clearDropIndicators();
        const blockEls = this.canvas.querySelectorAll('.pb-block');
        for (const el of blockEls) {
            const rect = el.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) {
                el.classList.add('drag-over-top');
                return;
            }
        }
        if (blockEls.length > 0) {
            blockEls[blockEls.length - 1].classList.add('drag-over-bottom');
        }
    }

    clearDropIndicators() {
        this.canvas.querySelectorAll('.drag-over-top, .drag-over-bottom').forEach(el => {
            el.classList.remove('drag-over-top', 'drag-over-bottom');
        });
    }

    getDropIndex(e) {
        const blockEls = this.canvas.querySelectorAll('.pb-block');
        for (let i = 0; i < blockEls.length; i++) {
            const rect = blockEls[i].getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) return i;
        }
        return this.blocks.length;
    }

    // ─── CANVAS EVENTS ───
    bindCanvasEvents() {
        this.canvas.addEventListener('click', (e) => {
            const blockEl = e.target.closest('.pb-block');

            // Delete
            if (e.target.closest('.pb-act-delete')) {
                const id = blockEl?.dataset.blockId;
                this.blocks = this.blocks.filter(b => b.id !== id);
                this.selectedBlockId = null;
                this.renderBlocks();
                this.renderInspector();
                return;
            }

            // Move up
            if (e.target.closest('.pb-act-up')) {
                const id = blockEl?.dataset.blockId;
                const idx = this.blocks.findIndex(b => b.id === id);
                if (idx > 0) {
                    [this.blocks[idx], this.blocks[idx - 1]] = [this.blocks[idx - 1], this.blocks[idx]];
                    this.renderBlocks();
                }
                return;
            }

            // Move down
            if (e.target.closest('.pb-act-down')) {
                const id = blockEl?.dataset.blockId;
                const idx = this.blocks.findIndex(b => b.id === id);
                if (idx < this.blocks.length - 1) {
                    [this.blocks[idx], this.blocks[idx + 1]] = [this.blocks[idx + 1], this.blocks[idx]];
                    this.renderBlocks();
                }
                return;
            }

            // Select
            if (blockEl) {
                this.selectedBlockId = blockEl.dataset.blockId;
                this.canvas.querySelectorAll('.pb-block').forEach(el => el.classList.remove('selected'));
                blockEl.classList.add('selected');
                this.renderInspector();
            }
        });
    }

    // ─── RENDER BLOCKS ───
    renderBlocks() {
        const emptyMsg = document.getElementById('pb-empty-msg');

        if (this.blocks.length === 0) {
            if (emptyMsg) emptyMsg.style.display = 'block';
            // Remove all blocks but keep empty msg
            this.canvas.querySelectorAll('.pb-block').forEach(el => el.remove());
            return;
        }
        if (emptyMsg) emptyMsg.style.display = 'none';

        // Rebuild canvas
        const fragment = document.createDocumentFragment();

        this.blocks.forEach(block => {
            const el = document.createElement('div');
            el.className = `pb-block ${block.id === this.selectedBlockId ? 'selected' : ''}`;
            el.dataset.blockId = block.id;
            el.draggable = true;

            // Drag to reorder
            el.addEventListener('dragstart', (e) => {
                this.dragType = 'reorder';
                this.dragBlockId = block.id;
                e.dataTransfer.effectAllowed = 'move';
            });

            // Apply styles
            const s = block.styles || {};
            if (s.marginTop) el.style.marginTop = s.marginTop;
            if (s.marginBottom) el.style.marginBottom = s.marginBottom;
            if (s.paddingTop) el.style.paddingTop = s.paddingTop;
            if (s.paddingBottom) el.style.paddingBottom = s.paddingBottom;
            if (s.backgroundColor) el.style.backgroundColor = s.backgroundColor;
            if (s.textColor) el.style.color = s.textColor;
            if (s.textAlign) el.style.textAlign = s.textAlign;
            if (s.borderRadius) el.style.borderRadius = s.borderRadius;

            const typeLabel = block.type.replace(/_/g, ' ').toUpperCase();

            el.innerHTML = `
                <div class="pb-block-header">
                    <span><i data-lucide="grip-horizontal" style="width:14px;display:inline;cursor:grab;margin-right:4px;vertical-align:-2px;"></i>${typeLabel}</span>
                    <div class="pb-block-actions">
                        <button class="pb-act-up" title="Move Up"><i data-lucide="arrow-up" style="width:14px;"></i></button>
                        <button class="pb-act-down" title="Move Down"><i data-lucide="arrow-down" style="width:14px;"></i></button>
                        <button class="pb-act-delete danger" title="Delete"><i data-lucide="trash-2" style="width:14px;"></i></button>
                    </div>
                </div>
                <div class="pb-block-wireframe">
                    <div class="wf-label"><i data-lucide="${this.getBlockIcon(block.type)}" style="width:16px;"></i> ${typeLabel} ${block.title ? '— ' + block.title : ''}</div>
                    <div class="wf-placeholder"></div>
                </div>
                <div class="pb-block-preview">
                    ${this.renderBlockPreview(block)}
                </div>
            `;

            fragment.appendChild(el);
        });

        // Clear and append
        this.canvas.querySelectorAll('.pb-block').forEach(el => el.remove());
        this.canvas.appendChild(fragment);

        if (window.lucide) lucide.createIcons({ root: this.canvas });
    }

    getBlockIcon(type) {
        const icons = { hero: 'image', web_banner: 'monitor', text: 'type', stats: 'bar-chart', carousel: 'sliders', gallery_grid: 'grid-3x3', grid_row: 'layout' };
        return icons[type] || 'box';
    }

    renderBlockPreview(block) {
        const s = block.styles || {};
        switch (block.type) {
            case 'hero':
                return `<div style="padding:60px 24px; text-align:center; background:linear-gradient(135deg, rgba(124,58,237,0.15), rgba(6,182,212,0.15)); border-radius:8px;">
                    ${block.badge ? `<span style="background:rgba(245,158,11,0.2); color:#f59e0b; padding:4px 12px; border-radius:20px; font-size:0.75rem;">${block.badge}</span>` : ''}
                    <h2 style="margin:12px 0 8px;">${block.title || 'Hero Title'}</h2>
                    <p style="color:var(--text-secondary);">${block.subtitle || 'Subtitle text'}</p>
                </div>`;

            case 'web_banner':
                return `<div style="padding:60px 24px; text-align:${block.align || 'center'}; background:${block.image_url ? `url('${block.image_url}') center/cover` : 'linear-gradient(135deg, #333, #555)'}; border-radius:8px; color:white; position:relative;">
                    <div style="position:absolute;inset:0;background:${block.overlay === 'light' ? 'rgba(255,255,255,0.6)' : (block.overlay === 'none' ? 'transparent' : 'rgba(0,0,0,0.5)')};border-radius:8px;"></div>
                    <div style="position:relative;z-index:1;">
                        <h2 style="margin-bottom:8px;">${block.title || 'Banner Title'}</h2>
                        <p>${block.subtitle || 'Banner subtitle'}</p>
                        ${block.cta_text ? `<button style="margin-top:12px; padding:8px 20px; border-radius:20px; background:var(--accent-primary); color:white; border:none;">${block.cta_text}</button>` : ''}
                    </div>
                </div>`;

            case 'text':
                return `<div style="padding:24px; border-radius:8px;">
                    ${block.title ? `<h3 style="margin-bottom:12px;">${block.title}</h3>` : ''}
                    <div style="color:var(--text-secondary); font-size:0.95rem;">${block.content || '<em>Empty text block</em>'}</div>
                </div>`;

            case 'stats':
                const items = block.items || [{ value: '0', label: 'Item' }];
                return `<div style="display:flex; gap:24px; padding:24px; justify-content:center; flex-wrap:wrap;">
                    ${items.map(i => `<div style="text-align:center;"><strong style="font-size:1.5rem; color:var(--accent-primary);">${i.value}</strong><br><span style="font-size:0.85rem; color:var(--text-muted);">${i.label}</span></div>`).join('')}
                </div>`;

            case 'carousel':
                const slides = block.slides || [];
                return `<div style="padding:16px; text-align:center; background:var(--bg-elevated); border-radius:8px;">
                    <i data-lucide="sliders" style="width:32px; height:32px; color:var(--accent-primary); margin-bottom:8px;"></i>
                    <div>Carousel — ${slides.length} slide(s)</div>
                </div>`;

            case 'gallery_grid':
                return `<div style="padding:16px; text-align:center; background:var(--bg-elevated); border-radius:8px;">
                    <i data-lucide="grid-3x3" style="width:32px; height:32px; color:var(--accent-primary); margin-bottom:8px;"></i>
                    <div>${block.title || 'Gallery Grid'} — showing ${block.limit || 6} galleries</div>
                </div>`;

            case 'grid_row':
                const cols = block.columns || [{ content: 'Col 1' }, { content: 'Col 2' }];
                return `<div style="display:flex; gap:12px; padding:16px; flex-wrap:wrap;">
                    ${cols.map(c => `<div style="flex:1; min-width:120px; padding:16px; background:var(--bg-elevated); border-radius:8px; border:1px dashed var(--border-subtle); font-size:0.85rem;">${c.content || 'Column'}</div>`).join('')}
                </div>`;

            default:
                return `<div style="padding:20px; text-align:center; color:var(--text-muted);">Unknown block: ${block.type}</div>`;
        }
    }

    // ─── INSPECTOR ───
    renderInspector() {
        const block = this.blocks.find(b => b.id === this.selectedBlockId);
        if (!block) {
            this.inspector.innerHTML = `<div class="pb-no-selection"><i data-lucide="pointer" style="width:32px;height:32px;margin-bottom:12px;color:var(--text-muted);"></i><div>Click on a block to edit its content and style.</div></div>`;
            if (window.lucide) lucide.createIcons({ root: this.inspector });
            return;
        }

        let contentFields = this.getContentFields(block);
        let styleFields = this.getStyleFields(block);

        this.inspector.innerHTML = `
            <h5>Content — ${block.type.replace(/_/g, ' ').toUpperCase()}</h5>
            <div id="pb-content-fields">${contentFields}</div>
            <h5>Styling</h5>
            <div id="pb-style-fields">${styleFields}</div>
        `;

        // Bind change events
        this.inspector.querySelectorAll('[data-prop]').forEach(input => {
            input.addEventListener('input', () => {
                const prop = input.dataset.prop;
                block[prop] = input.value;
                this.renderBlocks();
            });
        });

        this.inspector.querySelectorAll('[data-style]').forEach(input => {
            input.addEventListener('input', () => {
                if (!block.styles) block.styles = {};
                block.styles[input.dataset.style] = input.value;
                this.renderBlocks();
            });
        });

        // Media selector button
        this.inspector.querySelectorAll('.pb-media-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetInput = btn.previousElementSibling;
                this.openMediaSelector(targetInput, block);
            });
        });

        // Items/slides JSON textarea handler
        this.inspector.querySelectorAll('[data-json-prop]').forEach(textarea => {
            textarea.addEventListener('change', () => {
                try {
                    block[textarea.dataset.jsonProp] = JSON.parse(textarea.value);
                    this.renderBlocks();
                } catch (e) { /* invalid JSON, ignore */ }
            });
        });

        if (window.lucide) lucide.createIcons({ root: this.inspector });
    }

    getContentFields(block) {
        switch (block.type) {
            case 'hero':
                return `
                    ${this.field('Title', 'title', block.title)}
                    ${this.field('Subtitle', 'subtitle', block.subtitle)}
                    ${this.field('Badge', 'badge', block.badge)}
                `;
            case 'web_banner':
                return `
                    ${this.field('Title', 'title', block.title)}
                    ${this.field('Subtitle', 'subtitle', block.subtitle)}
                    ${this.mediaField('Background Image', 'image_url', block.image_url)}
                    ${this.field('CTA Text', 'cta_text', block.cta_text)}
                    ${this.field('CTA Link', 'cta_link', block.cta_link)}
                    ${this.selectField('Align', 'align', block.align || 'center', ['left', 'center', 'right'])}
                    ${this.selectField('Overlay', 'overlay', block.overlay || 'dark', ['dark', 'light', 'none'])}
                `;
            case 'text':
                return `
                    ${this.field('Title', 'title', block.title)}
                    ${this.textareaField('Content (HTML)', 'content', block.content)}
                `;
            case 'stats':
                return `
                    <div class="pb-content-field">
                        <label>Items (JSON)</label>
                        <textarea data-json-prop="items" rows="4">${JSON.stringify(block.items || [], null, 2)}</textarea>
                    </div>
                `;
            case 'carousel':
                return `
                    <div class="pb-content-field">
                        <label>Slides (JSON)</label>
                        <textarea data-json-prop="slides" rows="4">${JSON.stringify(block.slides || [], null, 2)}</textarea>
                    </div>
                `;
            case 'gallery_grid':
                return `
                    ${this.field('Title', 'title', block.title || 'Featured Collections')}
                    ${this.field('Limit', 'limit', block.limit || 6, 'number')}
                `;
            case 'grid_row':
                return `
                    <div class="pb-content-field">
                        <label>Columns (JSON)</label>
                        <textarea data-json-prop="columns" rows="5">${JSON.stringify(block.columns || [], null, 2)}</textarea>
                    </div>
                `;
            default:
                return '<div class="text-muted">No content fields for this block.</div>';
        }
    }

    getStyleFields(block) {
        const s = block.styles || {};
        return `
            <div class="pb-prop-row"><label>Margin Top</label><input data-style="marginTop" value="${s.marginTop || ''}" placeholder="e.g. 20px"></div>
            <div class="pb-prop-row"><label>Margin Bottom</label><input data-style="marginBottom" value="${s.marginBottom || ''}" placeholder="e.g. 20px"></div>
            <div class="pb-prop-row"><label>Padding Top</label><input data-style="paddingTop" value="${s.paddingTop || ''}" placeholder="e.g. 40px"></div>
            <div class="pb-prop-row"><label>Padding Bottom</label><input data-style="paddingBottom" value="${s.paddingBottom || ''}" placeholder="e.g. 40px"></div>
            <div class="pb-prop-row"><label>BG Color</label><input type="color" data-style="backgroundColor" value="${s.backgroundColor || '#00000000'}"><input data-style="backgroundColor" value="${s.backgroundColor || ''}" placeholder="#hex"></div>
            <div class="pb-prop-row"><label>Text Color</label><input type="color" data-style="textColor" value="${s.textColor || '#ffffff'}"><input data-style="textColor" value="${s.textColor || ''}" placeholder="#hex"></div>
            <div class="pb-prop-row"><label>Text Align</label>
                <select data-style="textAlign">
                    <option value="" ${!s.textAlign ? 'selected' : ''}>Default</option>
                    <option value="left" ${s.textAlign === 'left' ? 'selected' : ''}>Left</option>
                    <option value="center" ${s.textAlign === 'center' ? 'selected' : ''}>Center</option>
                    <option value="right" ${s.textAlign === 'right' ? 'selected' : ''}>Right</option>
                </select>
            </div>
            <div class="pb-prop-row"><label>Border Radius</label><input data-style="borderRadius" value="${s.borderRadius || ''}" placeholder="e.g. 12px"></div>
        `;
    }

    // ─── FIELD HELPERS ───
    field(label, prop, value, type = 'text') {
        return `<div class="pb-content-field"><label>${label}</label><input type="${type}" data-prop="${prop}" value="${this.esc(value || '')}"></div>`;
    }

    textareaField(label, prop, value) {
        return `<div class="pb-content-field"><label>${label}</label><textarea data-prop="${prop}" rows="4">${this.esc(value || '')}</textarea></div>`;
    }

    selectField(label, prop, value, options) {
        const opts = options.map(o => `<option value="${o}" ${value === o ? 'selected' : ''}>${o}</option>`).join('');
        return `<div class="pb-content-field"><label>${label}</label><select data-prop="${prop}">${opts}</select></div>`;
    }

    mediaField(label, prop, value) {
        return `<div class="pb-content-field"><label>${label}</label><div style="display:flex;gap:6px;"><input data-prop="${prop}" value="${this.esc(value || '')}" style="flex:1;"><button class="btn btn-ghost pb-media-btn" style="padding:4px 8px;"><i data-lucide="image" style="width:14px;"></i></button></div></div>`;
    }

    // ─── MEDIA SELECTOR (simple) ───
    async openMediaSelector(targetInput, block) {
        // Create a simple inline media picker
        const modal = document.createElement('div');
        modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:300;display:flex;align-items:center;justify-content:center;';
        modal.innerHTML = `
            <div class="glass-panel" style="width:100%;max-width:700px;padding:24px;max-height:80vh;display:flex;flex-direction:column;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <h3>Select Image</h3>
                    <button class="btn btn-ghost" id="media-close"><i data-lucide="x"></i></button>
                </div>
                <div id="media-picker-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;overflow-y:auto;flex:1;">
                    <div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">Loading...</div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        if (window.lucide) lucide.createIcons({ root: modal });

        modal.querySelector('#media-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        try {
            const res = await fetch('/api/images?limit=50', { headers: { 'Content-Type': 'application/json' } });
            const data = await res.json();
            const images = data.images || [];
            const grid = modal.querySelector('#media-picker-grid');

            if (images.length === 0) {
                grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted);">No images found.</div>';
                return;
            }

            grid.innerHTML = images.map(img => `
                <div style="cursor:pointer;border-radius:8px;overflow:hidden;border:2px solid transparent;transition:border-color 0.2s;" onmouseover="this.style.borderColor='var(--accent-primary)'" onmouseout="this.style.borderColor='transparent'" data-url="/uploads/${img.filename}">
                    <img src="/uploads/${img.filename}" style="width:100%;aspect-ratio:1;object-fit:cover;">
                </div>
            `).join('');

            grid.querySelectorAll('[data-url]').forEach(el => {
                el.addEventListener('click', () => {
                    const url = el.dataset.url;
                    const prop = targetInput.dataset.prop;
                    block[prop] = url;
                    targetInput.value = url;
                    this.renderBlocks();
                    modal.remove();
                });
            });
        } catch (err) {
            console.error(err);
        }
    }

    // ─── DEFAULT BLOCKS ───
    createDefaultBlock(type) {
        const id = this.uid();
        const defaults = {
            hero: { id, type, title: 'Welcome to Our Site', subtitle: 'A beautiful subtitle goes here.', badge: '', styles: {} },
            web_banner: { id, type, title: 'Banner Title', subtitle: 'Banner subtitle text.', image_url: '', cta_text: 'Learn More', cta_link: '#', align: 'center', overlay: 'dark', styles: {} },
            text: { id, type, title: '', content: 'Write your content here...', styles: {} },
            stats: { id, type, items: [{ value: '100+', label: 'Photos' }, { value: '50+', label: 'Galleries' }, { value: '10k', label: 'Downloads' }], styles: {} },
            carousel: { id, type, slides: [{ image_url: '', caption: 'Slide 1' }], styles: {} },
            gallery_grid: { id, type, title: 'Featured Collections', limit: 6, styles: {} },
            grid_row: { id, type, columns: [{ content: 'Column 1' }, { content: 'Column 2' }], styles: {} }
        };
        return defaults[type] || { id, type, styles: {} };
    }

    // ─── UTILS ───
    uid() {
        return 'b' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    esc(str) {
        return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    toast(msg, type = 'success') {
        if (window.utils?.showToast) {
            window.utils.showToast(msg, type);
        } else {
            console.log(`[${type}] ${msg}`);
        }
    }
}
