const express = require('express');
const path = require('path');

const app = express();

// Increase JSON payload limit to handle base64 image uploads
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files (index.html, styles, client JS)
app.use(express.static(__dirname));

// Streaming backend proxy endpoint for Gemini API
app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, imageBase64, mimeType } = req.body;
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return res.status(500).json({ error: "Missing API key in environment variables." });
        }

        // Set headers for streaming plain text chunks back to client
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

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
            contents: [{ parts }],
            generationConfig: {
                thinkingConfig: {
                    thinkingBudget: 0 // Set to 0 for ultra-fast stream output
                }
            }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            res.status(response.status);
            res.write(`Error: ${errorData.error?.message || 'Failed to stream response.'}`);
            return res.end();
        }

        // Read stream chunks from Gemini and pipe them directly to the client response
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const rawChunk = decoder.decode(value, { stream: true });

            // Parse Google SSE JSON objects to extract generated text parts
            const lines = rawChunk.split('\n');
            for (const line of lines) {
                if (line.startsWith('[') || line.startsWith(',')) {
                    try {
                        const cleanLine = line.replace(/^[,\[\]]/, '').trim();
                        if (cleanLine) {
                            const parsed = JSON.parse(cleanLine);
                            const textChunk = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (textChunk) {
                                res.write(textChunk);
                            }
                        }
                    } catch (e) {
                        // Skip incomplete JSON lines across chunk boundaries
                    }
                }
            }
        }

        res.end();

    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ error: error.message });
        } else {
            res.write(`\nError: ${error.message}`);
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
