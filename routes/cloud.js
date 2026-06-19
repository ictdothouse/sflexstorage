// routes/cloud.js
// Handles offload to Cloudflare R2 and backup to Google Drive (backup only)
const express = require('express');
const router = express.Router();
const path = require('path');
const { requireAdmin } = require('../middleware/auth');

module.exports = function(db) {
  // All routes in this file require admin access
  router.use(requireAdmin);

  const r2 = require('../services/r2');
  const gdrive = require('../services/gdrive');

  // Expect settings are stored in system_settings table
  function getR2Config() {
    const rows = db.prepare(`SELECT key, value FROM system_settings WHERE key LIKE 'r2_%'`).all();
    const cfg = {};
    rows.forEach(r => cfg[r.key.replace('r2_', '')] = r.value);
    return cfg;
  }

  function getGDriveConfig() {
    const rows = db.prepare(`SELECT key, value FROM system_settings WHERE key LIKE 'gdrive_%'`).all();
    const cfg = {};
    rows.forEach(r => cfg[r.key.replace('gdrive_', '')] = r.value);
    return cfg;
  }

  // POST /admin/cloud/offload
  router.post('/admin/cloud/offload', async (req, res) => {
    try {
      // Init services from stored credentials
      r2.init(getR2Config());
      const backupEnabled = db.prepare(`SELECT value FROM system_settings WHERE key = 'gdrive_backup_enabled'`).get()?.value === '1';
      if (backupEnabled) gdrive.init(getGDriveConfig());

      const uploadsDir = path.join(__dirname, '..', 'uploads', 'original');
      const files = require('fs').readdirSync(uploadsDir);
      for (const file of files) {
        const localPath = path.join(uploadsDir, file);
        const key = file; // using filename as key in R2 bucket
        // Upload to R2
        await r2.upload(localPath, key);
        // If backup enabled, upload to Drive as well
        if (backupEnabled) {
          const { fileId } = await gdrive.upload(localPath);
          // Store Drive file ID in DB
          db.prepare('UPDATE images SET storage_provider = ?, gdrive_file_id = ? WHERE original_filename = ?')
            .run('r2', fileId, file);
        } else {
          db.prepare('UPDATE images SET storage_provider = ? WHERE original_filename = ?')
            .run('r2', file);
        }
        // Delete local file after successful upload
        require('fs').unlinkSync(localPath);
      }
      res.json({ success: true, message: 'Offload completed' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /admin/cloud/restore
  router.post('/admin/cloud/restore', async (req, res) => {
    try {
      r2.init(getR2Config());
      const backupEnabled = db.prepare(`SELECT value FROM system_settings WHERE key = 'gdrive_backup_enabled'`).get()?.value === '1';
      if (backupEnabled) gdrive.init(getGDriveConfig());

      const rows = db.prepare('SELECT id, original_filename, storage_provider, gdrive_file_id FROM images WHERE storage_provider != "local"').all();
      const uploadDir = path.join(__dirname, '..', 'uploads', 'original');
      const fs = require('fs');

      for (const img of rows) {
        const destPath = path.join(uploadDir, img.original_filename);
        if (img.storage_provider === 'r2') {
          // Download from R2 via public URL
          const url = r2.getPublicUrl(img.original_filename);
          const https = require('https');
          const file = fs.createWriteStream(destPath);
          await new Promise((resolve, reject) => {
            https.get(url, res => {
              res.pipe(file);
              file.on('finish', () => file.close(resolve));
            }).on('error', err => { fs.unlinkSync(destPath); reject(err); });
          });
        } else if (img.storage_provider === 'gdrive' && backupEnabled && img.gdrive_file_id) {
          const stream = await gdrive.getFileStream(img.gdrive_file_id);
          await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(destPath);
            stream.pipe(out);
            out.on('finish', resolve);
            out.on('error', reject);
          });
        }
        // Update DB to local
        db.prepare('UPDATE images SET storage_provider = ? WHERE id = ?').run('local', img.id);
      }
      res.json({ success: true, message: 'Restore completed' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /admin/cloud/test-r2 - test R2 connection
  router.post('/admin/cloud/test-r2', async (req, res) => {
    try {
      const cfg = getR2Config();
      await r2.testConnection(cfg);
      res.json({ success: true, message: 'Connection successful! R2 bucket is accessible.' });
    } catch (err) {
      console.error('R2 test failed:', err.message);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /admin/cloud/schedule - store cron and enable flag
  router.post('/admin/cloud/schedule', async (req, res) => {
    try {
      const { cron, enabled } = req.body;
      // Basic cron validation (5 fields: minute hour day month day-of-week)
      const cronRegex = /^(\*|[0-5]?\d) (\*|[0-5]?\d) (\*|[0-2]?\d|3[01]) (\*|[0-9]|1[0-2]) (\*|[0-6])$/;
      if (!cron || !cronRegex.test(cron)) {
        return res.status(400).json({ success: false, error: 'Invalid cron expression' });
      }
      const enabledFlag = enabled ? '1' : '0';
      const upd = db.prepare(`INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`);
      upd.run('cloud_schedule_cron', cron);
      upd.run('cloud_schedule_enabled', enabledFlag);
      res.json({ success: true, message: 'Schedule saved' });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
};
