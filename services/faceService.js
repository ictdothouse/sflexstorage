/**
 * Face descriptor management service
 * Handles storing and querying face descriptors in SQLite
 */
class FaceService {
    constructor(db) {
        this.db = db;
    }

    /**
     * Store face descriptors for an image
     * @param {number} imageId
     * @param {Array} faces - Array of { descriptor: Float32Array, bbox: {x,y,w,h}, confidence }
     */
    storeFaces(imageId, faces) {
        // Delete existing descriptors for this image
        this.db.prepare('DELETE FROM face_descriptors WHERE image_id = ?').run(imageId);

        const stmt = this.db.prepare(`
            INSERT INTO face_descriptors (image_id, descriptor, bbox_x, bbox_y, bbox_w, bbox_h, confidence)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = this.db.transaction((faces) => {
            for (const face of faces) {
                const descriptorJson = JSON.stringify(Array.from(face.descriptor));
                stmt.run(
                    imageId,
                    descriptorJson,
                    face.bbox?.x || 0,
                    face.bbox?.y || 0,
                    face.bbox?.w || 0,
                    face.bbox?.h || 0,
                    face.confidence || 0
                );
            }
        });

        insertMany(faces);
    }

    // ─── PERSON MANAGEMENT & TAGGING ───

    getPeople() {
        return this.db.prepare(`
            SELECT p.*, COUNT(fd.id) as face_count,
                   (SELECT i.thumbnail_path FROM face_descriptors f2 JOIN images i ON f2.image_id = i.id WHERE f2.person_id = p.id LIMIT 1) as cover_image
            FROM people p
            LEFT JOIN face_descriptors fd ON p.id = fd.person_id
            GROUP BY p.id
            ORDER BY p.name ASC
        `).all();
    }

    createPerson(name) {
        try {
            const result = this.db.prepare('INSERT INTO people (name) VALUES (?)').run(name.trim());
            return { success: true, id: result.lastInsertRowid, name: name.trim() };
        } catch (error) {
            if (error.message.includes('UNIQUE')) {
                const existing = this.db.prepare('SELECT id FROM people WHERE name = ?').get(name.trim());
                return { success: true, id: existing.id, name: name.trim() }; // Return existing
            }
            throw error;
        }
    }

    tagFace(faceId, personId) {
        this.db.prepare('UPDATE face_descriptors SET person_id = ? WHERE id = ?').run(personId, faceId);
    }

    /**
     * Tag an entire group of similar faces to a person
     */
    tagFaceGroup(faceIds, personId) {
        if (!faceIds || faceIds.length === 0) return;
        const placeholders = faceIds.map(() => '?').join(',');
        this.db.prepare(`UPDATE face_descriptors SET person_id = ? WHERE id IN (${placeholders})`).run(personId, ...faceIds);
    }

    /**
     * Delete an entire group of face descriptors
     */
    deleteFaceGroup(faceIds) {
        if (!faceIds || faceIds.length === 0) return;
        const placeholders = faceIds.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM face_descriptors WHERE id IN (${placeholders})`).run(...faceIds);
    }

    /**
     * Get all face descriptors for an image
     */
    getFacesForImage(imageId) {
        const rows = this.db.prepare('SELECT * FROM face_descriptors WHERE image_id = ?').all(imageId);
        return rows.map(row => ({
            id: row.id,
            imageId: row.image_id,
            descriptor: JSON.parse(row.descriptor),
            bbox: { x: row.bbox_x, y: row.bbox_y, w: row.bbox_w, h: row.bbox_h },
            confidence: row.confidence
        }));
    }

    /**
     * Find similar faces across all images
     * Uses Euclidean distance for face descriptor matching
     * @param {Array} queryDescriptor - Float array from face-api.js
     * @param {number} threshold - Distance threshold (lower = more similar, default 0.6)
     * @param {number} limit - Max results
     */
    findSimilarFaces(queryDescriptor, threshold = 0.6, limit = 50) {
        const allFaces = this.db.prepare(`
            SELECT fd.*, i.id as img_id, i.title, i.thumbnail_path, i.gallery_id
            FROM face_descriptors fd
            JOIN images i ON fd.image_id = i.id
            WHERE i.is_active = 1
        `).all();

        const results = [];
        for (const face of allFaces) {
            try {
                const storedDescriptor = JSON.parse(face.descriptor);
                const distance = this.euclideanDistance(queryDescriptor, storedDescriptor);
                if (distance <= threshold) {
                    results.push({
                        faceId: face.id,
                        imageId: face.img_id,
                        title: face.title,
                        thumbnailPath: face.thumbnail_path,
                        galleryId: face.gallery_id,
                        distance: Math.round(distance * 1000) / 1000,
                        similarity: Math.round((1 - distance) * 100),
                        bbox: { x: face.bbox_x, y: face.bbox_y, w: face.bbox_w, h: face.bbox_h }
                    });
                }
            } catch (e) {
                // Skip invalid descriptors
            }
        }

        // Sort by distance (most similar first)
        results.sort((a, b) => a.distance - b.distance);
        return results.slice(0, limit);
    }

    /**
     * Group all faces by similarity
     * Returns groups of images that contain the same person
     */
    groupFacesByPerson(threshold = 0.55) {
        const allFaces = this.db.prepare(`
            SELECT fd.*, i.id as img_id, i.title, i.thumbnail_path, p.name as person_name
            FROM face_descriptors fd
            JOIN images i ON fd.image_id = i.id
            LEFT JOIN people p ON fd.person_id = p.id
            WHERE i.is_active = 1
        `).all();

        const groups = [];
        const assigned = new Set();

        for (let i = 0; i < allFaces.length; i++) {
            if (assigned.has(allFaces[i].id)) continue;

            const group = [{
                faceId: allFaces[i].id,
                imageId: allFaces[i].img_id,
                title: allFaces[i].title,
                thumbnailPath: allFaces[i].thumbnail_path,
                personName: allFaces[i].person_name,
                personId: allFaces[i].person_id,
                bbox: { x: allFaces[i].bbox_x, y: allFaces[i].bbox_y, w: allFaces[i].bbox_w, h: allFaces[i].bbox_h }
            }];
            assigned.add(allFaces[i].id);

            const descriptor1 = JSON.parse(allFaces[i].descriptor);

            for (let j = i + 1; j < allFaces.length; j++) {
                if (assigned.has(allFaces[j].id)) continue;
                try {
                    const descriptor2 = JSON.parse(allFaces[j].descriptor);
                    const distance = this.euclideanDistance(descriptor1, descriptor2);
                    if (distance <= threshold) {
                        group.push({
                            faceId: allFaces[j].id,
                            imageId: allFaces[j].img_id,
                            title: allFaces[j].title,
                            thumbnailPath: allFaces[j].thumbnail_path,
                            personName: allFaces[j].person_name,
                            personId: allFaces[j].person_id,
                            bbox: { x: allFaces[j].bbox_x, y: allFaces[j].bbox_y, w: allFaces[j].bbox_w, h: allFaces[j].bbox_h }
                        });
                        assigned.add(allFaces[j].id);
                    }
                } catch (e) {}
            }

            groups.push(group);
        }

        // Sort groups by size (largest first)
        groups.sort((a, b) => b.length - a.length);
        return groups;
    }

    /**
     * Get face statistics
     */
    getStats() {
        const total = this.db.prepare('SELECT COUNT(*) as count FROM face_descriptors').get();
        const images = this.db.prepare('SELECT COUNT(DISTINCT image_id) as count FROM face_descriptors').get();
        return {
            totalFaces: total.count,
            imagesWithFaces: images.count
        };
    }

    /**
     * Calculate Euclidean distance between two face descriptors
     */
    euclideanDistance(desc1, desc2) {
        if (!desc1 || !desc2 || desc1.length !== desc2.length) return 999;
        let sum = 0;
        for (let i = 0; i < desc1.length; i++) {
            const diff = desc1[i] - desc2[i];
            sum += diff * diff;
        }
        return Math.sqrt(sum);
    }
}

module.exports = FaceService;
