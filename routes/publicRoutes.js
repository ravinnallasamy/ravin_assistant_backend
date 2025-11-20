const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');

// Get profile data
router.get('/getData', publicController.getProfile);

// Ask Question (text + audio)
router.post('/ask', publicController.askQuestion);

module.exports = router;
