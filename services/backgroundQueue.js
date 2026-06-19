// services/backgroundQueue.js
// Simple in‑process background queue for ultra‑lite AI analysis.
// Uses the existing SQLite DB to store pending tasks so they survive restarts.

const sharp = require('sharp');
const path = require('path');
const { getDominantColor, computeDHash } = require('./imageAnalyzer');

let dbInstance = null;
let intervalId = null;

function init(db) {
  dbInstance = db;
  // Start processing loop (runs every 5 seconds)
  intervalId = setInterval(processPending, 5000);
  // Also process any tasks that were left in "processing" state on startup.
  db.prepare(`UPDATE background_tasks SET status = 'queued' WHERE status = 'processing'`).run();
}

async function enqueue(imageId) {
  // Insert a new task record.
  dbInstance.prepare(`INSERT INTO background_tasks (image_id, task_type, status) VALUES (?, 'analyze', 'queued')`).run(imageId);
}

async function processPending() {
  if (!dbInstance) return;
  const task = dbInstance.prepare(`SELECT * FROM background_tasks WHERE status = 'queued' ORDER BY created_at LIMIT 1`).get();
  if (!task) return;

  // Mark as processing
  dbInstance.prepare(`UPDATE background_tasks SET status = 'processing', updated_at = datetime('now') WHERE id = ?`).run(task.id);
  try {
    const image = dbInstance.prepare(`SELECT * FROM images WHERE id = ?`).get(task.image_id);
    if (!image) throw new Error('Image not found');
    const imagePath = path.join(__dirname, '..', 'uploads', 'original', image.filename);
    // Compute dominant color and perceptual hash (dHash)
    const dominantColor = await getDominantColor(imagePath);
    const hash = await computeDHash(imagePath);
    // Update images record
    dbInstance.prepare(`UPDATE images SET dominant_color = ?, phash = ?, ai_status = 'completed' WHERE id = ?`).run(dominantColor, hash, task.image_id);
    // Mark task completed
    dbInstance.prepare(`UPDATE background_tasks SET status = 'completed', updated_at = datetime('now') WHERE id = ?`).run(task.id);
  } catch (err) {
    console.error('Background task error:', err);
    dbInstance.prepare(`UPDATE background_tasks SET status = 'failed', updated_at = datetime('now') WHERE id = ?`).run(task.id);
  }
}

function shutdown() {
  if (intervalId) clearInterval(intervalId);
}

module.exports = { init, enqueue, shutdown };
