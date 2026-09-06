exports.handler = async (event) => {
    if (event.httpMethod !== "POST") {
        return { statusCode: 405, body: "Method Not Allowed" };
    }

    try {
        const { prompt } = JSON.parse(event.body);
        const API_KEY = process.env.GEMINI_API_KEY || process.env.synapse;

        if (!API_KEY) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: "Missing API key in Netlify environment variables." })
            };
        }

        // Active, supported Flash model fallback endpoints
        const models = [
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite"
        ];

        let lastError = null;

        for (const model of models) {
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{
                            parts: [{ text: prompt }]
                        }]
                    })
                });

                const data = await response.json();

                if (!data.error) {
                    return {
                        statusCode: 200,
                        body: JSON.stringify(data)
                    };
                }

                lastError = data.error.message || `Error calling ${model}`;
                console.warn(`Model ${model} failed:`, lastError);

            } catch (err) {
                lastError = err.message;
            }
        }

        // Catch rate limits cleanly if all models exceed free quota limits
        return {
            statusCode: 429,
            body: JSON.stringify({ 
                error: `Quota exceeded or rate limit reached on Free Tier. Please wait a minute before sending another message. (${lastError})` 
            })
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
