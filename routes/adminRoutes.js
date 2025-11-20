const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminAuth = require('../middlewares/adminAuth');
const multer = require('multer');

// Multer setup for memory storage (files processed in memory)
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

router.post('/login', adminAuth, adminController.login);
router.post('/upload', adminAuth, upload.single('file'), adminController.uploadFile);
router.put('/update', adminAuth, adminController.updateProfile);
router.get('/qna', adminAuth, adminController.getQnA);
router.get('/profile', adminAuth, adminController.getAdminProfile);
router.post('/scrape-url', adminAuth, adminController.scrapeUrl);

module.exports = router;
