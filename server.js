const express = require('express');
const path = require('path');
const rateLimit = require('express-rate-limit');

const app = express();

// Required when hosted behind proxies on platforms like Render or Vercel
app.set('trust proxy', 1);

// Increase JSON payload limit for base64 images
app.use(express.json({ limit: '10mb' }));

// Serve static frontend files
app.use(express.static(__dirname));

// Rate Limiter: Max 5 requests per 1 minute per IP address
const geminiApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 5, // Limit each IP to 5 requests per window
    message: { 
        error: "Too many requests from this device. Please wait 1 minute before sending another prompt." 
    },
    standardHeaders: true,
    legacyHeaders: false,
});

// Stream endpoint protected by rate limiter
app.post('/api/gemini', geminiApiLimiter, async (req, res) => {
    try {
        const { prompt, history, imageBase64, mimeType } = req.body;

        // Optional: App Passcode Lock (uncomment if you set APP_PASSCODE in environment)
        /*
        const userPasscode = req.headers['x-app-passcode'];
        const REQUIRED_PASSCODE = process.env.APP_PASSCODE;
        if (REQUIRED_PASSCODE && userPasscode !== REQUIRED_PASSCODE) {
            return res.status(401).json({ error: "Unauthorized: Invalid App Passcode." });
        }
        */

        const rawKeys = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || process.env.synapse || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

        if (apiKeys.length === 0) {
            return res.status(500).json({ error: "Missing GEMINI_API_KEYS environment variable." });
        }

        const contents = Array.isArray(history) ? [...history] : [];
        const currentParts = [];

        if (imageBase64 && mimeType) {
            currentParts.push({
                inlineData: { mimeType, data: imageBase64 }
            });
        }
        currentParts.push({ text: prompt || "Analyze this image." });
        contents.push({ role: 'user', parts: currentParts });

        // High-accuracy API configuration (Grounding removed to conserve quota)
        const payload = {
            systemInstruction: {
                parts: [{ 
                    text: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, verify reasoning step-by-step, and explicitly state when you are uncertain." 
                }]
            },
            contents: contents,
            generationConfig: {
                temperature: 0.1, // Low temperature minimizes hallucinations
                topP: 0.8
            }
        };

        const models = [
            "gemini-2.5-flash",
            "gemini-1.5-flash",
            "gemini-2.5-flash-lite"
        ];

        let geminiResponse = null;
        let lastError = "";

        keyLoop:
        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const currentKey = apiKeys[keyIndex];

            for (const model of models) {
                try {
                    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${currentKey}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });

                    if (resp.ok) {
                        geminiResponse = resp;
                        console.log(`[Success] Key #${keyIndex + 1} connected via ${model}`);
                        break keyLoop;
                    }

                    const status = resp.status;
                    const errText = await resp.text();
                    lastError = `Key #${keyIndex + 1} on ${model} [${status}]: ${errText}`;
                    console.warn(`[API Warning] ${lastError}`);

                    if (status === 429) {
                        // Pause 1.5s before key switch to avoid rapid multi-burst triggers
                        await new Promise(r => setTimeout(r, 1500));
                        break; 
                    }
                } catch (err) {
                    console.error(`[Fetch Error] Key #${keyIndex + 1} on ${model}: ${err.message}`);
                    lastError = err.message;
                }
            }
        }

        if (!geminiResponse) {
            console.error(`[Failure] All keys failed. Last error: ${lastError}`);
            return res.status(429).json({ 
                error: "All provided API keys have temporarily reached their free tier quota. Please wait 30 seconds." 
            });
        }

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
                        if (textChunk) res.write(textChunk);
                    } catch (e) {}
                }
            }
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

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Synapse server running on port ${PORT}`));
