// services/audioService.js
const gTTS = require("node-gtts")("en");
const fs = require("fs");
const path = require("path");

exports.textToSpeechMale = async function (text) {
    try {
        const fileName = `voice_${Date.now()}.mp3`;
        const filePath = path.join(__dirname, "..", "tmp", fileName);

        if (!fs.existsSync(path.dirname(filePath))) {
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
        }

        await new Promise((resolve, reject) => {
            gTTS.save(filePath, text, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Return public path
        return `/public/audio/${fileName}`;
    } catch (err) {
        console.error("TTS Error:", err);
        return null;
    }
};
