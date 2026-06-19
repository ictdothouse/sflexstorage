const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'original');

// Configure multer storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const uniqueName = `${uuidv4()}${ext}`;
        cb(null, uniqueName);
    }
});

// File filter: only images
const fileFilter = (req, file, cb) => {
    const allowedMimes = [
        'image/jpeg', 'image/png', 'image/tiff', 'image/webp',
        'image/heif', 'image/heic', 'image/avif', 'image/bmp'
    ];
    if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error(`File type ${file.mimetype} not allowed. Only images are accepted.`), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: (parseInt(process.env.MAX_UPLOAD_SIZE_MB) || 100) * 1024 * 1024, // MB to bytes
        files: 50 // Max 50 files at once
    }
});

// Avatar upload config
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, path.join(__dirname, '..', 'uploads', 'avatars'));
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `avatar_${req.session.userId}${ext}`);
    }
});

const avatarUpload = multer({
    storage: avatarStorage,
    fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB max for avatars
});

module.exports = { upload, avatarUpload };
