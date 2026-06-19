// services/gdrive.js
// Simple wrapper for Google Drive backup using googleapis
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

let drive = null;
let folderId = null; // Google Drive folder where originals are stored

function init(config) {
  const { clientId, clientSecret, refreshToken, backupFolderId } = config;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing required Google Drive configuration');
  }
  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  drive = google.drive({ version: 'v3', auth: oauth2Client });
  folderId = backupFolderId; // optional – if not set, files go to root
}

// Upload a local file to Drive; returns file ID and web view link
async function upload(filePath, mimeType = 'application/octet-stream') {
  if (!drive) throw new Error('Google Drive client not initialized');
  const fileName = path.basename(filePath);
  const media = { mimeType, body: fs.createReadStream(filePath) };
  const requestBody = { name: fileName };
  if (folderId) requestBody.parents = [folderId];
  const res = await drive.files.create({ requestBody, media, fields: 'id, webViewLink' });
  return { fileId: res.data.id, webViewLink: res.data.webViewLink };
}

// Delete a file from Drive by its ID
async function deleteFile(fileId) {
  if (!drive) throw new Error('Google Drive client not initialized');
  await drive.files.delete({ fileId });
}

// Get a temporary download URL (signed URL) – Google Drive doesn't provide signed URLs directly,
// but we can export the file content via "alt=media". We'll use the file ID to stream.
function getFileStream(fileId) {
  if (!drive) throw new Error('Google Drive client not initialized');
  return drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' }).then(res => res.data);
}

module.exports = { init, upload, deleteFile, getFileStream };
