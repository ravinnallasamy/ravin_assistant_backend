let pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');

// Handle different versions of pdf-parse
if (typeof pdfParse !== 'function') {
  console.warn('[WARN] pdf-parse is not a function. Attempting to use default export...');
  pdfParse = pdfParse.default || pdfParse;
  if (typeof pdfParse !== 'function') {
    console.error('[ERROR] Could not find pdf-parse function. Please restart the server.');
  }
}

/**
 * Cleans extracted text by removing excessive whitespace and newlines.
 * @param {string} text 
 * @returns {string}
 */
function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts text from a file buffer based on mime type.
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - Mime type of the file
 * @returns {Promise<string>} - Extracted and cleaned text
 */
async function extractTextFromResume(buffer, mimeType) {
  try {
    let text = '';

    if (mimeType === 'application/pdf') {
      console.log('[DEBUG] Extracting PDF text...');

      if (typeof pdfParse !== 'function') {
        throw new Error('pdf-parse is not available. Please restart the backend server.');
      }

      const data = await pdfParse(buffer);
      text = data.text;
      console.log(`[DEBUG] PDF extraction successful. Text length: ${text.length}`);
    } else if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType)) {
      console.log('[DEBUG] Extracting image text with OCR...');
      const { data: { text: ocrText } } = await Tesseract.recognize(buffer, 'eng');
      text = ocrText;
      console.log(`[DEBUG] OCR successful. Text length: ${text.length}`);
    } else {
      console.warn(`[DEBUG] Unsupported mime type for extraction: ${mimeType}`);
      return '';
    }

    return cleanText(text);
  } catch (error) {
    console.error('[DEBUG] Error extracting text from resume:', error.message);
    throw error;
  }
}

module.exports = { extractTextFromResume };
