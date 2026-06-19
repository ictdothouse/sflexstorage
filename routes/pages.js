const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');

module.exports = function(db) {
    // ─── GET ALL PAGES (Admin) ───
    router.get('/', requireAdmin, (req, res) => {
        try {
            const pages = db.prepare(`
                SELECT id, slug, title, is_published, is_homepage, created_at, updated_at
                FROM pages
                ORDER BY is_homepage DESC, title ASC
            `).all();
            res.json({ success: true, pages });
        } catch (error) {
            console.error('Error fetching pages:', error);
            res.status(500).json({ error: 'Failed to fetch pages.' });
        }
    });

    // ─── GET SINGLE PAGE PUBLIC (By Slug) ───
    router.get('/public/:slug', (req, res) => {
        try {
            const slug = req.params.slug;
            const isHomepage = slug === 'home' || slug === '';
            
            let query = 'SELECT * FROM pages WHERE is_published = 1 AND ';
            let params = [];
            
            if (isHomepage) {
                query += 'is_homepage = 1 LIMIT 1';
            } else {
                query += 'slug = ? LIMIT 1';
                params.push(slug);
            }
            
            const page = db.prepare(query).get(...params);
            
            if (!page) {
                return res.status(404).json({ error: 'Page not found.' });
            }
            
            res.json({ success: true, page });
        } catch (error) {
            console.error('Error fetching public page:', error);
            res.status(500).json({ error: 'Failed to fetch page.' });
        }
    });

    // ─── GET SINGLE PAGE (Admin) ───
    router.get('/:id', requireAdmin, (req, res) => {
        try {
            const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
            if (!page) return res.status(404).json({ error: 'Page not found.' });
            res.json({ success: true, page });
        } catch (error) {
            console.error('Error fetching page:', error);
            res.status(500).json({ error: 'Failed to fetch page details.' });
        }
    });

    // ─── CREATE NEW PAGE (Admin) ───
    router.post('/', requireAdmin, (req, res) => {
        try {
            const { title, slug, is_published, is_homepage } = req.body;
            if (!title) return res.status(400).json({ error: 'Title is required.' });

            let finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            
            // Check if slug exists
            const existing = db.prepare('SELECT id FROM pages WHERE slug = ?').get(finalSlug);
            if (existing) finalSlug = `${finalSlug}-${Date.now()}`;

            // If this is set as homepage, unset others
            if (is_homepage) {
                db.prepare('UPDATE pages SET is_homepage = 0').run();
            }

            const result = db.prepare(`
                INSERT INTO pages (title, slug, layout_data, is_published, is_homepage)
                VALUES (?, ?, ?, ?, ?)
            `).run(title, finalSlug, '[]', is_published ? 1 : 0, is_homepage ? 1 : 0);

            const newPage = db.prepare('SELECT * FROM pages WHERE id = ?').get(result.lastInsertRowid);
            res.status(201).json({ success: true, page: newPage });
        } catch (error) {
            console.error('Error creating page:', error);
            res.status(500).json({ error: 'Failed to create page.' });
        }
    });

    // ─── UPDATE PAGE LAYOUT (Admin) ───
    router.put('/:id', requireAdmin, (req, res) => {
        try {
            const { title, slug, layout_data, is_published, is_homepage } = req.body;
            const pageId = req.params.id;

            const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
            if (!page) return res.status(404).json({ error: 'Page not found.' });

            if (is_homepage) {
                db.prepare('UPDATE pages SET is_homepage = 0 WHERE id != ?').run(pageId);
            }

            db.prepare(`
                UPDATE pages SET 
                    title = COALESCE(?, title),
                    slug = COALESCE(?, slug),
                    layout_data = COALESCE(?, layout_data),
                    is_published = COALESCE(?, is_published),
                    is_homepage = COALESCE(?, is_homepage),
                    updated_at = datetime('now')
                WHERE id = ?
            `).run(
                title || null, 
                slug || null, 
                layout_data ? JSON.stringify(layout_data) : null, 
                is_published !== undefined ? (is_published ? 1 : 0) : null,
                is_homepage !== undefined ? (is_homepage ? 1 : 0) : null,
                pageId
            );

            res.json({ success: true, message: 'Page updated successfully.' });
        } catch (error) {
            console.error('Error updating page:', error);
            res.status(500).json({ error: 'Failed to update page.' });
        }
    });

    // ─── DELETE PAGE (Admin) ───
    router.delete('/:id', requireAdmin, (req, res) => {
        try {
            const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
            if (!page) return res.status(404).json({ error: 'Page not found.' });
            
            if (page.is_homepage) {
                return res.status(400).json({ error: 'Cannot delete the homepage. Set another page as homepage first.' });
            }

            db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
            res.json({ success: true, message: 'Page deleted.' });
        } catch (error) {
            console.error('Error deleting page:', error);
            res.status(500).json({ error: 'Failed to delete page.' });
        }
    });

    return router;
};
