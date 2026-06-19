const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { upload } = require('../middleware/upload');
const ImageProcessor = require('../services/imageProcessor');
const EXIFExtractor = require('../services/exifExtractor');
const FaceService = require('../services/faceService');
const backgroundQueue = require('../services/backgroundQueue');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

module.exports = function(db) {
    const imageProcessor = new ImageProcessor();
    const exifExtractor = new EXIFExtractor();
    const faceService = new FaceService(db);

    // ─── UPLOAD IMAGE (Admin) ───
    router.post('/upload', requireAdmin, upload.single('image'), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided.' });
        }
        try {
            const { title, description, gallery_id, price, license_type, faces } = req.body;

            // 1. Process Image — returns { thumbnail, preview, width, height, format, size }
            const processed = await imageProcessor.processImage(req.file.path, req.file.filename);

            // 2. Extract EXIF
            const exifData = await exifExtractor.extract(req.file.path);

            // 3. Save to Database (gallery_id can be NULL)
            const result = db.prepare(`
                INSERT INTO images (
                    gallery_id, title, description, filename, original_filename,
                    original_path, thumbnail_path, preview_path,
                    format, width, height, price, license_type, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            `).run(
                gallery_id ? parseInt(gallery_id) : null,
                title || req.file.originalname,
                description || '',
                req.file.filename,
                req.file.originalname,
                `original/${req.file.filename}`,
                processed.thumbnail,
                processed.preview,
                processed.format,
                processed.width,
                processed.height,
                parseFloat(price) || 10.00,
                license_type || 'standard'
            );

            const imageId = result.lastInsertRowid;

            // 4. Save EXIF if available
            if (exifData && Object.keys(exifData).length > 0) {
                try {
                    db.prepare(`
                        INSERT OR IGNORE INTO image_metadata (
                            image_id, camera_make, camera_model, lens,
                            focal_length, aperture, shutter_speed, iso
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `).run(
                        imageId,
                        exifData.camera_make || '',
                        exifData.camera_model || '',
                        exifData.lens || '',
                        exifData.focal_length || '',
                        exifData.aperture || '',
                        exifData.shutter_speed || '',
                        exifData.iso || ''
                    );
                    
                    db.prepare('UPDATE image_metadata SET all_exif = ? WHERE image_id = ?').run(
                        JSON.stringify(exifData.all_exif || {}), imageId
                    );
                } catch (exifErr) {
                    console.warn('EXIF save warning:', exifErr.message);
                }
            }

            // 5. Store Face Descriptors if provided by client-side AI
            if (faces) {
                try {
                    const parsedFaces = JSON.parse(faces);
                    if (Array.isArray(parsedFaces) && parsedFaces.length > 0) {
                        const faceStmt = db.prepare(`
                            INSERT INTO face_descriptors (image_id, descriptor, bbox_x, bbox_y, bbox_w, bbox_h, confidence)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `);
                        for (const face of parsedFaces) {
                            faceStmt.run(
                                imageId,
                                JSON.stringify(face.descriptor),
                                face.bbox?.x || 0,
                                face.bbox?.y || 0,
                                face.bbox?.w || 0,
                                face.bbox?.h || 0,
                                face.confidence || 0
                            );
                        }
                        console.log(`✅ Stored ${parsedFaces.length} faces for image ${imageId}`);
                    }
                } catch (faceErr) {
                    console.error('Face storage error:', faceErr.message);
                }
            }

            // 6. Update gallery image count if gallery provided
            if (gallery_id) {
                db.prepare('UPDATE galleries SET image_count = COALESCE(image_count, 0) + 1 WHERE id = ?')
                    .run(parseInt(gallery_id));
            }

            // Enqueue AI analysis for the new image (ultra‑lite background processing)
            backgroundQueue.enqueue(imageId);
            res.status(201).json({
                success: true,
                imageId,
                title: title || req.file.originalname,
                faceCount: faces ? JSON.parse(faces).length : 0
            });

        } catch (error) {
            console.error('Upload error:', error);
            // Clean up uploaded file if DB insert failed
            if (req.file && req.file.path) {
                try { require('fs').unlinkSync(req.file.path); } catch(e) {}
            }
            res.status(500).json({ error: `Upload failed: ${error.message}` });
        }
    });

    // ─── GET IMAGE DETAIL ───
    router.get('/:id', (req, res) => {
        try {
            const image = db.prepare(`
                SELECT i.*, g.title as gallery_title, g.slug as gallery_slug
                FROM images i
                LEFT JOIN galleries g ON i.gallery_id = g.id
                WHERE i.id = ? AND i.is_active = 1
            `).get(req.params.id);

            if (!image) return res.status(404).json({ error: 'Image not found.' });

            // Increment view count
            db.prepare('UPDATE images SET view_count = view_count + 1 WHERE id = ?').run(image.id);

            // Get EXIF metadata
            const metadata = db.prepare('SELECT * FROM image_metadata WHERE image_id = ?').get(image.id);

            // Get comments
            const comments = db.prepare(`
                SELECT c.*, u.username, u.avatar
                FROM comments c
                JOIN users u ON c.user_id = u.id
                WHERE c.image_id = ? AND c.is_approved = 1
                ORDER BY c.created_at DESC
            `).all(image.id);

            // Check if user has purchased this image
            let purchased = false;
            let isFavorited = false;
            if (req.session.userId) {
                const download = db.prepare(`
                    SELECT id FROM downloads WHERE user_id = ? AND image_id = ?
                `).get(req.session.userId, image.id);
                purchased = !!download;

                // Check active subscription with remaining downloads
                if (!purchased) {
                    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
                    if (user.subscription_plan_id) {
                        const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(user.subscription_plan_id);
                        if (plan && (plan.downloads_per_month === -1 || user.downloads_used_this_cycle < plan.downloads_per_month)) {
                            if (!user.subscription_expiry || new Date(user.subscription_expiry) > new Date()) {
                                purchased = true; // Has active subscription with available downloads
                            }
                        }
                    }
                }

                const fav = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND image_id = ?').get(req.session.userId, image.id);
                isFavorited = !!fav;
            }

            // Related images from same gallery
            const related = db.prepare(`
                SELECT id, title, thumbnail_path, price
                FROM images
                WHERE gallery_id = ? AND id != ? AND is_active = 1
                ORDER BY RANDOM() LIMIT 6
            `).all(image.gallery_id, image.id);

            res.json({
                image: {
                    ...image,
                    purchased,
                    is_favorited: isFavorited
                },
                isAdmin: req.session.userRole === 'admin',
                metadata: metadata || {},
                comments,
                related
            });
        } catch (error) {
            console.error('Get image error:', error);
            res.status(500).json({ error: 'Failed to fetch image.' });
        }
    });

// ─── GET SIMILAR IMAGES ───
router.get('/:id/similar', (req, res) => {
    try {
        const target = db.prepare('SELECT phash FROM images WHERE id = ?').get(req.params.id);
        if (!target || !target.phash) return res.json({ similar: [] });
        const candidates = db.prepare('SELECT id, title, thumbnail_path, phash FROM images WHERE id != ? AND phash IS NOT NULL').all(req.params.id);
        const hamming = (a, b) => {
            const binA = BigInt('0x' + a).toString(2).padStart(64, '0');
            const binB = BigInt('0x' + b).toString(2).padStart(64, '0');
            let dist = 0;
            for (let i = 0; i < binA.length; i++) {
                if (binA[i] !== binB[i]) dist++;
            }
            return dist;
        };
        const similar = candidates
            .map(c => ({ ...c, distance: hamming(target.phash, c.phash) }))
            .filter(c => c.distance <= 8)
            .sort((a, b) => a.distance - b.distance)
            .map(c => ({ id: c.id, title: c.title, thumbnail: c.thumbnail_path, distance: c.distance }));
        res.json({ similar });
    } catch (err) {
        console.error('Similar images error:', err);
        res.status(500).json({ error: 'Failed to fetch similar images' });
    }
});

    // ─── UPDATE IMAGE (Admin) ───
    router.put('/:id', requireAdmin, (req, res) => {
        try {
            const { title, description, camera_make, camera_model, lens, focal_length, aperture, shutter_speed, iso } = req.body;
            
            db.prepare('UPDATE images SET title = ?, description = ? WHERE id = ?').run(title || '', description || '', req.params.id);
            
            db.prepare(`
                UPDATE image_metadata 
                SET camera_make = ?, camera_model = ?, lens = ?, focal_length = ?, aperture = ?, shutter_speed = ?, iso = ?
                WHERE image_id = ?
            `).run(
                camera_make || '', camera_model || '', lens || '',
                focal_length || '', aperture || '', shutter_speed || '', iso || '',
                req.params.id
            );
            
            res.json({ success: true });
        } catch (error) {
            console.error('Update image error:', error);
            res.status(500).json({ error: 'Failed to update image details.' });
        }
    });

    // ─── SERVE THUMBNAIL (Public) ───
    router.get('/:id/thumbnail', (req, res) => {
        try {
            const image = db.prepare('SELECT thumbnail_path FROM images WHERE id = ? AND is_active = 1').get(req.params.id);
            if (!image || !image.thumbnail_path) return res.status(404).send('Not found');
            const filePath = path.join(UPLOADS_DIR, image.thumbnail_path);
            if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
            res.set({
                'Cache-Control': 'public, max-age=86400',
                'Content-Type': 'image/jpeg'
            });
            res.sendFile(filePath);
        } catch (error) {
            res.status(500).send('Error');
        }
    });

    // ─── SERVE PREVIEW / WATERMARKED (Public) ───
    router.get('/:id/preview', (req, res) => {
        try {
            const image = db.prepare('SELECT preview_path FROM images WHERE id = ? AND is_active = 1').get(req.params.id);
            if (!image || !image.preview_path) return res.status(404).send('Not found');
            const filePath = path.join(UPLOADS_DIR, image.preview_path);
            if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
            res.set({
                'Cache-Control': 'public, max-age=3600',
                'Content-Type': 'image/jpeg',
                'X-Content-Type-Options': 'nosniff'
            });
            res.sendFile(filePath);
        } catch (error) {
            res.status(500).send('Error');
        }
    });

    // ─── DOWNLOAD ORIGINAL (Auth + Purchased Only) ───
    router.get('/:id/original', requireAuth, (req, res) => {
        try {
            const image = db.prepare('SELECT * FROM images WHERE id = ? AND is_active = 1').get(req.params.id);
            if (!image) return res.status(404).json({ error: 'Image not found.' });

            // Check if user has purchased or has active subscription
            const download = db.prepare('SELECT id FROM downloads WHERE user_id = ? AND image_id = ?')
                .get(req.session.userId, image.id);

            let canDownload = !!download;

            if (!canDownload) {
                const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
                if (user.subscription_plan_id) {
                    const plan = db.prepare('SELECT * FROM subscription_plans WHERE id = ?').get(user.subscription_plan_id);
                    if (plan && user.subscription_expiry && new Date(user.subscription_expiry) > new Date()) {
                        if (plan.downloads_per_month === -1 || user.downloads_used_this_cycle < plan.downloads_per_month) {
                            canDownload = true;
                            // Record download and increment counter
                            db.prepare('INSERT INTO downloads (user_id, image_id, subscription_id) VALUES (?, ?, ?)').run(req.session.userId, image.id, user.subscription_plan_id);
                            db.prepare('UPDATE users SET downloads_used_this_cycle = downloads_used_this_cycle + 1 WHERE id = ?').run(req.session.userId);
                            db.prepare('UPDATE images SET download_count = download_count + 1 WHERE id = ?').run(image.id);
                        }
                    }
                }

                // Admin always can download
                if (req.session.userRole === 'admin') canDownload = true;
            }

            if (!canDownload) {
                return res.status(403).json({ error: 'You need to purchase this image or have an active subscription.' });
            }

            const filePath = path.join(UPLOADS_DIR, image.original_path);
            if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Original file not found.' });

            res.set({
                'Content-Disposition': `attachment; filename="${image.original_filename}"`,
                'Content-Type': `image/${image.format || 'jpeg'}`,
                'X-Content-Type-Options': 'nosniff'
            });
            res.sendFile(filePath);
        } catch (error) {
            console.error('Download original error:', error);
            res.status(500).json({ error: 'Download failed.' });
        }
    });

    // ─── TOGGLE FAVORITE ───
    router.post('/:id/favorite', requireAuth, (req, res) => {
        try {
            const imageId = req.params.id;
            const existing = db.prepare('SELECT id FROM favorites WHERE user_id = ? AND image_id = ?')
                .get(req.session.userId, imageId);

            if (existing) {
                db.prepare('DELETE FROM favorites WHERE id = ?').run(existing.id);
                res.json({ success: true, favorited: false });
            } else {
                db.prepare('INSERT INTO favorites (user_id, image_id) VALUES (?, ?)').run(req.session.userId, imageId);
                res.json({ success: true, favorited: true });
            }
        } catch (error) {
            res.status(500).json({ error: 'Failed to toggle favorite.' });
        }
    });

    // ─── ADD COMMENT ───
    router.post('/:id/comment', requireAuth, (req, res) => {
        try {
            const { content } = req.body;
            if (!content || !content.trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });

            db.prepare('INSERT INTO comments (image_id, user_id, content) VALUES (?, ?, ?)').run(
                req.params.id, req.session.userId, content.trim()
            );
            res.status(201).json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to add comment.' });
        }
    });

    // ─── UPDATE IMAGE (Admin) ───
    router.put('/:id', requireAdmin, (req, res) => {
        try {
            const { title, description, tags, price, license_type, sort_order, is_active, gallery_id, camera_make, camera_model, lens, focal_length, aperture, shutter_speed } = req.body;
            
            db.transaction(() => {
                db.prepare(`
                    UPDATE images SET
                        title = COALESCE(?, title),
                        description = COALESCE(?, description),
                        tags = COALESCE(?, tags),
                        price = COALESCE(?, price),
                        license_type = COALESCE(?, license_type),
                        sort_order = COALESCE(?, sort_order),
                        is_active = COALESCE(?, is_active),
                        gallery_id = COALESCE(?, gallery_id),
                        updated_at = datetime('now')
                    WHERE id = ?
                `).run(
                    title || null, description !== undefined ? description : null,
                    tags !== undefined ? tags : null, price !== undefined ? price : null,
                    license_type || null, sort_order !== undefined ? sort_order : null,
                    is_active !== undefined ? is_active : null,
                    gallery_id || null,
                    req.params.id
                );

                // Update EXIF metadata if any of the fields were provided
                if (camera_make !== undefined || camera_model !== undefined || lens !== undefined || focal_length !== undefined || aperture !== undefined || shutter_speed !== undefined) {
                    db.prepare(`
                        UPDATE image_metadata SET
                            camera_make = COALESCE(?, camera_make),
                            camera_model = COALESCE(?, camera_model),
                            lens = COALESCE(?, lens),
                            focal_length = COALESCE(?, focal_length),
                            aperture = COALESCE(?, aperture),
                            shutter_speed = COALESCE(?, shutter_speed)
                        WHERE image_id = ?
                    `).run(
                        camera_make !== undefined ? camera_make : null,
                        camera_model !== undefined ? camera_model : null,
                        lens !== undefined ? lens : null,
                        focal_length !== undefined ? focal_length : null,
                        aperture !== undefined ? aperture : null,
                        shutter_speed !== undefined ? shutter_speed : null,
                        req.params.id
                    );
                }
            })();

            const updated = db.prepare('SELECT * FROM images WHERE id = ?').get(req.params.id);
            res.json({ success: true, image: updated });
        } catch (error) {
            console.error('Update image error:', error);
            res.status(500).json({ error: 'Failed to update image.' });
        }
    });

    // ─── DELETE IMAGE (Admin) ───
    router.delete('/:id', requireAdmin, (req, res) => {
        try {
            db.prepare("UPDATE images SET is_active = 0, updated_at = datetime('now') WHERE id = ?").run(req.params.id);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete image.' });
        }
    });

    return router;
};
