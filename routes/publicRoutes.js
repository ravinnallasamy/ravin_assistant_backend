const express = require('express');
const router = express.Router();
const publicController = require('../controllers/publicController');
const { validateAskQuestion } = require('../middlewares/validate');

// Get profile data
router.get('/getData', publicController.getProfile);

// Ask Question (text + audio)
router.post('/ask', validateAskQuestion, publicController.askQuestion);

module.exports = router;
