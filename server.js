const express = require('express');
const path = require('path');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

app.post('/api/gemini', async (req, res) => {
    try {
        const { prompt, history } = req.body;

        // Your Groq key stored in the "synapse" environment variable
        const rawKeys = process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || process.env.synapse || "";
        const apiKeys = rawKeys.split(',').map(k => k.trim()).filter(Boolean);

        if (apiKeys.length === 0) {
            return res.status(500).json({ error: "Missing Groq API keys environment variable." });
        }

        const messages = [
            { role: "system", content: "You are an authoritative, concise, and helpful AI assistant." }
        ];

        // Keep the last 4 messages to balance memory and token usage
        const recentHistory = Array.isArray(history) ? history.slice(-4) : [];
        
        recentHistory.forEach(h => {
            messages.push({
                role: h.role === 'model' ? 'assistant' : 'user',
                content: h.parts?.[0]?.text || ""
            });
        });
        messages.push({ role: "user", content: prompt || "Hello" });

        // Using Groq models with the HIGHEST free-tier Token-Per-Minute (TPM) limits
        const models = [
            "meta-llama/llama-4-scout-17b-16e-instruct", // 30,000 TPM limit
            "groq/compound",                             // 70,000 TPM limit
            "llama-3.1-8b-instant"                       // 6,000 TPM limit (absolute last resort)
        ];

        let streamedResponse = null;
        let lastError = "";

        keyLoop:
        for (const key of apiKeys) {
            for (const model of models) {
                try {
                    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${key}`
                        },
                        body: JSON.stringify({
                            model: model,
                            messages: messages,
                            temperature: 0.1,
                            stream: true,
                            max_tokens: 1024
                        })
                    });

                    if (resp.ok) {
                        streamedResponse = resp;
                        console.log(`[Success] Connected via Groq using ${model}.`);
                        break keyLoop;
                    }
                    
                    const errText = await resp.text();
                    lastError = `Model ${model} rejected the request: ${errText}`;
                    console.warn(lastError);
                    
                } catch (err) {
                    lastError = err.message;
                    console.warn(`[Groq Warning]:`, err.message);
                }
            }
        }

        if (!streamedResponse) {
            // Spitting out the ACTUAL error from Groq so we stop guessing
            return res.status(429).json({ 
                error: `Groq Connection Failed. Details: ${lastError}` 
            });
        }

        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Transfer-Encoding', 'chunked');

        const reader = streamedResponse.body.getReader();
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
