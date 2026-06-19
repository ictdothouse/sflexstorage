/**
 * Admin Dashboard Logic
 * Manages all admin panel views and interactions
 */
class AdminPanel {
    constructor() {
        this.navItems = document.querySelectorAll('.nav-item[data-target]');
        this.viewSections = document.querySelectorAll('.view-section');
        this.headerTitle = document.getElementById('header-title');
        this.aiLoaded = false;
    }

    async init() {
        if (window.lucide) lucide.createIcons();

        // Verify admin session independently — don't use App.init() to avoid redirect loops
        try {
            const res = await fetch('/api/auth/me');
            const data = await res.json();

            if (!data.authenticated || data.user?.role !== 'admin') {
                window.location.href = '/login';
                return;
            }

            const nameEl = document.getElementById('admin-user-name');
            if (nameEl) nameEl.textContent = data.user.full_name || data.user.username;

        } catch (err) {
            console.error('Auth check failed:', err);
            window.location.href = '/login';
            return;
        }

        this.bindNavEvents();
        this.bindUploadEvents();
        this.bindFaceTabEvents();

        // Load default view
        this.loadView('dashboard');

        // Load AI models in background (non-blocking)
        this.loadFaceAPI();
    }

    // ─── AI MODEL LOADING ───
    async loadFaceAPI() {
        try {
            if (typeof faceapi === 'undefined') {
                console.warn('face-api.js not loaded yet, retrying in 2s...');
                setTimeout(() => this.loadFaceAPI(), 2000);
                return;
            }
            const modelUrl = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
            await faceapi.nets.ssdMobilenetv1.loadFromUri(modelUrl);
            await faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl);
            await faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl);
            this.aiLoaded = true;
            const badge = document.getElementById('ai-status-badge');
            if (badge) badge.classList.remove('hidden');
            if (window.lucide) lucide.createIcons({ root: badge });
            console.log('✅ Face API models loaded');
        } catch (err) {
            console.warn('AI models failed to load:', err.message);
        }
    }

    // ─── NAVIGATION ───
    bindNavEvents() {
        this.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const target = item.dataset.target;
                this.switchView(target);
            });
        });

        // Bind visibility toggles for secret fields
        this.bindVisibilityToggles();

        // Cloud settings save buttons
        document.getElementById('btn-save-r2')?.addEventListener('click', () => this.saveCloudR2Settings());
        document.getElementById('btn-save-gdrive')?.addEventListener('click', () => this.saveCloudDriveSettings());
        document.getElementById('btn-cloud-offload')?.addEventListener('click', () => this.triggerCloudOffload());
        document.getElementById('btn-cloud-restore')?.addEventListener('click', () => this.triggerCloudRestore());
        document.getElementById('btn-test-r2')?.addEventListener('click', () => this.testR2Connection());

        // New Gallery button — bind here so it works after DOM loads
        document.addEventListener('click', (e) => {
            if (e.target.closest('#btn-new-gallery')) {
                const form = document.getElementById('create-gallery-form');
                if (form) {
                    form.style.display = form.style.display === 'none' ? 'block' : 'none';
                    if (form.style.display === 'block') {
                        document.getElementById('new-gallery-title')?.focus();
                        if (window.lucide) lucide.createIcons({ root: form });
                    }
                }
            }

            if (e.target.closest('#btn-cancel-gallery')) {
                document.getElementById('create-gallery-form').style.display = 'none';
                document.getElementById('new-gallery-title').value = '';
                document.getElementById('new-gallery-desc').value = '';
            }

            if (e.target.closest('#btn-save-gallery')) {
                this.createGallery();
            }

            // Subscription Plan Settings Toggle
            if (e.target.closest('#btn-settings-payment')) {
                document.getElementById('btn-settings-payment').className = 'btn btn-primary';
                document.getElementById('btn-settings-subs').className = 'btn btn-ghost';
                document.getElementById('settings-payment-container').classList.remove('hidden');
                document.getElementById('settings-subs-container').classList.add('hidden');
            }
            if (e.target.closest('#btn-settings-subs')) {
                document.getElementById('btn-settings-subs').className = 'btn btn-primary';
                document.getElementById('btn-settings-payment').className = 'btn btn-ghost';
                document.getElementById('settings-subs-container').classList.remove('hidden');
                document.getElementById('settings-payment-container').classList.add('hidden');
                this.loadSubscriptionPlans();
            }

            // Subscription Plan Form
            if (e.target.closest('#btn-add-sub-plan')) {
                document.getElementById('sub-plan-form-title').textContent = 'Add Plan';
                document.getElementById('sub-plan-id').value = '';
                document.getElementById('sub-plan-name').value = '';
                document.getElementById('sub-plan-desc').value = '';
                document.getElementById('sub-plan-price-m').value = '29';
                document.getElementById('sub-plan-price-y').value = '290';
                document.getElementById('sub-plan-downloads').value = '10';
                document.getElementById('sub-plan-order').value = '0';
                document.getElementById('sub-plan-features').value = '';
                document.getElementById('sub-plan-form').style.display = 'block';
            }
            if (e.target.closest('#btn-cancel-sub-plan')) {
                document.getElementById('sub-plan-form').style.display = 'none';
            }
            if (e.target.closest('#btn-save-sub-plan')) {
                this.saveSubscriptionPlan();
            }

            // Cloud schedule toggle show/hide
            if (e.target.id === 'r2-schedule-enabled') {
                const visible = e.target.checked;
                document.getElementById('r2-cron-group').style.display = visible ? 'block' : 'none';
            }
            if (e.target.id === 'gdrive-schedule-enabled') {
                const visible = e.target.checked;
                document.getElementById('gdrive-cron-group').style.display = visible ? 'block' : 'none';
            }

            // CMS Page Builder Buttons
            if (e.target.closest('#btn-new-page')) {
                this.openPageBuilder();
            }
            if (e.target.closest('#btn-cancel-page')) {
                document.getElementById('page-builder-form').style.display = 'none';
            }
            if (e.target.closest('.btn-add-block')) {
                const btn = e.target.closest('.btn-add-block');
                this.addPageBlock(btn.dataset.type);
            }
            if (e.target.closest('#btn-save-page')) {
                this.savePage();
            }
            if (e.target.closest('.btn-remove-block')) {
                e.target.closest('.page-block-item').remove();
                this.checkEmptyBlocks();
            }
            if (e.target.closest('.btn-move-up-block')) {
                const item = e.target.closest('.page-block-item');
                if (item.previousElementSibling && item.previousElementSibling.id !== 'empty-blocks-msg') {
                    item.parentNode.insertBefore(item, item.previousElementSibling);
                }
            }
            if (e.target.closest('.btn-move-down-block')) {
                const item = e.target.closest('.page-block-item');
                if (item.nextElementSibling) {
                    item.parentNode.insertBefore(item.nextElementSibling, item);
                }
            }
        });
    }

    switchView(target) {
        this.navItems.forEach(n => n.classList.remove('active'));
        this.viewSections.forEach(v => v.classList.remove('active'));

        const activeNav = document.querySelector(`.nav-item[data-target="${target}"]`);
        const activeView = document.getElementById(`view-${target}`);

        if (activeNav) activeNav.classList.add('active');
        if (activeView) activeView.classList.add('active');

        if (this.headerTitle) {
            this.headerTitle.textContent = target.charAt(0).toUpperCase() + target.slice(1).replace(/-/g, ' ');
        }

        this.loadView(target);
    }

    async loadView(target) {
        try {
            switch (target) {
                case 'dashboard': await this.loadDashboard(); break;
                case 'upload':    await this.loadUploadForm(); break;
                case 'galleries': await this.loadGalleries(); break;
                case 'pages':     await this.loadPages(); break;
                case 'faces':     await this.loadFaceGroups(); break;
                case 'orders':    await this.loadOrders(); break;
                case 'users':     await this.loadUsers(); break;
                case 'settings':  await this.loadSettings(); break;
                case 'cloud-r2': await this.loadCloudSettings(); break;
                case 'cloud-drive': await this.loadCloudSettings(); break;
            }
        } catch (err) {
            console.error(`Error loading view [${target}]:`, err);
            this.showError(`view-${target}`, err.message);
        }
    }

    showError(containerId, message) {
        const el = document.getElementById(containerId);
        if (el) {
            el.innerHTML = `<div class="glass-panel text-center py-8" style="color: var(--accent-danger);">
                <i data-lucide="alert-triangle" style="width:32px;height:32px;margin-bottom:8px;"></i>
                <p>${message}</p>
            </div>`;
            if (window.lucide) lucide.createIcons({ root: el });
        }
    }

    async apiFetch(path, options = {}) {
        const res = await fetch(`/api${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }

    showToast(message, type = 'success') {
        if (window.utils?.showToast) {
            window.utils.showToast(message, type);
        } else {
            alert(message);
        }
    }

    // ─── DASHBOARD ───
    async loadDashboard() {
        const statsEl = document.getElementById('dashboard-stats');
        if (!statsEl) return;

        statsEl.innerHTML = '<div class="stat-card"><div class="stat-card-title">Loading...</div><div class="stat-card-value">-</div></div>';

        const data = await this.apiFetch('/admin/stats');
        const s = data.stats;

        statsEl.innerHTML = `
            <div class="stat-card">
                <div class="stat-card-title">Total Revenue</div>
                <div class="stat-card-value" style="background:var(--gradient-gold);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                    RM ${parseFloat(s.totalRevenue || 0).toFixed(2)}
                </div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">Total Orders</div>
                <div class="stat-card-value">${s.totalOrders || 0}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">Images Hosted</div>
                <div class="stat-card-value">${s.totalImages || 0}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">Active Users</div>
                <div class="stat-card-value">${s.totalUsers || 0}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">Total Downloads</div>
                <div class="stat-card-value">${s.totalDownloads || 0}</div>
            </div>
        `;
    }

    // ─── UPLOAD ───
    async loadUploadForm() {
        const select = document.getElementById('upload-gallery');
        if (!select) return;
        try {
            const data = await this.apiFetch('/galleries');
            select.innerHTML = '<option value="">-- No Gallery (Uncategorized) --</option>' +
                (data.galleries || []).map(g => `<option value="${g.id}">${g.title}</option>`).join('');
        } catch (e) {
            select.innerHTML = '<option value="">-- Error loading galleries --</option>';
        }
    }

    bindUploadEvents() {
        const dropZone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('file-input');
        if (!dropZone || !fileInput) return;

        dropZone.addEventListener('click', () => fileInput.click());

        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--accent-primary)';
            dropZone.style.background = 'rgba(124,58,237,0.06)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = 'var(--border-strong)';
            dropZone.style.background = 'transparent';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--border-strong)';
            dropZone.style.background = 'transparent';
            if (e.dataTransfer.files.length > 0) this.handleFiles(e.dataTransfer.files);
        });

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) this.handleFiles(fileInput.files);
            fileInput.value = ''; // reset so same file can be re-selected
        });
    }

    handleFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const fileId = 'f' + Date.now() + Math.random().toString(36).substr(2, 6);
            this.renderFileCard(file, fileId);
            this.processAndUpload(file, fileId);
        });
    }

    renderFileCard(file, fileId) {
        const container = document.getElementById('upload-preview');
        if (!container) return;
        const objUrl = URL.createObjectURL(file);
        container.insertAdjacentHTML('afterbegin', `
            <div class="glass-panel" id="${fileId}" style="display:flex;align-items:center;gap:16px;margin-bottom:12px;padding:12px 16px;">
                <img id="img-${fileId}" src="${objUrl}" style="width:64px;height:48px;object-fit:cover;border-radius:6px;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${file.name}</div>
                    <div id="status-${fileId}" style="font-size:0.8rem;color:var(--text-muted);">Queued...</div>
                    <div id="progress-${fileId}" style="height:3px;background:var(--border-strong);border-radius:2px;margin-top:6px;overflow:hidden;">
                        <div style="height:100%;background:var(--accent-primary);width:0%;transition:width 0.3s ease;" id="bar-${fileId}"></div>
                    </div>
                </div>
                <div id="icon-${fileId}" style="flex-shrink:0;">
                    <i data-lucide="loader-2" class="spin" style="color:var(--accent-primary);"></i>
                </div>
            </div>
        `);
        if (window.lucide) lucide.createIcons({ root: document.getElementById(fileId) });
    }

    async processAndUpload(file, fileId) {
        const statusEl = document.getElementById(`status-${fileId}`);
        const iconEl = document.getElementById(`icon-${fileId}`);
        const barEl = document.getElementById(`bar-${fileId}`);
        const imgEl = document.getElementById(`img-${fileId}`);

        const setStatus = (msg, color = 'var(--text-muted)') => {
            if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color; }
        };
        const setBar = (pct) => { if (barEl) barEl.style.width = pct + '%'; };
        const setIcon = (icon, color = 'var(--accent-primary)') => {
            if (iconEl) {
                iconEl.innerHTML = `<i data-lucide="${icon}" style="color:${color};"></i>`;
                if (window.lucide) lucide.createIcons({ root: iconEl });
            }
        };

        try {
            // Step 1: Scan faces (if AI loaded)
            let faceData = [];
            if (this.aiLoaded && imgEl) {
                setStatus('Scanning faces with AI...');
                setBar(15);
                try {
                    const scanImg = new Image();
                    scanImg.src = imgEl.src;
                    await new Promise(r => scanImg.onload = r);
                    const detections = await faceapi.detectAllFaces(scanImg)
                        .withFaceLandmarks()
                        .withFaceDescriptors();
                    faceData = detections.map(d => ({
                        descriptor: Array.from(d.descriptor),
                        bbox: { x: d.detection.box.x, y: d.detection.box.y, w: d.detection.box.width, h: d.detection.box.height },
                        confidence: d.detection.score
                    }));
                    setStatus(`Found ${faceData.length} face(s). Uploading...`);
                } catch (faceErr) {
                    setStatus('AI scan skipped. Uploading...');
                }
            } else {
                setStatus('Uploading...');
            }
            setBar(30);

            // Step 2: Build FormData
            const galleryId = document.getElementById('upload-gallery')?.value;
            const price = document.getElementById('upload-price')?.value || '10.00';

            const formData = new FormData();
            formData.append('image', file);
            formData.append('price', price);
            if (galleryId) formData.append('gallery_id', galleryId);
            if (faceData.length > 0) formData.append('faces', JSON.stringify(faceData));

            setBar(50);

            // Step 3: Upload
            const response = await fetch('/api/images/upload', {
                method: 'POST',
                body: formData
                // NOTE: Do NOT set Content-Type header — browser sets multipart boundary automatically
            });

            setBar(90);
            const result = await response.json();

            if (!response.ok) throw new Error(result.error || 'Upload failed');

            setBar(100);
            setStatus(`✓ Uploaded! ${faceData.length} face(s) saved.`, 'var(--accent-success)');
            setIcon('check-circle', 'var(--accent-success)');

        } catch (err) {
            console.error('Upload error:', err);
            setStatus(`Error: ${err.message}`, 'var(--accent-danger)');
            setIcon('alert-triangle', 'var(--accent-danger)');
        }
    }

    // ─── GALLERIES ───
    async loadGalleries() {
        const tbody = document.getElementById('galleries-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading...</td></tr>';

        const data = await this.apiFetch('/galleries?limit=100');
        const galleries = data.galleries || [];

        // Populate Parent Gallery Dropdown
        const parentSelect = document.getElementById('new-gallery-parent');
        if (parentSelect) {
            parentSelect.innerHTML = '<option value="">-- None --</option>' + 
                galleries.map(g => `<option value="${g.id}">${g.title}</option>`).join('');
        }

        if (galleries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:var(--text-muted);">No galleries yet. Click "New Gallery" to create one.</td></tr>';
            return;
        }

        tbody.innerHTML = galleries.map(g => `
            <tr>
                <td style="font-weight:600;">${g.title}</td>
                <td style="color:var(--text-muted);font-size:0.85rem;">${g.slug}</td>
                <td>${g.image_count || 0}</td>
                <td><span style="font-size:0.8rem;">${g.access_level}</span></td>
                <td><span style="font-size:0.8rem;">${g.layout_type}</span></td>
                <td>
                    <button class="btn btn-ghost" style="padding:2px 8px;border-radius:12px;font-size:0.75rem;
                        background:${g.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};
                        color:${g.is_active ? 'var(--accent-success)' : 'var(--accent-danger)'}; border:none; cursor:pointer;"
                        onclick="window.adminPanel.toggleGalleryStatus(${g.id}, ${g.is_active})">
                        ${g.is_active ? 'Active' : 'Draft'}
                    </button>
                </td>
                <td style="display:flex;gap:4px;">
                    <button class="btn btn-ghost" style="padding:4px 8px;" title="View Gallery"
                        onclick="window.open('/gallery?slug=${g.slug}','_blank')">
                        <i data-lucide="external-link" style="width:14px;"></i>
                    </button>
                    <button class="btn btn-ghost" style="padding:4px 8px;color:var(--accent-danger);" title="Delete Gallery"
                        onclick="window.adminPanel.deleteGallery(${g.id}, '${g.title.replace(/'/g, "\\'")}')">                        <i data-lucide="trash-2" style="width:14px;"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        if (window.lucide) lucide.createIcons({ root: tbody });
    }

    async toggleGalleryStatus(id, currentStatus) {
        try {
            await this.apiFetch(`/galleries/${id}`, {
                method: 'PUT',
                body: JSON.stringify({ is_active: currentStatus ? 0 : 1 })
            });
            this.showToast('Gallery status updated');
            this.loadGalleries();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async createGallery() {
        const title = document.getElementById('new-gallery-title')?.value.trim();
        if (!title) {
            this.showToast('Please enter a gallery title', 'error');
            document.getElementById('new-gallery-title')?.focus();
            return;
        }

        const saveBtn = document.getElementById('btn-save-gallery');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
            const payload = {
                title,
                description: document.getElementById('new-gallery-desc')?.value.trim() || '',
                access_level: document.getElementById('new-gallery-access')?.value || 'public',
                layout_type: document.getElementById('new-gallery-layout')?.value || 'masonry',
                parent_gallery_id: document.getElementById('new-gallery-parent')?.value || null,
                password_hash: document.getElementById('new-gallery-password')?.value || null,
                expires_at: document.getElementById('new-gallery-expires')?.value || null
            };

            await this.apiFetch('/galleries', {
                method: 'POST',
                body: JSON.stringify(payload)
            });

            this.showToast(`Gallery "${title}" created!`);

            // Reset & hide form
            document.getElementById('create-gallery-form').style.display = 'none';
            document.getElementById('new-gallery-title').value = '';
            document.getElementById('new-gallery-desc').value = '';

            // Reload table
            await this.loadGalleries();

            // Also refresh upload gallery dropdown if visible
            const uploadSelect = document.getElementById('upload-gallery');
            if (uploadSelect) this.loadUploadForm();

        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.innerHTML = '<i data-lucide="save"></i> Save Gallery';
                if (window.lucide) lucide.createIcons({ root: saveBtn });
            }
        }
    }

    async deleteGallery(id, title = '') {
        if (!confirm('Delete this gallery? Images will become uncategorized.')) return;
        try {
            await this.apiFetch(`/galleries/${id}`, { method: 'DELETE' });
            this.showToast('Gallery deleted');
            this.loadGalleries();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    // ─── PAGES (CMS) ───
    async loadPages() {
        const tbody = document.getElementById('pages-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';
        
        try {
            const data = await this.apiFetch('/pages');
            const pages = data.pages || [];
            if (pages.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No pages found.</td></tr>';
                return;
            }
            
            tbody.innerHTML = pages.map(p => `
                <tr>
                    <td style="font-weight:600;">
                        ${p.title}
                        ${p.is_homepage ? '<span class="badge badge-gold" style="margin-left:8px;font-size:0.6rem;">Homepage</span>' : ''}
                    </td>
                    <td class="text-muted">/${p.is_homepage ? '' : p.slug}</td>
                    <td>
                        <span style="padding:2px 8px;border-radius:12px;font-size:0.75rem;background:${p.is_published ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${p.is_published ? 'var(--accent-success)' : 'var(--accent-danger)'};">                            ${p.is_published ? 'Published' : 'Draft'}
                        </span>
                    </td>
                    <td class="text-muted" style="font-size:0.8rem;">${new Date(p.created_at).toLocaleDateString()}</td>
                    <td style="display:flex;gap:4px;">
                        <button class="btn btn-ghost" style="padding:4px 8px;" onclick="window.open('/page?slug=${p.slug}','_blank')" title="View">
                            <i data-lucide="external-link" style="width:14px;"></i>
                        </button>
                        <button class="btn btn-ghost" style="padding:4px 8px;" onclick="window.adminPanel.editPage(${p.id})" title="Edit">
                            <i data-lucide="edit-3" style="width:14px;"></i>
                        </button>
                        ${!p.is_homepage ? `
                        <button class="btn btn-ghost" style="padding:4px 8px;color:var(--accent-danger);" onclick="window.adminPanel.deletePage(${p.id})" title="Delete">
                            <i data-lucide="trash-2" style="width:14px;"></i>
                        </button>
                        ` : ''}
                    </td>
                </tr>
            `).join('');
            if (window.lucide) lucide.createIcons({ root: tbody });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${err.message}</td></tr>`;
        }
    }

    openPageBuilder(page = null) {
        const form = document.getElementById('page-builder-form');
        form.style.display = 'block';
        
        const container = document.getElementById('page-blocks-container');
        container.innerHTML = '<div class="text-center text-muted" id="empty-blocks-msg">No blocks added yet. Click above to add content blocks.</div>';
        
        if (page) {
            document.getElementById('page-builder-title').textContent = 'Edit Page';
            document.getElementById('edit-page-id').value = page.id;
            document.getElementById('page-title').value = page.title;
            document.getElementById('page-slug').value = page.slug;
            document.getElementById('page-published').checked = page.is_published === 1;
            document.getElementById('page-homepage').checked = page.is_homepage === 1;
            
            try {
                const layout = JSON.parse(page.layout_data || '[]');
                layout.forEach(block => this.addPageBlock(block.type, block));
            } catch (e) {
                console.error('Failed to parse layout', e);
            }
        } else {
            document.getElementById('page-builder-title').textContent = 'Create Page';
            document.getElementById('edit-page-id').value = '';
            document.getElementById('page-title').value = '';
            document.getElementById('page-slug').value = '';
            document.getElementById('page-published').checked = true;
            document.getElementById('page-homepage').checked = false;
        }
        
        this.checkEmptyBlocks();
        form.scrollIntoView({ behavior: 'smooth' });
    }

    async editPage(id) {
        try {
            const data = await this.apiFetch(`/pages/${id}`);
            if (data.page) this.openPageBuilder(data.page);
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    addPageBlock(type, data = {}) {
        const container = document.getElementById('page-blocks-container');
        const blockId = 'block-' + Date.now() + Math.random().toString(36).substr(2, 5);
        
        const wrapper = document.createElement('div');
        wrapper.className = 'page-block-item glass-panel';
        wrapper.style.padding = '12px';
        wrapper.style.position = 'relative';
        wrapper.dataset.type = type;
        
        let contentHtml = '';
        const title = type.replace('_', ' ').toUpperCase();
        
        switch (type) {
            case 'hero':
                contentHtml = `
                    <div class="form-group mb-2"><input type="text" class="form-control block-title" placeholder="Hero Title" value="${data.title || ''}"></div>
                    <div class="form-group mb-2"><input type="text" class="form-control block-subtitle" placeholder="Subtitle" value="${data.subtitle || ''}"></div>
                    <div class="form-group mb-0"><input type="text" class="form-control block-badge" placeholder="Badge text (optional)" value="${data.badge || ''}"></div>
                `;
                break;
            case 'stats':
                const items = data.items || [{value:'100+', label:'Photos'}];
                contentHtml = `
                    <div class="text-sm text-muted mb-2">Note: Stats block currently uses fixed structure in this demo.</div>
                    <textarea class="form-control block-items" rows="3" placeholder='[{"value":"100+", "label":"Items"}]'>${JSON.stringify(items)}</textarea>
                `;
                break;
            case 'gallery_grid':
                contentHtml = `
                    <div class="form-group mb-2"><input type="text" class="form-control block-title" placeholder="Grid Title" value="${data.title || 'Featured Collections'}"></div>
                    <div class="form-group mb-0"><input type="number" class="form-control block-limit" placeholder="Number of galleries to show" value="${data.limit || 6}"></div>
                `;
                break;
            case 'text':
                contentHtml = `
                    <div class="form-group mb-2"><input type="text" class="form-control block-title" placeholder="Section Title (optional)" value="${data.title || ''}"></div>
                    <div class="form-group mb-0"><textarea class="form-control block-content" rows="4" placeholder="HTML or text content...">${data.content || ''}</textarea></div>
                `;
                break;
            case 'web_banner':
                contentHtml = `
                    <div class="form-group mb-2"><input type="text" class="form-control block-title" placeholder="Banner Title" value="${data.title || ''}"></div>
                    <div class="form-group mb-2"><input type="text" class="form-control block-subtitle" placeholder="Banner Subtitle" value="${data.subtitle || ''}"></div>
                    <div class="form-group mb-2" style="display:flex;gap:8px;">
                        <input type="text" class="form-control block-image" placeholder="Background Image URL" value="${data.image_url || ''}" style="flex:1;">
                        <button class="btn btn-secondary" type="button" onclick="window.adminPanel.openMediaSelector(this.previousElementSibling)"><i data-lucide="image"></i> Select</button>
                    </div>
                    <div style="display:flex;gap:12px;margin-bottom:8px;">
                        <input type="text" class="form-control block-cta-text" placeholder="CTA Button Text" value="${data.cta_text || ''}" style="flex:1;">
                        <input type="text" class="form-control block-cta-link" placeholder="CTA Button Link" value="${data.cta_link || ''}" style="flex:1;">
                    </div>
                    <div style="display:flex;gap:12px;">
                        <select class="form-control block-align" style="flex:1;">
                            <option value="left" ${data.align === 'left' ? 'selected' : ''}>Align Left</option>
                            <option value="center" ${(!data.align || data.align === 'center') ? 'selected' : ''}>Align Center</option>
                            <option value="right" ${data.align === 'right' ? 'selected' : ''}>Align Right</option>
                        </select>
                        <select class="form-control block-overlay" style="flex:1;">
                            <option value="dark" ${(!data.overlay || data.overlay === 'dark') ? 'selected' : ''}>Dark Overlay</option>
                            <option value="light" ${data.overlay === 'light' ? 'selected' : ''}>Light Overlay</option>
                            <option value="none" ${data.overlay === 'none' ? 'selected' : ''}>No Overlay</option>
                        </select>
                    </div>
                `;
                break;
            case 'carousel':
                const slides = data.slides || [{ image_url: '', caption: '' }];
                contentHtml = `
                    <div class="text-sm text-muted mb-2">Define slides for the carousel as JSON array.</div>
                    <div style="margin-bottom:8px;">
                        <button type="button" class="btn btn-ghost btn-sm" onclick="window.adminPanel.openMediaSelector(this.nextElementSibling)"><i data-lucide="image"></i> Select Image URL to Insert</button>
                        <textarea class="form-control block-slides" rows="4" placeholder='[{"image_url":"/path/to/img.jpg", "caption":"Slide 1"}]'>${JSON.stringify(slides)}</textarea>
                    </div>
                `;
                break;
            case 'grid_row':
                const columns = data.columns || [{ content: 'Column 1' }, { content: 'Column 2' }];
                contentHtml = `
                    <div class="text-sm text-muted mb-2">Define columns as JSON array (HTML allowed in content).</div>
                    <textarea class="form-control block-columns" rows="5" placeholder='[{"content":"Column 1 text"}, {"content":"Column 2 text"}]'>${JSON.stringify(columns)}</textarea>
                `;
                break;
        }

        wrapper.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1);">
                <strong style="display:flex;align-items:center;gap:8px;">
                    <i data-lucide="grip-horizontal" style="cursor:grab;color:var(--text-muted);width:16px;"></i>
                    ${title}
                </strong>
                <div style="display:flex;gap:4px;">
                    <button class="btn btn-ghost btn-move-up-block" style="padding:2px 4px;"><i data-lucide="arrow-up" style="width:14px;"></i></button>
                    <button class="btn btn-ghost btn-move-down-block" style="padding:2px 4px;"><i data-lucide="arrow-down" style="width:14px;"></i></button>
                    <button class="btn btn-ghost btn-remove-block" style="padding:2px 4px;color:var(--accent-danger);"><i data-lucide="x" style="width:14px;"></i></button>
                </div>
            </div>
            <div class="block-fields">
                ${contentHtml}
            </div>
        `;
        
        document.getElementById('empty-blocks-msg').style.display = 'none';
        container.appendChild(wrapper);
        if (window.lucide) lucide.createIcons({ root: wrapper });
    }

    checkEmptyBlocks() {
        const container = document.getElementById('page-blocks-container');
        const items = container.querySelectorAll('.page-block-item');
        const msg = document.getElementById('empty-blocks-msg');
        if (msg) msg.style.display = items.length === 0 ? 'block' : 'none';
    }

    async savePage() {
        const title = document.getElementById('page-title').value.trim();
        if (!title) return this.showToast('Page title is required', 'error');

        const saveBtn = document.getElementById('btn-save-page');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';

        try {
            // Collect blocks
            const blocks = [];
            const items = document.querySelectorAll('.page-block-item');
            
            items.forEach(item => {
                const type = item.dataset.type;
                let blockData = { type };
                
                if (type === 'hero') {
                    blockData.title = item.querySelector('.block-title').value;
                    blockData.subtitle = item.querySelector('.block-subtitle').value;
                    blockData.badge = item.querySelector('.block-badge').value;
                } else if (type === 'stats') {
                    try { blockData.items = JSON.parse(item.querySelector('.block-items').value); } catch(e){}
                } else if (type === 'gallery_grid') {
                    blockData.title = item.querySelector('.block-title').value;
                    blockData.limit = parseInt(item.querySelector('.block-limit').value) || 6;
                } else if (type === 'text') {
                    blockData.title = item.querySelector('.block-title').value;
                    blockData.content = item.querySelector('.block-content').value;
                } else if (type === 'web_banner') {
                    blockData.title = item.querySelector('.block-title').value;
                    blockData.subtitle = item.querySelector('.block-subtitle').value;
                    blockData.image_url = item.querySelector('.block-image').value;
                    blockData.cta_text = item.querySelector('.block-cta-text').value;
                    blockData.cta_link = item.querySelector('.block-cta-link').value;
                    blockData.align = item.querySelector('.block-align').value;
                    blockData.overlay = item.querySelector('.block-overlay').value;
                } else if (type === 'carousel') {
                    try { blockData.slides = JSON.parse(item.querySelector('.block-slides').value); } catch(e){}
                } else if (type === 'grid_row') {
                    try { blockData.columns = JSON.parse(item.querySelector('.block-columns').value); } catch(e){}
                }
                
                blocks.push(blockData);
            });

            const payload = {
                title,
                slug: document.getElementById('page-slug').value.trim(),
                is_published: document.getElementById('page-published').checked,
                is_homepage: document.getElementById('page-homepage').checked,
                layout_data: blocks
            };

            const id = document.getElementById('edit-page-id').value;
            
            if (id) {
                await this.apiFetch(`/pages/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                this.showToast('Page updated successfully');
            } else {
                await this.apiFetch('/pages', { method: 'POST', body: JSON.stringify(payload) });
                this.showToast('Page created successfully');
            }

            document.getElementById('page-builder-form').style.display = 'none';
            this.loadPages();

        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i data-lucide="save"></i> Save Page';
            if (window.lucide) lucide.createIcons({ root: saveBtn });
        }
    }

    async deletePage(id) {
        if (!confirm('Are you sure you want to delete this page?')) return;
        try {
            await this.apiFetch(`/pages/${id}`, { method: 'DELETE' });
            this.showToast('Page deleted');
            this.loadPages();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    // ─── PERSON TAGGING ───
    bindFaceTabEvents() {
        const btnPending = document.getElementById('btn-tab-ungrouped');
        const btnPeople = document.getElementById('btn-tab-people');
        const contPending = document.getElementById('faces-pending-container');
        const contPeople = document.getElementById('faces-people-container');

        if (!btnPending) return;

        btnPending.addEventListener('click', () => {
            btnPending.className = 'btn btn-primary';
            btnPeople.className = 'btn btn-ghost';
            contPending.classList.remove('hidden');
            contPeople.classList.add('hidden');
            this.loadFaceGroups();
        });

        btnPeople.addEventListener('click', () => {
            btnPeople.className = 'btn btn-primary';
            btnPending.className = 'btn btn-ghost';
            contPeople.classList.remove('hidden');
            contPending.classList.add('hidden');
            this.loadPeopleList();
        });
    }

    async loadFaceGroups() {
        const grid = document.getElementById('face-groups-grid');
        if (!grid) return;
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:48px;"><i data-lucide="loader-2" class="spin" style="width:32px;height:32px;color:var(--accent-primary);"></i><br><span class="text-muted" style="margin-top:8px;display:block;">Loading face clusters...</span></div>';
        if (window.lucide) lucide.createIcons({ root: grid });

        try {
            const data = await this.apiFetch('/face/groups?threshold=0.55');
            const groups = data.groups || [];

            if (groups.length === 0) {
                grid.innerHTML = '<div class="glass-panel text-center py-12" style="grid-column:1/-1;"><i data-lucide="scan-face" style="width:48px;height:48px;color:var(--text-muted);margin-bottom:12px;"></i><h4>No faces detected yet</h4><p class="text-muted">Upload images with people to see face clusters here.</p></div>';
                if (window.lucide) lucide.createIcons({ root: grid });
                return;
            }

            // Save groups to a property for modal access
            this.currentFaceGroups = groups;

            grid.innerHTML = groups.map((group, idx) => {
                // Show face crops instead of full images
                const previews = group.slice(0, 4).map(f =>
                    `<img src="/api/face/${f.faceId}/crop" style="width:100%;aspect-ratio:1;object-fit:cover;" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\'><rect fill=\\'%23333\\'/></svg>'">`
                ).join('');

                return `
                    <div class="face-group-card" id="group-${idx}">
                        <div class="face-preview-grid">${previews}</div>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                            <span style="font-weight:600;">${group.length} Similar Faces</span>
                            <span style="font-size:0.75rem;color:var(--text-muted);">Cluster #${idx + 1}</span>
                        </div>
                        <div style="display:flex; gap:8px;">
                            <button class="btn btn-primary" style="flex:1;" onclick="window.adminPanel.openClusterModal(${idx})">Review & Tag</button>
                            <button class="btn btn-ghost" style="color:var(--accent-danger); border-color:var(--accent-danger); padding:8px 12px;" onclick="window.adminPanel.deleteCluster(${idx})" title="Delete Cluster"><i data-lucide="trash-2" style="width:16px;height:16px;"></i></button>
                        </div>
                    </div>
                `;
            }).join('');
            if (window.lucide) lucide.createIcons({ root: grid });

        } catch (err) {
            grid.innerHTML = `<div class="glass-panel text-center py-8" style="grid-column:1/-1;color:var(--accent-danger);">${err.message}</div>`;
        }
    }

    async deleteCluster(idx) {
        const group = this.currentFaceGroups?.[idx];
        if (!group) return;

        if (!confirm(`Are you sure you want to delete this cluster? This will remove these face descriptors from being clustered.`)) return;

        const faceIds = group.map(f => f.faceId);

        try {
            await this.apiFetch('/face/delete-group', {
                method: 'POST',
                body: JSON.stringify({ faceIds })
            });

            this.showToast('Cluster deleted');
            await this.loadFaceGroups();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async openClusterModal(idx) {
        const group = this.currentFaceGroups?.[idx];
        if (!group) return;

        const modal = document.getElementById('cluster-modal');
        const grid = document.getElementById('cluster-faces-grid');
        const input = document.getElementById('cluster-modal-input');
        const submitBtn = document.getElementById('btn-cluster-tag');
        const mergeSelect = document.getElementById('cluster-merge-select');
        const mergeBtn = document.getElementById('btn-cluster-merge');

        if (!modal || !grid || !input || !submitBtn) return;

        input.value = '';
        input.disabled = false;
        submitBtn.disabled = false;

        // Populate merge dropdown with existing people
        if (mergeSelect) {
            try {
                const data = await this.apiFetch('/face/people');
                const people = data.people || [];
                mergeSelect.innerHTML = '<option value="">-- Select existing person --</option>' +
                    people.map(p => `<option value="${p.id}">${p.name} (${p.face_count || 0} faces)</option>`).join('');
            } catch (e) {
                mergeSelect.innerHTML = '<option value="">-- No people found --</option>';
            }
        }

        // Render each face crop in the group modal
        grid.innerHTML = group.map((face, fIdx) => {
            return `
                <div style="position:relative; background:rgba(0,0,0,0.3); border-radius:8px; overflow:hidden; padding:4px; border:1px solid var(--border-subtle); display:flex; flex-direction:column; align-items:center;">
                    <img src="/api/face/${face.faceId}/crop" style="width:100%; aspect-ratio:1; object-fit:cover; border-radius:4px; margin-bottom:4px;">
                    <label style="display:flex; align-items:center; gap:4px; font-size:0.75rem; color:var(--text-secondary); width:100%; justify-content:center; cursor:pointer;">
                        <input type="checkbox" class="face-checkbox" data-face-id="${face.faceId}" checked>
                        Select
                    </label>
                </div>
            `;
        }).join('');

        modal.style.display = 'flex';
        if (window.lucide) lucide.createIcons({ root: modal });

        // Helper: get selected face IDs
        const getSelectedIds = () => {
            const checkboxes = grid.querySelectorAll('.face-checkbox:checked');
            return Array.from(checkboxes).map(cb => parseInt(cb.dataset.faceId));
        };

        // Rebind submit action (tag as new person)
        submitBtn.onclick = async () => {
            const selectedFaceIds = getSelectedIds();
            const personName = input.value.trim();

            if (selectedFaceIds.length === 0) {
                this.showToast('Please select at least one face to tag', 'error');
                return;
            }
            if (!personName) {
                this.showToast('Please enter a person name', 'error');
                return;
            }

            input.disabled = true;
            submitBtn.disabled = true;
            submitBtn.textContent = 'Tagging...';

            try {
                const personRes = await this.apiFetch('/face/people', {
                    method: 'POST',
                    body: JSON.stringify({ name: personName })
                });
                await this.apiFetch('/face/tag-group', {
                    method: 'POST',
                    body: JSON.stringify({ faceIds: selectedFaceIds, personId: personRes.id })
                });

                this.showToast(`Tagged ${selectedFaceIds.length} faces as "${personName}"`);
                modal.style.display = 'none';
                await this.loadFaceGroups();
            } catch (err) {
                this.showToast(err.message, 'error');
                input.disabled = false;
                submitBtn.disabled = false;
                submitBtn.textContent = 'Tag Selected';
            }
        };

        // Merge to existing person
        if (mergeBtn) {
            mergeBtn.onclick = async () => {
                const selectedFaceIds = getSelectedIds();
                const personId = mergeSelect?.value;

                if (selectedFaceIds.length === 0) {
                    this.showToast('Please select at least one face to merge', 'error');
                    return;
                }
                if (!personId) {
                    this.showToast('Please select a person to merge into', 'error');
                    return;
                }

                mergeBtn.disabled = true;
                mergeBtn.textContent = 'Merging...';

                try {
                    await this.apiFetch('/face/tag-group', {
                        method: 'POST',
                        body: JSON.stringify({ faceIds: selectedFaceIds, personId: parseInt(personId) })
                    });

                    const personName = mergeSelect.options[mergeSelect.selectedIndex].text;
                    this.showToast(`Merged ${selectedFaceIds.length} faces into "${personName}"`);
                    modal.style.display = 'none';
                    await this.loadFaceGroups();
                } catch (err) {
                    this.showToast(err.message, 'error');
                    mergeBtn.disabled = false;
                    mergeBtn.textContent = 'Merge';
                }
            };
        }
    }

    async loadPeopleList() {
        const tbody = document.getElementById('people-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="3" class="text-center">Loading...</td></tr>';
        try {
            const data = await this.apiFetch('/face/people');
            const people = data.people || [];
            if (people.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center" style="color:var(--text-muted);">No people tagged yet.</td></tr>';
                return;
            }
            tbody.innerHTML = people.map(p => `
                <tr>
                    <td style="font-weight:600;display:flex;align-items:center;gap:12px;">
                        <div style="width:36px;height:36px;border-radius:50%;background:var(--bg-elevated);display:flex;align-items:center;justify-content:center;font-size:0.75rem;color:var(--accent-primary);">
                            ${p.name.charAt(0).toUpperCase()}
                        </div>
                        ${p.name}
                    </td>
                    <td>${p.face_count || 0} faces</td>
                    <td>
                        <a href="/search?q=${encodeURIComponent(p.name)}" target="_blank" class="btn btn-ghost" style="padding:4px 8px;font-size:0.8rem;">
                            <i data-lucide="search" style="width:14px;"></i> View Photos
                        </a>
                    </td>
                </tr>
            `).join('');
            if (window.lucide) lucide.createIcons({ root: tbody });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="3" class="text-center" style="color:var(--accent-danger);">${err.message}</td></tr>`;
        }
    }

    // ─── ORDERS ───
    async loadOrders() {
        const tbody = document.getElementById('orders-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">Loading...</td></tr>';
        const data = await this.apiFetch('/admin/orders');
        const orders = data.orders || [];
        if (orders.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:var(--text-muted);">No orders yet.</td></tr>';
            return;
        }
        tbody.innerHTML = orders.map(o => {
            const statusColor = o.status === 'paid' || o.status === 'completed'
                ? 'var(--accent-success)' : 'var(--accent-tertiary)';
            return `
                <tr>
                    <td style="font-weight:600;">${o.order_number}</td>
                    <td>${o.username}<br><span style="font-size:0.75rem;color:var(--text-muted);">${o.email}</span></td>
                    <td>RM ${parseFloat(o.total_amount || 0).toFixed(2)}</td>
                    <td><span style="padding:2px 8px;border-radius:12px;font-size:0.75rem;background:rgba(0,0,0,0.3);color:${statusColor};">${o.status.toUpperCase()}</span></td>
                    <td style="font-size:0.8rem;color:var(--text-muted);">${new Date(o.created_at).toLocaleDateString('en-MY')}</td>
                </tr>
            `;
        }).join('');
    }

    // ─── USERS ───
    async loadUsers() {
        const tbody = document.getElementById('users-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading...</td></tr>';
        const data = await this.apiFetch('/admin/users');
        const users = data.users || [];
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-muted);">No users found.</td></tr>';
            return;
        }
        tbody.innerHTML = users.map(u => `
            <tr>
                <td style="font-weight:600;">${u.full_name || u.username}</td>
                <td>${u.email}</td>
                <td>
                    <span style="padding:2px 8px;border-radius:12px;font-size:0.75rem;background:${u.role === 'admin' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)'};color:${u.role === 'admin' ? 'var(--accent-tertiary)' : 'var(--text-secondary)'};">
                        ${u.role.toUpperCase()}
                    </span>
                </td>
                <td>${u.order_count || 0}</td>
                <td style="font-size:0.8rem;color:var(--text-muted);">${new Date(u.created_at).toLocaleDateString('en-MY')}</td>
                <td>
                    <button class="btn btn-ghost" style="padding:4px 8px;" onclick="window.adminPanel.showUserDetail(${u.id})" title="View Details">
                        <i data-lucide="eye" style="width:14px;"></i>
                    </button>
                </td>
            </tr>
        `).join('');
        if (window.lucide) lucide.createIcons({ root: tbody });
    }

    async showUserDetail(id) {
        try {
            const data = await this.apiFetch(`/admin/users/${id}`);
            const { user, orders } = data;

            document.getElementById('user-detail-name').textContent = user.full_name || user.username;
            document.getElementById('user-detail-email').textContent = user.email;
            document.getElementById('user-detail-role').textContent = user.role;
            document.getElementById('user-detail-joined').textContent = new Date(user.created_at).toLocaleDateString();

            if (user.plan_name) {
                document.getElementById('user-detail-plan').textContent = user.plan_name;
                const limit = user.downloads_per_month === -1 ? 'Unlimited' : user.downloads_per_month;
                document.getElementById('user-detail-downloads').textContent = `${user.downloads_used_this_cycle || 0} / ${limit}`;
                document.getElementById('user-detail-expiry').textContent = user.subscription_expiry ? new Date(user.subscription_expiry).toLocaleDateString() : 'Never';
            } else {
                document.getElementById('user-detail-plan').textContent = 'No active plan';
                document.getElementById('user-detail-downloads').textContent = '-';
                document.getElementById('user-detail-expiry').textContent = '-';
            }

            const ordersTbody = document.getElementById('user-detail-orders');
            if (orders.length === 0) {
                ordersTbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">No orders found.</td></tr>';
            } else {
                ordersTbody.innerHTML = orders.map(o => `
                    <tr>
                        <td>${o.order_number}</td>
                        <td>RM ${o.total_amount}</td>
                        <td>
                            <span style="padding:2px 8px;border-radius:12px;font-size:0.75rem;background:${o.status === 'paid' ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)'};color:${o.status === 'paid' ? 'var(--accent-success)' : 'var(--text-secondary)'};">
                                ${o.status.toUpperCase()}
                            </span>
                        </td>
                        <td style="font-size:0.8rem;color:var(--text-muted);">${new Date(o.created_at).toLocaleDateString()}</td>
                    </tr>
                `).join('');
            }

            document.getElementById('user-detail-modal').style.display = 'flex';
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    // ─── SETTINGS ───
    async loadSettings() {
        // Load both tabs simultaneously
        await Promise.all([
            this.loadPaymentGateways(),
            this.loadSubscriptionPlans()
        ]);
    }

    // Gateway icons mapping
    gatewayIcon(name) {
        const icons = { toyyibpay: '🇲🇾', billplz: '💳', chip: '💰', bcl: '🏦', stripe: '⚡' };
        return icons[name] || '🔌';
    }

    async loadPaymentGateways() {
        const container = document.getElementById('payment-gateways-list');
        if (!container) return;
        container.innerHTML = '<div class="text-center py-8"><i data-lucide="loader-2" class="spin"></i> Loading gateways...</div>';
        try {
            const data = await this.apiFetch('/admin/payment-settings');
            const gateways = data.gateways || [];
            if (!gateways.length) {
                container.innerHTML = '<p class="text-muted text-center py-6">No gateways configured.</p>';
                return;
            }
            container.innerHTML = gateways.map(gw => {
                const extra = (() => { try { return JSON.parse(gw.extra_config || '{}'); } catch(e) { return {}; } })();
                const extraFields = Object.entries(extra).map(([k, v]) => `
                    <div class="form-group">
                        <label class="form-label" style="text-transform:capitalize;">${k.replace(/_/g, ' ')}</label>
                        <input type="text" class="form-control gw-extra-${gw.gateway_name}" data-key="${k}" value="${v || ''}" placeholder="${k.replace(/_/g, ' ')}">
                    </div>`).join('');
                return `
                <div class="glass-panel mb-4" style="border:1px solid ${gw.is_active ? 'var(--accent-primary)' : 'var(--border-subtle)'}; border-radius:12px; padding:20px;" id="gw-panel-${gw.gateway_name}">
                    <div class="flex justify-between items-center mb-4">
                        <div class="flex items-center gap-3">
                            <span style="font-size:1.5rem;">${this.gatewayIcon(gw.gateway_name)}</span>
                            <div>
                                <h5 style="margin:0;">${gw.display_name}</h5>
                                <span style="font-size:0.75rem; padding:2px 8px; border-radius:12px; background:${gw.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(100,116,139,0.15)'}; color:${gw.is_active ? 'var(--accent-success)' : 'var(--text-muted)'};">${gw.is_active ? '✓ Active' : 'Inactive'}</span>
                            </div>
                        </div>
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                            <span style="font-size:0.85rem;color:var(--text-muted);">Activate</span>
                            <input type="checkbox" class="gw-active-toggle" data-gateway="${gw.gateway_name}" ${gw.is_active ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;">
                        </label>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                        <div class="form-group">
                            <label class="form-label">API Key / User Code</label>
                            <input type="password" class="form-control" id="gw-apikey-${gw.gateway_name}" value="${gw.api_key || ''}" placeholder="API Key">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Secret Key / Token</label>
                            <input type="password" class="form-control" id="gw-secret-${gw.gateway_name}" value="${gw.secret_key || ''}" placeholder="Secret Key">
                        </div>
                        ${extraFields}
                        <div class="form-group">
                            <label class="form-label">Mode</label>
                            <select class="form-control" id="gw-sandbox-${gw.gateway_name}">
                                <option value="1" ${gw.is_sandbox ? 'selected' : ''}>Sandbox / Test</option>
                                <option value="0" ${!gw.is_sandbox ? 'selected' : ''}>Production / Live</option>
                            </select>
                        </div>
                    </div>
                    <div class="flex gap-3 mt-4">
                        <button class="btn btn-primary" onclick="window.adminPanel.saveGatewaySettings('${gw.gateway_name}')">
                            <i data-lucide="save" style="width:14px;"></i> Save Settings
                        </button>
                        <button class="btn btn-ghost" onclick="window.adminPanel.testGatewayConnection('${gw.gateway_name}')">
                            <i data-lucide="zap" style="width:14px;"></i> Test Connection
                        </button>
                    </div>
                </div>`;
            }).join('');
            if (window.lucide) lucide.createIcons({ root: container });

            // Bind activate toggles
            container.querySelectorAll('.gw-active-toggle').forEach(toggle => {
                toggle.addEventListener('change', () => {
                    this.saveGatewaySettings(toggle.dataset.gateway, { forceActive: toggle.checked });
                });
            });
        } catch (err) {
            container.innerHTML = `<p class="text-danger text-center py-6">Failed to load gateways: ${err.message}</p>`;
        }
    }

    async saveGatewaySettings(gatewayName, opts = {}) {
        const apiKey   = document.getElementById(`gw-apikey-${gatewayName}`)?.value || '';
        const secret   = document.getElementById(`gw-secret-${gatewayName}`)?.value || '';
        const sandbox  = document.getElementById(`gw-sandbox-${gatewayName}`)?.value === '1';
        const isActive = opts.forceActive !== undefined ? opts.forceActive :
                         document.querySelector(`.gw-active-toggle[data-gateway="${gatewayName}"]`)?.checked || false;

        // Collect extra config fields
        const extra = {};
        document.querySelectorAll(`.gw-extra-${gatewayName}`).forEach(el => {
            extra[el.dataset.key] = el.value;
        });

        try {
            await this.apiFetch(`/admin/payment-settings/${gatewayName}`, {
                method: 'PUT',
                body: JSON.stringify({ api_key: apiKey, secret_key: secret, extra_config: extra, is_sandbox: sandbox, is_active: isActive })
            });
            this.showToast(`${gatewayName} settings saved!`);
            // Refresh to reflect active state border changes
            await this.loadPaymentGateways();
        } catch (err) {
            this.showToast(`Failed to save: ${err.message}`, 'error');
        }
    }

    async testGatewayConnection(gatewayName) {
        this.showToast(`Testing ${gatewayName} connection... (sandbox ping not yet implemented)`, 'info');
    }


    async loadSubscriptionPlans() {
        const tbody = document.getElementById('sub-plans-tbody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">Loading...</td></tr>';
        
        try {
            const data = await this.apiFetch('/admin/subscription-plans');
            const plans = data.plans || [];
            if (plans.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No subscription plans found.</td></tr>';
                return;
            }
            tbody.innerHTML = plans.map(p => `
                <tr>
                    <td style="font-weight:600;">${p.name}<br><span style="font-size:0.75rem;color:var(--text-muted);">${p.description || ''}</span></td>
                    <td>RM ${p.price_monthly}</td>
                    <td>RM ${p.price_yearly || '-'}</td>
                    <td>${p.downloads_per_month === -1 ? 'Unlimited' : p.downloads_per_month}</td>
                    <td>
                        <span style="padding:2px 8px;border-radius:12px;font-size:0.75rem;background:${p.is_active ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${p.is_active ? 'var(--accent-success)' : 'var(--accent-danger)'};">
                            ${p.is_active ? 'Active' : 'Inactive'}
                        </span>
                    </td>
                    <td style="display:flex;gap:4px;">
                        <button class="btn btn-ghost" style="padding:4px 8px;" onclick="window.adminPanel.editSubscriptionPlan(${p.id})" title="Edit">
                            <i data-lucide="edit-3" style="width:14px;"></i>
                        </button>
                        <button class="btn btn-ghost" style="padding:4px 8px;color:var(--accent-danger);" onclick="window.adminPanel.deleteSubscriptionPlan(${p.id})" title="Delete">
                            <i data-lucide="trash-2" style="width:14px;"></i>
                        </button>
                    </td>
                </tr>
            `).join('');
            if (window.lucide) lucide.createIcons({ root: tbody });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">${err.message}</td></tr>`;
        }
    }

    async editSubscriptionPlan(id) {
        try {
            const data = await this.apiFetch('/admin/subscription-plans');
            const plan = data.plans.find(p => p.id === id);
            if (!plan) return;

            document.getElementById('sub-plan-form-title').textContent = 'Edit Plan';
            document.getElementById('sub-plan-id').value = plan.id;
            document.getElementById('sub-plan-name').value = plan.name;
            document.getElementById('sub-plan-desc').value = plan.description || '';
            document.getElementById('sub-plan-price-m').value = plan.price_monthly;
            document.getElementById('sub-plan-price-y').value = plan.price_yearly || '';
            document.getElementById('sub-plan-downloads').value = plan.downloads_per_month;
            document.getElementById('sub-plan-order').value = plan.sort_order || 0;
            
            const featuresStr = Array.isArray(plan.features) ? plan.features.join('\\n') : '';
            document.getElementById('sub-plan-features').value = featuresStr;

            document.getElementById('sub-plan-form').style.display = 'block';
            document.getElementById('sub-plan-form').scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async deleteSubscriptionPlan(id) {
        if (!confirm('Are you sure you want to delete this subscription plan?')) return;
        try {
            await this.apiFetch(`/admin/subscription-plans/${id}`, { method: 'DELETE' });
            this.showToast('Plan deleted successfully');
            this.loadSubscriptionPlans();
        } catch (err) {
            this.showToast(err.message, 'error');
        }
    }

    async saveSubscriptionPlan() {
        const id = document.getElementById('sub-plan-id').value;
        const name = document.getElementById('sub-plan-name').value.trim();
        if (!name) return this.showToast('Plan Name is required', 'error');

        const payload = {
            name,
            description: document.getElementById('sub-plan-desc').value.trim(),
            price_monthly: parseFloat(document.getElementById('sub-plan-price-m').value) || 0,
            price_yearly: parseFloat(document.getElementById('sub-plan-price-y').value) || null,
            downloads_per_month: parseInt(document.getElementById('sub-plan-downloads').value) || 0,
            sort_order: parseInt(document.getElementById('sub-plan-order').value) || 0,
            features: document.getElementById('sub-plan-features').value.split('\\n').map(f => f.trim()).filter(f => f),
            is_active: 1
        };

        const btn = document.getElementById('btn-save-sub-plan');
        if (btn) btn.disabled = true;

        try {
            if (id) {
                await this.apiFetch(`/admin/subscription-plans/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
                this.showToast('Plan updated successfully');
            } else {
                await this.apiFetch('/admin/subscription-plans', { method: 'POST', body: JSON.stringify(payload) });
                this.showToast('Plan created successfully');
            }
            document.getElementById('sub-plan-form').style.display = 'none';
            this.loadSubscriptionPlans();
        } catch (err) {
            this.showToast(err.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ─── CLOUD SETTINGS ───
    bindVisibilityToggles() {
        document.querySelectorAll('.toggle-visibility').forEach(el => {
            el.addEventListener('click', () => {
                const targetId = el.dataset.target;
                const input = document.getElementById(targetId);
                if (input) {
                    if (input.type === 'password') {
                        input.type = 'text';
                        el.textContent = '🙈';
                    } else {
                        input.type = 'password';
                        el.textContent = '👁️';
                    }
                }
            });
        });
    }

    async loadCloudSettings() {
        try {
            const data = await this.apiFetch('/admin/settings');
            const s = data.settings || {};

            // R2 Settings fields
            const r2AccountId = document.getElementById('r2-account-id');
            const r2AccessKey = document.getElementById('r2-access-key');
            const r2SecretKey = document.getElementById('r2-secret-key');
            const r2Bucket = document.getElementById('r2-bucket');
            const r2PublicUrl = document.getElementById('r2-public-url');
            const r2SchedEnabled = document.getElementById('r2-schedule-enabled');
            const r2Cron = document.getElementById('r2-cron');
            const r2CronGroup = document.getElementById('r2-cron-group');

            if (r2AccountId) r2AccountId.value = s.r2_accountId || '';
            if (r2AccessKey) r2AccessKey.value = s.r2_accessKeyId || '';
            if (r2SecretKey) r2SecretKey.value = s.r2_secretAccessKey || '';
            if (r2Bucket) r2Bucket.value = s.r2_bucketName || '';
            if (r2PublicUrl) r2PublicUrl.value = s.r2_publicBucketUrl || '';
            if (r2SchedEnabled) {
                r2SchedEnabled.checked = s.cloud_schedule_enabled === '1';
                if (r2CronGroup) r2CronGroup.style.display = r2SchedEnabled.checked ? 'block' : 'none';
            }
            if (r2Cron) r2Cron.value = s.cloud_schedule_cron || '* * * * *';

            // Google Drive settings fields
            const gdriveClientId = document.getElementById('gdrive-client-id');
            const gdriveClientSecret = document.getElementById('gdrive-client-secret');
            const gdriveRefreshToken = document.getElementById('gdrive-refresh-token');
            const gdriveFolderId = document.getElementById('gdrive-folder-id');
            const gdriveBackupEnabled = document.getElementById('gdrive-backup-enabled');

            if (gdriveClientId) gdriveClientId.value = s.gdrive_clientId || '';
            if (gdriveClientSecret) gdriveClientSecret.value = s.gdrive_clientSecret || '';
            if (gdriveRefreshToken) gdriveRefreshToken.value = s.gdrive_refreshToken || '';
            if (gdriveFolderId) gdriveFolderId.value = s.gdrive_backupFolderId || '';
            if (gdriveBackupEnabled) gdriveBackupEnabled.checked = s.gdrive_backup_enabled === '1';

        } catch (err) {
            this.showToast('Failed to load cloud settings: ' + err.message, 'error');
        }
    }

    async saveCloudR2Settings() {
        const saveBtn = document.getElementById('btn-save-r2');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
            const payload = {
                r2_accountId: document.getElementById('r2-account-id')?.value.trim() || '',
                r2_accessKeyId: document.getElementById('r2-access-key')?.value.trim() || '',
                r2_secretAccessKey: document.getElementById('r2-secret-key')?.value.trim() || '',
                r2_bucketName: document.getElementById('r2-bucket')?.value.trim() || '',
                r2_publicBucketUrl: document.getElementById('r2-public-url')?.value.trim() || '',
                cloud_schedule_enabled: document.getElementById('r2-schedule-enabled')?.checked ? '1' : '0',
                cloud_schedule_cron: document.getElementById('r2-cron')?.value.trim() || '* * * * *'
            };

            // Save settings in system_settings
            await this.apiFetch('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            // Update scheduler settings in backend
            await this.apiFetch('/admin/cloud/schedule', {
                method: 'POST',
                body: JSON.stringify({
                    cron: payload.cloud_schedule_cron,
                    enabled: payload.cloud_schedule_enabled === '1'
                })
            });

            this.showToast('Cloudflare R2 settings saved successfully!');
            // Reset connection status since credentials changed
            this._setR2ConnStatus('unknown');
        } catch (err) {
            this.showToast('Failed to save R2 settings: ' + err.message, 'error');
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Settings'; }
        }
    }

    _setR2ConnStatus(state) {
        const dot = document.getElementById('r2-conn-dot');
        const label = document.getElementById('r2-conn-label');
        if (!dot || !label) return;
        const states = {
            unknown:  { color: '#666',   text: 'Unknown' },
            testing:  { color: '#f59e0b', text: 'Testing...' },
            ok:       { color: '#10b981', text: 'Connected' },
            error:    { color: '#ef4444', text: 'Failed' }
        };
        const s = states[state] || states.unknown;
        dot.style.background = s.color;
        label.textContent = s.text;
    }

    async testR2Connection() {
        const btn = document.getElementById('btn-test-r2');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Testing...'; }
        this._setR2ConnStatus('testing');
        try {
            const data = await this.apiFetch('/admin/cloud/test-r2', { method: 'POST' });
            this._setR2ConnStatus('ok');
            this.showToast(data.message || 'R2 connection successful!', 'success');
        } catch (err) {
            this._setR2ConnStatus('error');
            this.showToast('R2 connection failed: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🔌 Test Connection'; }
        }
    }

    async saveCloudDriveSettings() {
        const saveBtn = document.getElementById('btn-save-gdrive');
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

        try {
            const payload = {
                gdrive_clientId: document.getElementById('gdrive-client-id')?.value.trim() || '',
                gdrive_clientSecret: document.getElementById('gdrive-client-secret')?.value.trim() || '',
                gdrive_refreshToken: document.getElementById('gdrive-refresh-token')?.value.trim() || '',
                gdrive_backupFolderId: document.getElementById('gdrive-folder-id')?.value.trim() || '',
                gdrive_backup_enabled: document.getElementById('gdrive-backup-enabled')?.checked ? '1' : '0'
            };

            await this.apiFetch('/admin/settings', {
                method: 'PUT',
                body: JSON.stringify(payload)
            });

            this.showToast('Google Drive settings saved successfully!');
        } catch (err) {
            this.showToast('Failed to save Google Drive settings: ' + err.message, 'error');
        } finally {
            if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Settings'; }
        }
    }

    async triggerCloudOffload() {
        const btn = document.getElementById('btn-cloud-offload');
        const statusEl = document.getElementById('cloud-op-status');
        if (btn) btn.disabled = true;

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(255,255,255,0.05)';
            statusEl.style.color = 'var(--text-secondary)';
            statusEl.textContent = 'Starting offload to cloud storage...';
        }

        try {
            const data = await this.apiFetch('/admin/cloud/offload', { method: 'POST' });
            if (statusEl) {
                statusEl.style.background = 'rgba(16,185,129,0.15)';
                statusEl.style.color = 'var(--accent-success)';
                statusEl.textContent = data.message || 'Offload completed successfully!';
            }
            this.showToast('Cloud offload completed!');
        } catch (err) {
            if (statusEl) {
                statusEl.style.background = 'rgba(239,68,68,0.15)';
                statusEl.style.color = 'var(--accent-danger)';
                statusEl.textContent = 'Offload failed: ' + err.message;
            }
            this.showToast('Offload failed: ' + err.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async triggerCloudRestore() {
        const btn = document.getElementById('btn-cloud-restore');
        const statusEl = document.getElementById('cloud-op-status');
        if (btn) btn.disabled = true;

        if (statusEl) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(255,255,255,0.05)';
            statusEl.style.color = 'var(--text-secondary)';
            statusEl.textContent = 'Starting restore from cloud to local storage...';
        }

        try {
            const data = await this.apiFetch('/admin/cloud/restore', { method: 'POST' });
            if (statusEl) {
                statusEl.style.background = 'rgba(16,185,129,0.15)';
                statusEl.style.color = 'var(--accent-success)';
                statusEl.textContent = data.message || 'Restore completed successfully!';
            }
            this.showToast('Cloud restore completed!');
        } catch (err) {
            if (statusEl) {
                statusEl.style.background = 'rgba(239,68,68,0.15)';
                statusEl.style.color = 'var(--accent-danger)';
                statusEl.textContent = 'Restore failed: ' + err.message;
            }
            this.showToast('Restore failed: ' + err.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ─── MEDIA SELECTOR ───
    openMediaSelector(targetInput) {
        this.mediaTargetInput = targetInput;
        document.getElementById('media-modal').style.display = 'flex';
        this.loadMediaGrid();
    }

    async loadMediaGrid() {
        const grid = document.getElementById('media-grid');
        grid.innerHTML = '<div class="text-center w-full py-12" style="grid-column: 1/-1;"><i data-lucide="loader-2" class="spin"></i> Loading media...</div>';
        if (window.lucide) lucide.createIcons({ root: grid });

        try {
            const data = await this.apiFetch('/images?limit=50');
            const images = data.images || [];

            if (images.length === 0) {
                grid.innerHTML = '<div class="text-center w-full py-12 text-muted" style="grid-column: 1/-1;">No images found. Upload a new one.</div>';
                return;
            }

            grid.innerHTML = images.map(img => `
                <div class="glass-panel" style="padding:4px; cursor:pointer; transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" onclick="window.adminPanel.selectMedia('/uploads/${img.filename}')">
                    <img src="/uploads/${img.filename}" style="width:100%; aspect-ratio:1; object-fit:cover; border-radius:4px;">
                </div>
            `).join('');
        } catch (err) {
            grid.innerHTML = `<div class="text-center w-full py-12 text-danger" style="grid-column: 1/-1;">Error loading images: ${err.message}</div>`;
        }
    }

    selectMedia(url) {
        if (this.mediaTargetInput) {
            if (this.mediaTargetInput.tagName === 'TEXTAREA') {
                // If it's a textarea, assume it's the carousel JSON. We will append the image URL to the current JSON array or create a new array.
                try {
                    let currentData = JSON.parse(this.mediaTargetInput.value || '[]');
                    if (!Array.isArray(currentData)) currentData = [];
                    currentData.push({ image_url: url, caption: '' });
                    this.mediaTargetInput.value = JSON.stringify(currentData, null, 2);
                } catch(e) {
                    this.mediaTargetInput.value = `[\n  {\n    "image_url": "${url}",\n    "caption": ""\n  }\n]`;
                }
            } else {
                this.mediaTargetInput.value = url;
            }
        }
        document.getElementById('media-modal').style.display = 'none';
        this.showToast('Image selected!');
    }

    async uploadMedia(files) {
        if (!files || files.length === 0) return;
        const file = files[0];
        
        try {
            const formData = new FormData();
            formData.append('image', file);
            
            this.showToast('Uploading image...', 'info');
            
            const res = await fetch('/api/images/upload', {
                method: 'POST',
                body: formData
            });
            const result = await res.json();
            
            if (!res.ok) throw new Error(result.error || 'Upload failed');
            
            this.showToast('Upload successful!');
            this.loadMediaGrid(); // Reload the grid to show new image
            
        } catch(err) {
            this.showToast('Upload failed: ' + err.message, 'error');
        }
    }
}

// Boot admin panel
document.addEventListener('DOMContentLoaded', () => {
    window.adminPanel = new AdminPanel();
    window.adminPanel.init();
});
