import { GoogleGenAI } from '@google/genai';
import { GOOGLE_API_KEY } from './config.js';
const EMBEDDING_MODEL = 'gemini-embedding-001';
let client = null;
function getClient() {
    if (client)
        return client;
    if (!GOOGLE_API_KEY) {
        throw new Error('GOOGLE_API_KEY is not set.');
    }
    client = new GoogleGenAI({ apiKey: GOOGLE_API_KEY });
    return client;
}
/**
 * Generate an embedding vector for a text string.
 * Returns a float array (768 dimensions for text-embedding-004).
 */
export async function embedText(text) {
    const ai = getClient();
    const result = await ai.models.embedContent({
        model: EMBEDDING_MODEL,
        contents: text,
    });
    return result.embeddings?.[0]?.values ?? [];
}
/**
 * Cosine similarity between two vectors. Returns -1 to 1.
 */
export function cosineSimilarity(a, b) {
    if (a.length !== b.length || a.length === 0)
        return 0;
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    if (denom === 0)
        return 0;
    return dot / denom;
}
