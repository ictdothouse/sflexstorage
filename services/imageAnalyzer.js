// services/imageAnalyzer.js
// Lightweight image analysis utilities using sharp.
// - getDominantColor: returns hex string of dominant RGB color.
// - computeDHash: simple perceptual hash (dHash) based on 9x8 grayscale image.

const sharp = require('sharp');

/**
 * Returns dominant color as a hex string (e.g., "#a1b2c3").
 */
async function getDominantColor(imagePath) {
  const stats = await sharp(imagePath).stats();
  // stats.dominant contains { r, g, b } values (0-255)
  const { r, g, b } = stats.dominant;
  const toHex = v => v.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Compute dHash (64‑bit) for an image.
 * Steps:
 * 1. Resize to 9×8, grayscale.
 * 2. Compare each pixel to its right neighbor.
 * 3. Build a binary string, then convert to hex.
 */
async function computeDHash(imagePath) {
  const resized = await sharp(imagePath)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  // resized is Uint8Array length 9*8 = 72
  let hash = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const leftIdx = row * 9 + col;
      const rightIdx = leftIdx + 1;
      hash += resized[leftIdx] > resized[rightIdx] ? '1' : '0';
    }
  }
  // Convert binary string to hex (16 characters)
  const hex = parseInt(hash, 2).toString(16).padStart(16, '0');
  return hex;
}

module.exports = { getDominantColor, computeDHash };
