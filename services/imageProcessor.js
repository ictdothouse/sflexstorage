const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

class ImageProcessor {
    constructor(options = {}) {
        this.thumbnailWidth = options.thumbnailWidth || 400;
        this.previewWidth = options.previewWidth || 1200;
        this.watermarkText = options.watermarkText || 'PhotoVault';
        this.watermarkOpacity = options.watermarkOpacity || 0.4;
        this.watermarkImagePath = options.watermarkImagePath || '';
        this.jpegQualityThumb = 80;
        this.jpegQualityPreview = 75;
    }

    /**
     * Process uploaded image: generate thumbnail, watermarked preview
     * Returns { thumbnail, preview, metadata }
     */
    async processImage(inputPath, filename) {
        const baseName = path.parse(filename).name;
        const ext = '.jpg';
        const thumbName = `thumb_${baseName}${ext}`;
        const previewName = `preview_${baseName}${ext}`;
        const thumbPath = path.join(UPLOADS_DIR, 'thumbnails', thumbName);
        const previewPath = path.join(UPLOADS_DIR, 'previews', previewName);

        // Get original image metadata
        const metadata = await sharp(inputPath).metadata();

        // Generate thumbnail
        await this.generateThumbnail(inputPath, thumbPath);

        // Generate watermarked preview
        await this.generateWatermarkedPreview(inputPath, previewPath, metadata);

        return {
            thumbnail: `thumbnails/${thumbName}`,
            preview: `previews/${previewName}`,
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            size: metadata.size || fs.statSync(inputPath).size,
            metadata: metadata
        };
    }

    /**
     * Generate thumbnail (400px width, cover crop)
     */
    async generateThumbnail(inputPath, outputPath) {
        await sharp(inputPath)
            .resize(this.thumbnailWidth, Math.round(this.thumbnailWidth * 0.75), {
                fit: 'cover',
                position: 'centre'
            })
            .jpeg({ quality: this.jpegQualityThumb })
            .toFile(outputPath);
    }

    /**
     * Generate watermarked preview (1200px width)
     */
    async generateWatermarkedPreview(inputPath, outputPath, metadata) {
        const previewWidth = Math.min(this.previewWidth, metadata.width || this.previewWidth);
        const aspectRatio = (metadata.height || 800) / (metadata.width || 1200);
        const previewHeight = Math.round(previewWidth * aspectRatio);

        // Resize image first
        const resizedBuffer = await sharp(inputPath)
            .resize(previewWidth, previewHeight, { fit: 'inside' })
            .jpeg({ quality: this.jpegQualityPreview })
            .toBuffer();

        // Get actual dimensions after resize
        const resizedMeta = await sharp(resizedBuffer).metadata();
        const w = resizedMeta.width;
        const h = resizedMeta.height;

        // Check if custom watermark image exists
        if (this.watermarkImagePath && fs.existsSync(this.watermarkImagePath)) {
            await this.applyImageWatermark(resizedBuffer, outputPath, w, h);
        } else {
            await this.applyTextWatermark(resizedBuffer, outputPath, w, h);
        }
    }

    /**
     * Apply repeating diagonal text watermark (Shutterstock-style)
     */
    async applyTextWatermark(imageBuffer, outputPath, width, height) {
        const text = this.watermarkText;
        const fontSize = Math.max(24, Math.round(width / 20));
        const opacity = this.watermarkOpacity;
        const spacing = fontSize * 5;
        const angle = -30;

        // Create SVG with repeating diagonal watermark
        let svgTexts = '';
        const diag = Math.sqrt(width * width + height * height);
        const rows = Math.ceil(diag / spacing) + 4;
        const cols = Math.ceil(diag / (text.length * fontSize * 0.6)) + 4;

        for (let row = -2; row < rows; row++) {
            for (let col = -2; col < cols; col++) {
                const x = col * (text.length * fontSize * 0.6);
                const y = row * spacing;
                svgTexts += `<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" opacity="${opacity}">${text}</text>`;
            }
        }

        const svgWatermark = `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <filter id="shadow">
                        <feDropShadow dx="1" dy="1" stdDeviation="1" flood-color="black" flood-opacity="0.3"/>
                    </filter>
                </defs>
                <g transform="rotate(${angle}, ${width / 2}, ${height / 2})" filter="url(#shadow)">
                    ${svgTexts}
                </g>
            </svg>
        `;

        const watermarkBuffer = Buffer.from(svgWatermark);

        await sharp(imageBuffer)
            .composite([{
                input: watermarkBuffer,
                top: 0,
                left: 0,
                blend: 'over'
            }])
            .jpeg({ quality: this.jpegQualityPreview })
            .toFile(outputPath);
    }

    /**
     * Apply custom image watermark (repeating pattern)
     */
    async applyImageWatermark(imageBuffer, outputPath, width, height) {
        // Resize watermark to reasonable size
        const wmSize = Math.round(width / 4);
        const watermarkBuffer = await sharp(this.watermarkImagePath)
            .resize(wmSize, null, { fit: 'inside' })
            .ensureAlpha()
            .modulate({ brightness: 1 })
            .toBuffer();

        const wmMeta = await sharp(watermarkBuffer).metadata();
        const wmW = wmMeta.width;
        const wmH = wmMeta.height;

        // Create repeating pattern
        const composites = [];
        const spacingX = wmW + Math.round(wmW * 0.5);
        const spacingY = wmH + Math.round(wmH * 0.5);

        for (let y = Math.round(spacingY * 0.25); y < height; y += spacingY) {
            for (let x = Math.round(spacingX * 0.25); x < width; x += spacingX) {
                composites.push({
                    input: watermarkBuffer,
                    top: y,
                    left: x,
                    blend: 'over'
                });
            }
        }

        await sharp(imageBuffer)
            .composite(composites)
            .jpeg({ quality: this.jpegQualityPreview })
            .toFile(outputPath);
    }

    /**
     * Generate a text-based watermark PNG for admin to use
     */
    async generateWatermarkImage(text, outputPath) {
        const width = 600;
        const height = 200;
        const svg = `
            <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
                <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
                    font-family="Arial, sans-serif" font-size="48" font-weight="bold"
                    fill="white" opacity="0.6" letter-spacing="8">
                    ${text}
                </text>
            </svg>
        `;

        await sharp(Buffer.from(svg))
            .png()
            .toFile(outputPath);

        return outputPath;
    }

    /**
     * Get image dimensions and basic info
     */
    async getImageInfo(inputPath) {
        const metadata = await sharp(inputPath).metadata();
        const stats = fs.statSync(inputPath);
        return {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            size: stats.size,
            channels: metadata.channels,
            hasAlpha: metadata.hasAlpha,
            density: metadata.density
        };
    }
}

module.exports = ImageProcessor;
