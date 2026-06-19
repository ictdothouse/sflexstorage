const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const ImageProcessor = require('../services/imageProcessor');
const ExifExtractor = require('../services/exifExtractor');

module.exports = function(db) {
    const imageProcessor = new ImageProcessor({
        watermarkText: db.prepare("SELECT value FROM system_settings WHERE key = 'watermark_text'").get()?.value || 'PhotoVault',
        watermarkOpacity: parseFloat(db.prepare("SELECT value FROM system_settings WHERE key = 'watermark_opacity'").get()?.value || '0.4')
    });
    const exifExtractor = new ExifExtractor();

    // ─── LIST GALLERIES (Public) ───
    router.get('/', (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 24;
            const offset = (page - 1) * limit;
            const sort = req.query.sort || 'newest';
            const parent = req.query.parent || null;

            let orderBy = 'g.created_at DESC';
            if (sort === 'oldest') orderBy = 'g.created_at ASC';
            if (sort === 'alpha') orderBy = 'g.title ASC';
            if (sort === 'custom') orderBy = 'g.sort_order ASC';

            let whereClause = "g.is_active = 1 AND g.access_level = 'public'";
            const params = [];

            if (parent === 'root' || parent === null) {
                whereClause += ' AND g.parent_gallery_id IS NULL';
            } else if (parent) {
                whereClause += ' AND g.parent_gallery_id = ?';
                params.push(parent);
            }

            // Check expiration
            whereClause += " AND (g.expires_at IS NULL OR g.expires_at > datetime('now'))";

            const total = db.prepare(`SELECT COUNT(*) as count FROM galleries g WHERE ${whereClause}`).get(...params);
            const galleries = db.prepare(`
                SELECT g.*,
                    (SELECT COUNT(*) FROM images WHERE gallery_id = g.id AND is_active = 1) as image_count,
                    (SELECT thumbnail_path FROM images WHERE gallery_id = g.id AND is_active = 1 ORDER BY sort_order LIMIT 1) as first_image,
                    (SELECT COUNT(*) FROM galleries WHERE parent_gallery_id = g.id AND is_active = 1) as sub_gallery_count
                FROM galleries g
                WHERE ${whereClause}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);

            res.json({
                galleries,
                pagination: {
                    page, limit,
                    total: total.count,
                    totalPages: Math.ceil(total.count / limit)
                }
            });
        } catch (error) {
            console.error('List galleries error:', error);
            res.status(500).json({ error: 'Failed to fetch galleries.' });
        }
    });

    // ─── GET SINGLE GALLERY BY SLUG ───
    router.get('/:slug', (req, res) => {
        try {
            const gallery = db.prepare(`
                SELECT g.*,
                    (SELECT COUNT(*) FROM images WHERE gallery_id = g.id AND is_active = 1) as image_count
                FROM galleries g
                WHERE g.slug = ? AND g.is_active = 1
            `).get(req.params.slug);

            if (!gallery) return res.status(404).json({ error: 'Gallery not found.' });

            // Check access
            if (gallery.access_level === 'private' && !req.session.userId) {
                return res.status(401).json({ error: 'Login required to view this gallery.' });
            }
            if (gallery.access_level === 'password') {
                const providedPassword = req.query.password || req.headers['x-gallery-password'];
                if (!providedPassword) {
                    return res.status(403).json({ error: 'Password required.', requiresPassword: true });
                }
                // Simple password check
                if (gallery.password_hash && gallery.password_hash !== providedPassword) {
                    return res.status(403).json({ error: 'Incorrect password.' });
                }
            }

            // Check expiration
            if (gallery.expires_at && new Date(gallery.expires_at) < new Date()) {
                return res.status(410).json({ error: 'This gallery has expired.' });
            }

            // Get images with pagination
            const page = parseInt(req.query.page) || 1;
            const limit = gallery.images_per_page || 24;
            const offset = (page - 1) * limit;
            const sort = req.query.sort || 'custom';

            let orderBy = 'i.sort_order ASC, i.uploaded_at DESC';
            if (sort === 'newest') orderBy = 'i.uploaded_at DESC';
            if (sort === 'oldest') orderBy = 'i.uploaded_at ASC';
            if (sort === 'alpha') orderBy = 'i.title ASC';
            if (sort === 'popular') orderBy = 'i.view_count DESC';

            const images = db.prepare(`
                SELECT i.id, i.filename, i.title, i.description, i.tags,
                       i.thumbnail_path, i.preview_path, i.width, i.height,
                       i.price, i.license_type, i.view_count, i.download_count,
                       i.uploaded_at
                FROM images i
                WHERE i.gallery_id = ? AND i.is_active = 1
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
            `).all(gallery.id, limit, offset);

            // Get sub-galleries
            const subGalleries = db.prepare(`
                SELECT g.*,
                    (SELECT COUNT(*) FROM images WHERE gallery_id = g.id AND is_active = 1) as image_count,
                    (SELECT thumbnail_path FROM images WHERE gallery_id = g.id AND is_active = 1 ORDER BY sort_order LIMIT 1) as first_image
                FROM galleries g
                WHERE g.parent_gallery_id = ? AND g.is_active = 1
                ORDER BY g.sort_order ASC
            `).all(gallery.id);

            // Add favorite status if logged in
            if (req.session.userId) {
                const favIds = db.prepare('SELECT image_id FROM favorites WHERE user_id = ?').all(req.session.userId)
                    .map(f => f.image_id);
                for (const img of images) {
                    img.is_favorited = favIds.includes(img.id);
                }
            }

            res.json({
                gallery,
                images,
                subGalleries,
                pagination: {
                    page, limit,
                    total: gallery.image_count,
                    totalPages: Math.ceil(gallery.image_count / limit)
                }
            });
        } catch (error) {
            console.error('Get gallery error:', error);
            res.status(500).json({ error: 'Failed to fetch gallery.' });
        }
    });

    // ─── CREATE GALLERY (Admin) ───
    router.post('/', requireAdmin, (req, res) => {
        try {
            const { title, description, access_level, parent_gallery_id, layout_type, columns, pagination_style, images_per_page, expires_at, password_hash } = req.body;
            if (!title) return res.status(400).json({ error: 'Title is required.' });

            // Generate slug
            let slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const existing = db.prepare('SELECT id FROM galleries WHERE slug = ?').get(slug);
            if (existing) slug = `${slug}-${Date.now()}`;

            const result = db.prepare(`
                INSERT INTO galleries (title, description, slug, access_level, parent_gallery_id, layout_type, columns, pagination_style, images_per_page, expires_at, password_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                title, description || '', slug,
                access_level || 'public',
                parent_gallery_id || null,
                layout_type || 'masonry',
                columns || 4,
                pagination_style || 'load_more',
                images_per_page || 24,
                expires_at || null,
                password_hash || null
            );

            const gallery = db.prepare('SELECT * FROM galleries WHERE id = ?').get(result.lastInsertRowid);
            res.status(201).json({ success: true, gallery });
        } catch (error) {
            console.error('Create gallery error:', error);
            res.status(500).json({ error: 'Failed to create gallery.' });
        }
    });

    // ─── UPDATE GALLERY (Admin) ───
    router.put('/:id', requireAdmin, (req, res) => {
        try {
            const { title, description, access_level, layout_type, columns, pagination_style, images_per_page, sort_order, is_active, expires_at, parent_gallery_id } = req.body;
            const gallery = db.prepare('SELECT * FROM galleries WHERE id = ?').get(req.params.id);
            if (!gallery) return res.status(404).json({ error: 'Gallery not found.' });

            db.prepare(`
                UPDATE galleries SET
                    title = COALESCE(?, title),
                    description = COALESCE(?, description),
                    access_level = COALESCE(?, access_level),
                    layout_type = COALESCE(?, layout_type),
                    columns = COALESCE(?, columns),
                    pagination_style = COALESCE(?, pagination_style),
                    images_per_page = COALESCE(?, images_per_page),
                    sort_order = COALESCE(?, sort_order),
                    is_active = COALESCE(?, is_active),
                    expires_at = COALESCE(?, expires_at),
                    parent_gallery_id = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(
                title || null, description !== undefined ? description : null,
                access_level || null, layout_type || null,
                columns || null, pagination_style || null,
                images_per_page || null, sort_order !== undefined ? sort_order : null,
                is_active !== undefined ? is_active : null,
                expires_at !== undefined ? expires_at : null,
                parent_gallery_id !== undefined ? parent_gallery_id : gallery.parent_gallery_id,
                req.params.id
            );

            const updated = db.prepare('SELECT * FROM galleries WHERE id = ?').get(req.params.id);
            res.json({ success: true, gallery: updated });
        } catch (error) {
            console.error('Update gallery error:', error);
            res.status(500).json({ error: 'Failed to update gallery.' });
        }
    });

    // ─── DELETE GALLERY (Admin) ───
    router.delete('/:id', requireAdmin, (req, res) => {
        try {
            const gallery = db.prepare('SELECT * FROM galleries WHERE id = ?').get(req.params.id);
            if (!gallery) return res.status(404).json({ error: 'Gallery not found.' });

            // Soft delete
            db.prepare("UPDATE galleries SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
            res.json({ success: true, message: 'Gallery deleted.' });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete gallery.' });
        }
    });

    // ─── UPLOAD IMAGES TO GALLERY (Admin) ───
    router.post('/:id/images', requireAdmin, async (req, res) => {
        try {
            const gallery = db.prepare('SELECT * FROM galleries WHERE id = ?').get(req.params.id);
            if (!gallery) return res.status(404).json({ error: 'Gallery not found.' });

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No files uploaded.' });
            }

            const results = [];
            const maxSort = db.prepare('SELECT MAX(sort_order) as max FROM images WHERE gallery_id = ?').get(gallery.id);
            let sortOrder = (maxSort?.max || 0) + 1;

            for (const file of req.files) {
                try {
                    const originalPath = `original/${file.filename}`;
                    const fullPath = path.join(__dirname, '..', 'uploads', originalPath);

                    // Process image (thumbnail + watermarked preview)
                    const processed = await imageProcessor.processImage(fullPath, file.filename);

                    // Extract EXIF metadata
                    const exif = await exifExtractor.extract(fullPath);

                    // Extract tags/keywords from EXIF automatically
                    let autoTags = '';
                    if (exif.all_exif && exif.all_exif.Keywords) {
                        autoTags = Array.isArray(exif.all_exif.Keywords) ? exif.all_exif.Keywords.join(', ') : String(exif.all_exif.Keywords);
                    } else if (exif.all_exif && exif.all_exif.Subject) {
                        autoTags = Array.isArray(exif.all_exif.Subject) ? exif.all_exif.Subject.join(', ') : String(exif.all_exif.Subject);
                    }

                    // Insert image record
                    const title = path.parse(file.originalname).name.replace(/[-_]/g, ' ');
                    const imgResult = db.prepare(`
                        INSERT INTO images (gallery_id, filename, original_filename, original_path, thumbnail_path, preview_path,
                            title, tags, width, height, file_size, format, price, sort_order)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        gallery.id, file.filename, file.originalname,
                        originalPath, processed.thumbnail, processed.preview,
                        title, autoTags, processed.width, processed.height,
                        processed.size, processed.format,
                        parseFloat(db.prepare("SELECT value FROM system_settings WHERE key = 'default_image_price'").get()?.value || '10'),
                        sortOrder++
                    );

                    // Insert EXIF metadata
                    db.prepare(`
                        INSERT INTO image_metadata (image_id, camera_make, camera_model, lens, focal_length, aperture,
                            shutter_speed, iso, white_balance, flash, color_space, orientation,
                            gps_latitude, gps_longitude, gps_altitude, date_taken, software, copyright, all_exif)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        imgResult.lastInsertRowid,
                        exif.camera_make, exif.camera_model, exif.lens,
                        exif.focal_length, exif.aperture, exif.shutter_speed,
                        exif.iso, exif.white_balance, exif.flash,
                        exif.color_space, exif.orientation,
                        exif.gps_latitude, exif.gps_longitude, exif.gps_altitude,
                        exif.date_taken, exif.software, exif.copyright,
                        JSON.stringify(exif.all_exif)
                    );

                    results.push({
                        id: imgResult.lastInsertRowid,
                        filename: file.filename,
                        original: file.originalname,
                        thumbnail: processed.thumbnail,
                        preview: processed.preview,
                        width: processed.width,
                        height: processed.height,
                        exif: { camera: exif.camera_model, lens: exif.lens, date: exif.date_taken }
                    });
                } catch (imgError) {
                    console.error(`Error processing ${file.originalname}:`, imgError.message);
                    results.push({ filename: file.originalname, error: imgError.message });
                }
            }

            res.status(201).json({ success: true, uploaded: results.length, images: results });
        } catch (error) {
            console.error('Upload error:', error);
            res.status(500).json({ error: 'Upload failed.' });
        }
    });

    // ─── UPDATE GALLERY LAYOUT (Admin) ───
    router.put('/:id/layout', requireAdmin, (req, res) => {
        try {
            const { layout_type, columns, pagination_style, images_per_page, show_image_info } = req.body;
            db.prepare(`
                UPDATE galleries SET
                    layout_type = COALESCE(?, layout_type),
                    columns = COALESCE(?, columns),
                    pagination_style = COALESCE(?, pagination_style),
                    images_per_page = COALESCE(?, images_per_page),
                    show_image_info = COALESCE(?, show_image_info),
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(layout_type || null, columns || null, pagination_style || null, images_per_page || null, show_image_info !== undefined ? show_image_info : null, req.params.id);

            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to update layout.' });
        }
    });

    return router;
};
