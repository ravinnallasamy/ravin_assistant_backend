const fs = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '..', 'tmp');
const MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
const SWEEP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

// Generated TTS audio and temporary STT upload files accumulate in tmp/
// (served publicly at /public/audio) and are never otherwise cleaned up,
// including files left behind when speechToText throws before it can
// unlink its own temp file. This sweep bounds disk usage and public
// exposure time for anything dropped there.
function sweepTmpDir() {
    fs.readdir(TMP_DIR, (err, files) => {
        if (err) {
            if (err.code !== 'ENOENT') console.error('tmpCleanup readdir error:', err.message);
            return;
        }

        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(TMP_DIR, file);
            fs.stat(filePath, (statErr, stats) => {
                if (statErr) return;
                if (now - stats.mtimeMs > MAX_AGE_MS) {
                    fs.unlink(filePath, () => {});
                }
            });
        }
    });
}

function startTmpCleanup() {
    sweepTmpDir();
    setInterval(sweepTmpDir, SWEEP_INTERVAL_MS).unref();
}

module.exports = { startTmpCleanup };
