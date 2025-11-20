const { pipeline } = require('@xenova/transformers');
const supabase = require('./supabaseClient');

let embedder = null;

// Init embedder
async function initEmbedder() {
    if (!embedder) {
        console.log("Loading MiniLM embedder...");
        embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
        console.log("MiniLM embedder ready.");
    }
    return embedder;
}

// Chunk text
function chunkText(text, size = 1000) {
    if (!text) return [];
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.slice(i, i + size));
    }
    return chunks;
}

// Embed single text
async function generateEmbedding(text) {
    const pipe = await initEmbedder();
    const output = await pipe(text.substring(0, 2000), {
        pooling: "mean",
        normalize: true
    });
    return Array.from(output.data);
}

// Batch embed
async function generateBatchEmbeddings(chunks) {
    const results = [];
    for (const chunk of chunks) {
        try {
            const embedding = await generateEmbedding(chunk);
            results.push({ chunk, embedding });
        } catch (error) {
            console.error("Embedding error:", error.message);
        }
    }
    return results;
}

// Vector search
async function similaritySearch(query, k = 5) {
    let vector = Array.isArray(query)
        ? query
        : await generateEmbedding(query);

    const { data, error } = await supabase.rpc("match_embeddings", {
        query_embedding: vector,
        match_threshold: 0.2,
        match_count: k
    });

    if (error) {
        console.error("Similarity search error:", error);
        return [];
    }

    return data || [];
}

module.exports = {
    initEmbedder,
    chunkText,
    generateEmbedding,
    generateBatchEmbeddings,
    similaritySearch
};
