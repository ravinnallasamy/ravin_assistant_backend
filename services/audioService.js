// services/audioService.js
const gTTS = require("node-gtts")("en");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Groq = require("groq-sdk");

const TMP_DIR = path.join(__dirname, "..", "tmp");

function ensureTmpDir() {
    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
    }
}

function randomFileName(prefix, ext) {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
}

exports.textToSpeechMale = async function (text) {
    try {
        ensureTmpDir();
        const fileName = randomFileName("voice", "mp3");
        const filePath = path.join(TMP_DIR, fileName);

        await new Promise((resolve, reject) => {
            gTTS.save(filePath, text, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        return `/public/audio/${fileName}`;
    } catch (err) {
        console.error("TTS Error:", err);
        return null;
    }
};

exports.speechToText = async function (base64Audio) {
    ensureTmpDir();
    const filePath = path.join(TMP_DIR, randomFileName("input", "m4a"));

    try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        const buffer = Buffer.from(base64Audio, 'base64');
        fs.writeFileSync(filePath, buffer);

        const translation = await groq.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3",
            response_format: "json",
            temperature: 0.0
        });

        return translation.text;
    } catch (err) {
        console.error("STT Error:", err);
        return null;
    } finally {
        fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') console.error("STT temp file cleanup error:", err.message);
        });
    }
};
