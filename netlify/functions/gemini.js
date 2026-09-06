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

        // Updated array with currently supported active models
        const models = [
            "gemini-3.6-flash",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.0-flash"
        ];

        let lastError = null;

        // Try each model until one succeeds
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

                // If successful
                if (!data.error) {
                    return {
                        statusCode: 200,
                        body: JSON.stringify(data)
                    };
                }

                lastError = data.error.message || `Error calling ${model}`;
                console.warn(`Model ${model} failed, attempting next fallback model. Error:`, lastError);

            } catch (err) {
                lastError = err.message;
                console.warn(`Network failure attempting model ${model}:`, lastError);
            }
        }

        // If all models in the fallback array failed
        return {
            statusCode: 400,
            body: JSON.stringify({ error: `All fallback models failed. Last error: ${lastError}` })
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
