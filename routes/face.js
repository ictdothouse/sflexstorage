const express = require('express');
const router = express.Router();
const FaceService = require('../services/faceService');
const { requireAuth } = require('../middleware/auth');

module.exports = function(db) {
    const faceService = new FaceService(db);

    // ─── STORE FACE DESCRIPTORS FOR AN IMAGE ───
    router.post('/store', requireAuth, (req, res) => {
        try {
            const { imageId, faces } = req.body;
            if (!imageId || !faces || !Array.isArray(faces)) {
                return res.status(400).json({ error: 'imageId and faces array required.' });
            }
            faceService.storeFaces(imageId, faces);
            res.json({ success: true, stored: faces.length });
        } catch (error) {
            console.error('Store faces error:', error);
            res.status(500).json({ error: 'Failed to store face data.' });
        }
    });

    // ─── FIND SIMILAR FACES ───
    router.post('/search', (req, res) => {
        try {
            const { descriptor, threshold, limit } = req.body;
            if (!descriptor || !Array.isArray(descriptor)) {
                return res.status(400).json({ error: 'Face descriptor array required.' });
            }
            const results = faceService.findSimilarFaces(descriptor, threshold || 0.6, limit || 50);
            res.json({ success: true, results, count: results.length });
        } catch (error) {
            console.error('Face search error:', error);
            res.status(500).json({ error: 'Face search failed.' });
        }
    });

    // ─── GROUP FACES BY PERSON ───
    router.get('/groups', (req, res) => {
        try {
            const threshold = parseFloat(req.query.threshold) || 0.55;
            const groups = faceService.groupFacesByPerson(threshold);
            res.json({
                success: true,
                groups: groups.filter(g => g.length > 1), // Only groups with 2+ photos
                totalGroups: groups.filter(g => g.length > 1).length
            });
        } catch (error) {
            console.error('Face groups error:', error);
            res.status(500).json({ error: 'Failed to group faces.' });
        }
    });

    // ─── GET FACE STATS ───
    router.get('/stats', (req, res) => {
        try {
            const stats = faceService.getStats();
            res.json({ success: true, ...stats });
        } catch (error) {
            res.status(500).json({ error: 'Failed to get stats.' });
        }
    });

    // ─── GET PEOPLE LIST ───
    router.get('/people', (req, res) => {
        try {
            const people = faceService.getPeople();
            res.json({ success: true, people });
        } catch (error) {
            res.status(500).json({ error: 'Failed to get people.' });
        }
    });

    // ─── CREATE PERSON ───
    router.post('/people', requireAuth, (req, res) => {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ error: 'Name required.' });
            const result = faceService.createPerson(name);
            res.json(result);
        } catch (error) {
            res.status(500).json({ error: 'Failed to create person.' });
        }
    });

    // ─── TAG FACE ───
    router.post('/tag', requireAuth, (req, res) => {
        try {
            const { faceId, personId } = req.body;
            if (!faceId || !personId) return res.status(400).json({ error: 'faceId and personId required.' });
            faceService.tagFace(faceId, personId);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to tag face.' });
        }
    });

    // ─── TAG FACE GROUP ───
    router.post('/tag-group', requireAuth, (req, res) => {
        try {
            const { faceIds, personId } = req.body;
            if (!faceIds || !Array.isArray(faceIds) || !personId) {
                return res.status(400).json({ error: 'faceIds array and personId required.' });
            }
            faceService.tagFaceGroup(faceIds, personId);
            res.json({ success: true, count: faceIds.length });
        } catch (error) {
            console.error('Tag face group error:', error);
            res.status(500).json({ error: 'Failed to tag face group.' });
        }
    });

    // ─── DELETE FACE GROUP ───
    router.post('/delete-group', requireAuth, (req, res) => {
        try {
            const { faceIds } = req.body;
            if (!faceIds || !Array.isArray(faceIds)) {
                return res.status(400).json({ error: 'faceIds array required.' });
            }
            faceService.deleteFaceGroup(faceIds);
            res.json({ success: true, count: faceIds.length });
        } catch (error) {
            console.error('Delete face group error:', error);
            res.status(500).json({ error: 'Failed to delete face group.' });
        }
    });

    // ─── GET CROPPED FACE IMAGE ───
    router.get('/:faceId/crop', (req, res) => {
        try {
            const faceId = req.params.faceId;
            const face = db.prepare('SELECT * FROM face_descriptors WHERE id = ?').get(faceId);
            if (!face) return res.status(404).send('Face not found');

            const image = db.prepare('SELECT original_path FROM images WHERE id = ?').get(face.image_id);
            if (!image) return res.status(404).send('Image not found');

            const path = require('path');
            const fs = require('fs');
            const sharp = require('sharp');
            const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
            const filePath = path.join(UPLOADS_DIR, image.original_path);

            if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

            let x = Math.round(face.bbox_x);
            let y = Math.round(face.bbox_y);
            let w = Math.round(face.bbox_w);
            let h = Math.round(face.bbox_h);

            // Add margin to crop
            const margin = Math.round(w * 0.2);
            sharp(filePath).metadata().then(meta => {
                const cropX = Math.max(0, x - margin);
                const cropY = Math.max(0, y - margin);
                const cropW = Math.min(meta.width - cropX, w + margin * 2);
                const cropH = Math.min(meta.height - cropY, h + margin * 2);

                sharp(filePath)
                    .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
                    .resize(120, 120, { fit: 'cover' })
                    .jpeg({ quality: 85 })
                    .toBuffer()
                    .then(buffer => {
                        res.set({
                            'Cache-Control': 'public, max-age=86400',
                            'Content-Type': 'image/jpeg'
                        });
                        res.send(buffer);
                    })
                    .catch(err => {
                        console.error('Crop error:', err);
                        res.status(500).send('Error cropping image');
                    });
            }).catch(err => {
                res.status(500).send('Error reading metadata');
            });
        } catch (error) {
            console.error('Face crop error:', error);
            res.status(500).send('Error');
        }
    });

    // ─── GET FACES FOR AN IMAGE ───
    router.get('/image/:imageId', (req, res) => {
        try {
            const faces = faceService.getFacesForImage(req.params.imageId);
            res.json({ success: true, faces });
        } catch (error) {
            res.status(500).json({ error: 'Failed to get faces.' });
        }
    });

    return router;
};
