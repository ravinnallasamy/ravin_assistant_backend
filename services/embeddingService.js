const { pipeline } = require('@xenova/transformers');
const supabase = require('./supabaseClient');

let minilmEmbedder = null;
let minilmLoadPromise = null;

// Lazily loads the MiniLM embedder exactly once, even under concurrent
// callers: the in-flight promise is cached so parallel requests await the
// same load instead of each triggering a separate model download/init.
// MiniLM is the sole embedder (local, no external API) since Groq has no
// embeddings endpoint.
async function initMinilmEmbedder() {
    if (minilmEmbedder) return minilmEmbedder;
    if (!minilmLoadPromise) {
        console.log("Loading MiniLM fallback embedder...");
        minilmLoadPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
            .then((pipe) => {
                minilmEmbedder = pipe;
                console.log("MiniLM fallback embedder ready.");
                return minilmEmbedder;
            })
            .catch((err) => {
                minilmLoadPromise = null; // allow retry on next call
                throw err;
            });
    }
    return minilmLoadPromise;
}

// Chunk text: splits at clean boundaries (paragraphs, lines, sentences, or spaces)
// and maintains a small overlap (default 150 chars) to prevent context loss.
function chunkText(text, size = 1000, overlap = 150) {
    if (!text) return [];
    
    const chunks = [];
    let start = 0;
    
    while (start < text.length) {
        // If remaining text is within the size limit, just add it and finish
        if (text.length - start <= size) {
            const lastChunk = text.slice(start).trim();
            if (lastChunk) chunks.push(lastChunk);
            break;
        }
        
        let end = start + size;
        
        // Try to find a clean split point within the last 30% of the chunk size
        const minSplitPoint = Math.max(start + overlap, end - Math.floor(size * 0.3));
        let splitPoint = -1;
        
        // slice the search segment (minSplitPoint to end)
        const searchSegment = text.slice(minSplitPoint, end);
        
        // 1. Try splitting at paragraphs (\n\n)
        const paragraphIdx = searchSegment.lastIndexOf('\n\n');
        if (paragraphIdx !== -1) {
            splitPoint = minSplitPoint + paragraphIdx + 2;
        } else {
            // 2. Try splitting at line breaks (\n)
            const lineIdx = searchSegment.lastIndexOf('\n');
            if (lineIdx !== -1) {
                splitPoint = minSplitPoint + lineIdx + 1;
            } else {
                // 3. Try splitting at sentence boundaries (.!? followed by space)
                const sentenceMatches = [...searchSegment.matchAll(/[.!?]\s+/g)];
                if (sentenceMatches.length > 0) {
                    const lastMatch = sentenceMatches[sentenceMatches.length - 1];
                    splitPoint = minSplitPoint + lastMatch.index + lastMatch[0].length;
                } else {
                    // 4. Fallback to space
                    const spaceIdx = searchSegment.lastIndexOf(' ');
                    if (spaceIdx !== -1) {
                        splitPoint = minSplitPoint + spaceIdx + 1;
                    }
                }
            }
        }
        
        // If no clean split point was found, fallback to hard cutoff
        if (splitPoint === -1 || splitPoint <= start) {
            splitPoint = end;
        }
        
        const chunk = text.slice(start, splitPoint).trim();
        if (chunk) chunks.push(chunk);
        
        start = splitPoint - overlap;
    }
    
    return chunks;
}

async function embedWithMinilm(text) {
    const pipe = await initMinilmEmbedder();
    const output = await pipe(String(text).substring(0, 2000), {
        pooling: "mean",
        normalize: true
    });
    return Array.from(output.data);
}

// Embeds a document chunk for storage using the local MiniLM model.
// Returns { vector, model } so callers/DB layer know which column to write to.
async function generateEmbedding(text) {
    const vector = await embedWithMinilm(text);
    return { vector, model: "minilm" };
}

// Embeds a user question for querying. Same local MiniLM model as
// generateEmbedding — query vs. document distinction doesn't apply since
// MiniLM has no separate task types.
async function generateQueryEmbedding(text) {
    const vector = await embedWithMinilm(text);
    return { vector, model: "minilm" };
}

// Batch embed every chunk with the local MiniLM model.
async function generateBatchEmbeddings(chunks) {
    const results = [];
    for (const chunk of chunks) {
        try {
            const { vector, model } = await generateEmbedding(chunk);
            results.push({ chunk, embedding: vector, model });
        } catch (error) {
            console.error("Embedding error:", error.message);
        }
    }
    return results;
}

// Atomically replace all embeddings for a source (delete+insert in one
// transaction via the replace_embeddings_for_source RPC), so a concurrent
// similarity search never observes the source with zero rows mid-ingestion.
//
// The `embeddings` table/RPC still has separate gemini/minilm vector columns
// (schema left as-is to avoid a migration); since MiniLM is now the only
// embedder, all rows are written to the minilm column and the gemini column
// is always empty.
async function replaceEmbeddingsForSource(source, embeddings) {
    if (!embeddings.length) {
        const { error } = await supabase.from("embeddings").delete().eq("source", source);
        if (error) throw error;
        return;
    }

    const { error } = await supabase.rpc("replace_embeddings_for_source", {
        p_source: source,
        p_chunks: embeddings.map((e) => e.chunk),
        // Sent as vector-literal strings ("[0.1,0.2,...]"), not raw number
        // arrays — PostgREST casts each array element to the SQL param's
        // element type individually, and a bare JSON number can't cast to
        // vector directly (see replace_embeddings_for_source in setup-schema.sql).
        p_embeddings_gemini: [],
        p_embeddings_minilm: embeddings.map((e) => `[${e.embedding.join(",")}]`),
    });

    if (error) throw error;
}

// Vector search against the MiniLM embedding space.
async function similaritySearch(query, k = 5) {
    const vector = Array.isArray(query) ? query : (await generateQueryEmbedding(query)).vector;

    const { data, error } = await supabase.rpc("match_embeddings", {
        query_embedding_gemini: null,
        query_embedding_minilm: vector,
        match_threshold: 0.05,
        match_count: k
    });

    if (error) {
        console.error("Similarity search error:", error);
        throw error;
    }

    return data || [];
}

module.exports = {
    chunkText,
    generateEmbedding,
    generateQueryEmbedding,
    generateBatchEmbeddings,
    replaceEmbeddingsForSource,
    similaritySearch
};
