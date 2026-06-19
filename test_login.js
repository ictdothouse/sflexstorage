const axios = require('axios');

async function testFullFlow() {
    try {
        // 1. Login
        console.log("=== 1. LOGIN ===");
        const loginRes = await axios.post('http://localhost:3002/api/auth/login', {
            username: 'testuser123',
            password: 'password123'
        });
        
        console.log("Login success:", loginRes.data.user.username);
        const cookies = loginRes.headers['set-cookie'];
        console.log("Set-Cookie header:", cookies);
        
        const cookie = cookies[0].split(';')[0]; // just the session cookie
        console.log("Cookie to send:", cookie);

        // 2. Check /api/auth/me with cookie
        console.log("\n=== 2. CHECK /api/auth/me ===");
        const meRes = await axios.get('http://localhost:3002/api/auth/me', {
            headers: { Cookie: cookie }
        });
        console.log("Auth response:", JSON.stringify(meRes.data));

        // 3. Check /api/cart/count
        console.log("\n=== 3. CHECK /api/cart/count ===");
        const cartRes = await axios.get('http://localhost:3002/api/cart/count', {
            headers: { Cookie: cookie }
        });
        console.log("Cart response:", JSON.stringify(cartRes.data));

        // 4. Try without cookie
        console.log("\n=== 4. CHECK /api/auth/me WITHOUT cookie ===");
        const meRes2 = await axios.get('http://localhost:3002/api/auth/me');
        console.log("Auth response without cookie:", JSON.stringify(meRes2.data));

        // 5. Now simulate browser - fetch the gallery page
        console.log("\n=== 5. FETCH /gallery page with cookie ===");
        const galleryRes = await axios.get('http://localhost:3002/gallery', {
            headers: { Cookie: cookie }
        });
        console.log("Gallery page status:", galleryRes.status);
        console.log("Gallery page content-type:", galleryRes.headers['content-type']);
        // Check if page loads app.js
        const hasAppJs = galleryRes.data.includes('app.js');
        const hasUtilsJs = galleryRes.data.includes('utils.js');
        console.log("Has app.js reference:", hasAppJs);
        console.log("Has utils.js reference:", hasUtilsJs);

        // 6. Fetch utils.js to check credentials: 'include'
        console.log("\n=== 6. CHECK utils.js content ===");
        const utilsRes = await axios.get('http://localhost:3002/js/utils.js');
        const hasCredentials = utilsRes.data.includes("credentials: 'include'") || utilsRes.data.includes('credentials: "include"');
        console.log("utils.js has credentials:include:", hasCredentials);
        
        // Show the relevant fetch line
        const fetchLine = utilsRes.data.split('\n').filter(l => l.includes('fetch') || l.includes('credentials'));
        console.log("Fetch/credentials lines:", fetchLine);

    } catch (err) {
        console.error("Test failed:", err.response ? err.response.data : err.message);
    }
}

testFullFlow();
