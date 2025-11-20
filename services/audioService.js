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

exports.speechToText = async function (base64Audio) {
    try {
        const Groq = require("groq-sdk");
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

        // Create a temporary file for the audio
        const filePath = path.join(__dirname, "..", "tmp", `input_${Date.now()}.m4a`); // m4a or wav depending on input
        // Ideally we should know the mime type. For now assuming m4a/webm from frontend.
        // But Groq Whisper supports multiple formats.

        const buffer = Buffer.from(base64Audio, 'base64');
        fs.writeFileSync(filePath, buffer);

        const translation = await groq.audio.transcriptions.create({
            file: fs.createReadStream(filePath),
            model: "whisper-large-v3",
            response_format: "json",
            temperature: 0.0
        });

        // Cleanup
        fs.unlinkSync(filePath);

        return translation.text;
    } catch (err) {
        console.error("STT Error:", err);
        return null;
    }
};
