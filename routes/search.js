const express = require('express');
const router = express.Router();

module.exports = function(db) {

    // ─── SEARCH IMAGES ───
    router.get('/', (req, res) => {
        try {
            const q = req.query.q || '';
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 24;
            const offset = (page - 1) * limit;
            const sort = req.query.sort || 'relevance';
            const gallery_id = req.query.gallery_id;
            const min_price = req.query.min_price;
            const max_price = req.query.max_price;
            const license = req.query.license;
            const orientation = req.query.orientation;

            let whereClauses = ["i.is_active = 1", "g.is_active = 1", "g.access_level = 'public'"];
            let params = [];

            // Text search across title, description, tags, filename, camera model, and person names
            if (q) {
                whereClauses.push(`(
                    i.title LIKE ? OR i.description LIKE ? OR i.tags LIKE ?
                    OR i.original_filename LIKE ?
                    OR im.camera_model LIKE ?
                    OR p.name LIKE ?
                )`);
                const searchTerm = `%${q}%`;
                params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
            }

            if (gallery_id) {
                whereClauses.push('i.gallery_id = ?');
                params.push(gallery_id);
            }

            if (min_price) {
                whereClauses.push('i.price >= ?');
                params.push(parseFloat(min_price));
            }

            if (max_price) {
                whereClauses.push('i.price <= ?');
                params.push(parseFloat(max_price));
            }

            if (license) {
                whereClauses.push('i.license_type = ?');
                params.push(license);
            }

            if (orientation === 'landscape') {
                whereClauses.push('i.width > i.height');
            } else if (orientation === 'portrait') {
                whereClauses.push('i.height > i.width');
            } else if (orientation === 'square') {
                whereClauses.push('ABS(i.width - i.height) < (i.width * 0.1)');
            }

            const whereSQL = whereClauses.join(' AND ');

            let orderBy = 'i.view_count DESC, i.uploaded_at DESC'; // relevance = popularity
            if (sort === 'newest') orderBy = 'i.uploaded_at DESC';
            if (sort === 'oldest') orderBy = 'i.uploaded_at ASC';
            if (sort === 'price_low') orderBy = 'i.price ASC';
            if (sort === 'price_high') orderBy = 'i.price DESC';
            if (sort === 'popular') orderBy = 'i.download_count DESC';

            const total = db.prepare(`
                SELECT COUNT(DISTINCT i.id) as count
                FROM images i
                LEFT JOIN galleries g ON i.gallery_id = g.id
                LEFT JOIN image_metadata im ON i.id = im.image_id
                LEFT JOIN face_descriptors fd ON i.id = fd.image_id
                LEFT JOIN people p ON fd.person_id = p.id
                WHERE ${whereSQL}
            `).get(...params);

            const images = db.prepare(`
                SELECT DISTINCT i.id, i.title, i.description, i.tags, i.thumbnail_path, i.preview_path,
                       i.width, i.height, i.price, i.license_type, i.view_count, i.download_count,
                       i.uploaded_at, g.title as gallery_title, g.slug as gallery_slug,
                       im.camera_model
                FROM images i
                LEFT JOIN galleries g ON i.gallery_id = g.id
                LEFT JOIN image_metadata im ON i.id = im.image_id
                LEFT JOIN face_descriptors fd ON i.id = fd.image_id
                LEFT JOIN people p ON fd.person_id = p.id
                WHERE ${whereSQL}
                ORDER BY ${orderBy}
                LIMIT ? OFFSET ?
            `).all(...params, limit, offset);

            // Add favorite status
            if (req.session.userId) {
                const favIds = db.prepare('SELECT image_id FROM favorites WHERE user_id = ?')
                    .all(req.session.userId).map(f => f.image_id);
                for (const img of images) {
                    img.is_favorited = favIds.includes(img.id);
                }
            }

            // Get available filters
            const galleries = db.prepare(`
                SELECT DISTINCT g.id, g.title, g.slug
                FROM galleries g
                JOIN images i ON i.gallery_id = g.id
                WHERE g.is_active = 1 AND g.access_level = 'public' AND i.is_active = 1
                ORDER BY g.title
            `).all();

            res.json({
                query: q,
                images,
                filters: {
                    galleries,
                    orientations: ['landscape', 'portrait', 'square'],
                    licenses: ['standard', 'extended', 'editorial']
                },
                pagination: {
                    page, limit,
                    total: total.count,
                    totalPages: Math.ceil(total.count / limit)
                }
            });
        } catch (error) {
            console.error('Search error:', error);
            res.status(500).json({ error: 'Search failed.' });
        }
    });

    // ─── SEARCH SUGGESTIONS ───
    router.get('/suggest', (req, res) => {
        try {
            const q = req.query.q || '';
            if (q.length < 2) return res.json({ suggestions: [] });

            // Get matching tags and titles
            const images = db.prepare(`
                SELECT DISTINCT title FROM images
                WHERE title LIKE ? AND is_active = 1
                LIMIT 10
            `).all(`%${q}%`);

            const suggestions = images.map(i => i.title);
            res.json({ suggestions });
        } catch (error) {
            res.status(500).json({ suggestions: [] });
        }
    });

    return router;
};
