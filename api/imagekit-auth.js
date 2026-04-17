import ImageKit from '@imagekit/nodejs';

export default async function handler(req, res) {
    // Allow requests from anywhere (for testing)
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    
    if (req.method === "OPTIONS") {
        return res.status(200).end();
    }
    
    // Check environment variables
    if (!process.env.IMAGEKIT_PUBLIC_KEY || !process.env.IMAGEKIT_PRIVATE_KEY || !process.env.IMAGEKIT_URL_ENDPOINT) {
        return res.status(500).json({ 
            error: "ImageKit not configured. Add IMAGEKIT_PUBLIC_KEY, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT to Vercel environment variables." 
        });
    }
    
    try {
        const imagekit = new ImageKit({
            publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
            privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
            urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
        });
        
        // Use helper.getAuthenticationParameters() as per official docs
        const authParams = imagekit.helper.getAuthenticationParameters();
        
        // The helper does NOT return publicKey, so we add it manually
        res.status(200).json({
            signature: authParams.signature,
            token: authParams.token,
            expire: authParams.expire,
            publicKey: process.env.IMAGEKIT_PUBLIC_KEY
        });
    } catch (error) {
        console.error("Auth error:", error);
        res.status(500).json({ error: error.message });
    }
}
