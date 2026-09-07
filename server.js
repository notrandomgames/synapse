const express = require('express');
const path = require('path');

const app = express();

// Handle base64 image uploads
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(__dirname));

// Helper function to pause execution during retries
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Streaming endpoint for Gemini API with 429 Retry Backoff
app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, imageBase64, mimeType } = req.body;
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return res.status(500).json({ error: "Missing GEMINI_API_KEY environment variable." });
        }

        const parts = [];
        if (imageBase64 && mimeType) {
            parts.push({
                inlineData: {
                    mimeType: mimeType,
                    data: imageBase64
                }
            });
        }
        parts.push({ text: prompt || "Analyze this image." });

        const payload = {
            systemInstruction: {
                parts: [{ 
                    text: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, double-check logic step-by-step, and do not invent details." 
                }]
            },
            contents: [{ parts }],
            generationConfig: {
                temperature: 0.1,
                topP: 0.8
            }
        };

        // Active Gemini models
        const models = [
            "gemini-2.5-flash",
            "gemini-1.5-flash",
            "gemini-2.5-flash-lite"
        ];

        let geminiResponse = null;
        let lastError = null;

        // Try models sequentially with backoff retry logic for 429 rate limits
        for (const model of models) {
            let attempts = 0;
            const maxAttempts = 3;

            while (attempts < maxAttempts) {
                try {
                    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${API_KEY}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (resp.ok) {
                        geminiResponse = resp;
                        break;
                    }

                    const status = resp.status;
                    const errText = await resp.text();

                    // If rate-limited (429), pause and retry exponentially (2s, 4s)
                    if (status === 429) {
                        attempts++;
                        lastError = `Rate limit (429) reached on ${model}. Waiting before retry attempt ${attempts}...`;
                        console.warn(lastError);
                        if (attempts < maxAttempts) {
                            await sleep(attempts * 2000); // Exponential wait
                            continue;
                        }
                    }

                    lastError = `Model ${model} (${status}): ${errText}`;
                    console.warn(lastError);
                    break; // Move to next fallback model if non-429 error occurs

                } catch (err) {
                    lastError = `Model ${model} fetch failed: ${err.message}`;
                    console.warn(lastError);
                    break;
                }
            }

            if (geminiResponse) break;
        }

        if (!geminiResponse) {
            return res.status(429).json({ 
                error: "Rate Limit reached. Please wait 30 seconds before sending another prompt." 
            });
        }

        // Set streaming headers after confirming 200 OK
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const reader = geminiResponse.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('data:')) {
                    const jsonStr = trimmed.slice(5).trim();
                    if (jsonStr === '[DONE]') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (textChunk) {
                            res.write(textChunk);
                        }
                    } catch (e) {}
                }
            }
        }

        if (buffer.trim().startsWith('data:')) {
            const jsonStr = buffer.trim().slice(5).trim();
            try {
                const parsed = JSON.parse(jsonStr);
                const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                if (textChunk) {
                    res.write(textChunk);
                }
            } catch (e) {}
        }

        res.end();

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.write(`\n[Stream Error: ${error.message}]`);
            res.end();
        }
    }
});

// Fallback route to serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Synapse server running on port ${PORT}`);
});
