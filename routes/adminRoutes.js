const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/adminController');
const adminAuth = require('../middlewares/adminAuth');
const { validateUpdateProfile, validateScrapeUrl } = require('../middlewares/validate');

const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB
        files: 1,
    },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
            return cb(new Error('Unsupported file type'));
        }
        cb(null, true);
    },
});

function handleUpload(req, res, next) {
    upload.single('file')(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large (max 10MB)' });
            }
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }
        next();
    });
}

router.post('/login', adminAuth, adminController.login);
router.post('/upload', adminAuth, handleUpload, adminController.uploadFile);
router.put('/update', adminAuth, validateUpdateProfile, adminController.updateProfile);
router.get('/qna', adminAuth, adminController.getQnA);
router.get('/profile', adminAuth, adminController.getAdminProfile);
router.post('/scrape-url', adminAuth, validateScrapeUrl, adminController.scrapeUrl);

module.exports = router;
