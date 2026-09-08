const express = require('express');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, history } = req.body;

        const rawKeys = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || process.env.synapse || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

        if (apiKeys.length === 0) {
            return res.status(500).json({ error: "Missing Groq API keys environment variable." });
        }

        const messages = [
            { role: "system", content: "You are an authoritative, helpful, and highly accurate AI assistant. State facts clearly, verify reasoning step-by-step, and explicitly state when you are uncertain." }
        ];

        // TRUNCATE HISTORY: Keep only the last 6 messages to prevent hitting Tokens Per Minute (TPM) limits
        const recentHistory = Array.isArray(history) ? history.slice(-6) : [];

        recentHistory.forEach(h => {
            messages.push({
                role: h.role === 'model' ? 'assistant' : 'user',
                content: h.parts?.[0]?.text || ""
            });
        });

        messages.push({ role: "user", content: prompt || "Hello" });

        // Models prioritized by high-throughput TPM limits on free tier
        const models = [
            "llama-3.1-8b-instant",
            "llama-3.3-70b-versatile"
        ];

        let groqResponse = null;
        let lastError = "";

        keyLoop:
        for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
            const currentKey = apiKeys[keyIndex];

            for (const model of models) {
                try {
                    const payload = {
                        model: model,
                        messages: messages,
                        temperature: 0.1,
                        stream: true,
                        max_tokens: 2048 // Prevents overly runaway generation outputs
                    };

                    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${currentKey}`
                        },
                        body: JSON.stringify(payload)
                    });

                    if (resp.ok) {
                        groqResponse = resp;
                        console.log(`[Groq Success] Connected via ${model}`);
                        break keyLoop;
                    }

                    const status = resp.status;
                    const errText = await resp.text();
                    lastError = `Model ${model} [${status}]: ${errText}`;
                    console.warn(`[Groq Warning] ${lastError}`);

                    if (status === 429) {
                        // Pause 3 seconds to let Groq's token-per-minute window clear
                        await new Promise(r => setTimeout(r, 3000));
                    }
                } catch (err) {
                    console.error(`[Groq Fetch Error] ${err.message}`);
                    lastError = err.message;
                }
            }
        }

        if (!groqResponse) {
            console.error(`[Failure] Rate limit hit across all options. Last error: ${lastError}`);
            return res.status(429).json({ 
                error: "Groq rate limit reached. Please wait 10-15 seconds before sending another message." 
            });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const reader = groqResponse.body.getReader();
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
                        const textChunk = parsed.choices?.[0]?.delta?.content;
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
