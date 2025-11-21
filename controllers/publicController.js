// controllers/publicController.js
const supabase = require("../services/supabaseClient");
const { generateEmbedding, similaritySearch } = require("../services/embeddingService");
const { textToSpeechMale, speechToText } = require("../services/audioService");
const Groq = require("groq-sdk");
require("dotenv").config();

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// -----------------------------
// GET PROFILE
// -----------------------------
exports.getProfile = async (req, res) => {
    try {
        const { data } = await supabase.from("profile").select("*").single();
        res.json(data || {});
    } catch (err) {
        console.error("Profile Error:", err);
        res.status(500).json({ error: "Failed to fetch profile" });
    }
};

// -----------------------------
// ASK QUESTION (TEXT + VOICE)
// -----------------------------
exports.askQuestion = async (req, res) => {
    try {
        let { question, voiceBase64 } = req.body;

        // 🎤 1️⃣ SPEECH → TEXT
        // Only if voiceBase64 is provided AND question is empty
        if (voiceBase64 && (!question || question.trim() === "")) {
            console.log("🎤 Converting voice to text...");
            const converted = await speechToText(voiceBase64);

            if (!converted || converted.trim() === "") {
                return res.status(400).json({ error: "Unable to transcribe speech" });
            }

            question = converted;
        }

        if (!question || question.trim() === "") {
            return res.status(400).json({ error: "Empty question" });
        }

        console.log("📌 Question:", question);

        // 📌 2️⃣ Generate embedding
        const questionEmbedding = await generateEmbedding(question);

        // 🔍 3️⃣ Vector Search - Get top 5 most relevant chunks
        const matches = await similaritySearch(questionEmbedding, 5);

        // 🔍 3.5️⃣ Explicitly fetch BIO if question is about "yourself" or "who are you"
        let bioContext = "";
        const bioKeywords = ["yourself", "who are you", "your background", "about you", "introduction"];
        if (bioKeywords.some(k => question.toLowerCase().includes(k))) {
            const { data: profile } = await supabase
                .from("profile")
                .select("bio, scraped_resume, scraped_portfolio")
                .single();

            if (profile) {
                if (profile.bio) bioContext += `BIO: ${profile.bio}\n\n`;

                // If bio is short or missing, add resume summary
                if (profile.scraped_resume) {
                    bioContext += `RESUME SUMMARY: ${profile.scraped_resume.substring(0, 1000)}\n\n`;
                }

                // Add portfolio about section if available
                if (profile.scraped_portfolio) {
                    bioContext += `PORTFOLIO HIGHLIGHTS: ${profile.scraped_portfolio.substring(0, 1000)}\n\n`;
                }
            }
        }

        // Build concise context (limit to save tokens)
        const context = (bioContext + (matches.length
            ? matches.map(m => m.chunk).join("\n")
            : "")).substring(0, 2000); // Increased limit slightly to accommodate bio

        // 🧠 4️⃣ Build Optimized Prompt (minimal to save tokens)
        const prompt = context
            ? `You are my personal AI assistant representing me. Answer in first person using "my/I/me".
            
DATA:
${context}

Q: ${question}

RULES:
- If question is about my skills, education, experience, projects, background → Answer from DATA
- If question is unrelated (weather, sports, general knowledge, etc.) → Say: "That's outside my scope. Ask me about my professional background, skills, or experience!"
- Keep answers 1-3 sentences, smart and catchy
- Use "my" not "your" (e.g., "My skills include..." not "Your skills...")
- Add examples when helpful`
            : `Q: ${question}

No data available. Say: "I don't have that information yet. Please ask about my professional background, skills, or experience!"`;

        // 🤖 5️⃣ Get Answer from GROQ with error handling
        let answerText;

        try {
            const completion = await groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: [{ role: "user", content: prompt }],
                max_tokens: 150, // Limit response length to save tokens
                temperature: 0.7
            });

            answerText = completion.choices[0].message.content.trim();
            console.log("🧠 AI Answer:", answerText);

        } catch (apiError) {
            console.error("❌ Groq API Error:", apiError);

            // Check if it's an API key issue
            if (apiError.status === 401 || apiError.status === 403) {
                answerText = "Sorry, the AI assistant is temporarily unavailable due to an API key issue. Please contact the administrator.";
            } else if (apiError.status === 429) {
                answerText = "The AI assistant is currently at capacity. Please try again in a moment.";
            } else {
                answerText = "I'm having trouble processing your question right now. Please try again.";
            }
        }

        // 🔊 6️⃣ Convert Answer → Voice (DISABLED - Using Client-Side TTS)
        // const audioUrl = await textToSpeechMale(answerText);
        const audioUrl = null;

        // 📦 7️⃣ Store QnA
        await supabase.from("qna").insert([{ question, answer: answerText }]);

        // 📤 8️⃣ Send to frontend
        res.json({
            success: true,
            question,
            answer: answerText,
            audio: audioUrl,
        });

    } catch (err) {
        console.error("❌ askQuestion Error:", err);
        res.status(500).json({ error: "Failed to answer question" });
    }
};
