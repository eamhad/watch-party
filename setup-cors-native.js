// Run this ONCE locally to properly configure CORS on your B2 bucket
// via B2's Native API (required since the dashboard already created
// Native CORS rules, which blocks the S3-compatible API from editing them).
//
// Usage:
//   1. Fill in the values below
//   2. node setup-cors.js
// (No extra install needed - uses Node's built-in fetch.)

const B2_KEY_ID = "00541b863bc7cae0000000001";
const B2_APPLICATION_KEY = "K005itMHIxZ18+y82QZ5TPiUIBIEmqM";
const BUCKET_ID = "24e11b8826035b5c97fc0a1e"; // from your bucket's overview page
const ALLOWED_ORIGIN = "https://watch-party-gu80.onrender.com";

async function main() {
    // Step 1: authorize and get the correct API URL for your account
    const authHeader = "Basic " + Buffer.from(`${B2_KEY_ID}:${B2_APPLICATION_KEY}`).toString("base64");

    const authRes = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", {
        headers: { Authorization: authHeader }
    });

    const authData = await authRes.json();

    if (!authRes.ok) {
        console.error("Authorization failed:", authData);
        return;
    }

    const apiUrl = authData.apiInfo.storageApi.apiUrl;
    const accountId = authData.accountId;
    const authToken = authData.authorizationToken;

    // Step 2: set CORS rules with explicit upload permissions
    const updateRes = await fetch(`${apiUrl}/b2api/v3/b2_update_bucket`, {
        method: "POST",
        headers: {
            Authorization: authToken,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            accountId,
            bucketId: BUCKET_ID,
            corsRules: [
                {
                    corsRuleName: "watchPartyUploads",
                    allowedOrigins: [ALLOWED_ORIGIN],
                    allowedOperations: [
                        "b2_upload_file",
                        "b2_upload_part",
                        "b2_download_file_by_name",
                        "b2_download_file_by_id"
                    ],
                    allowedHeaders: ["*"],
                    exposeHeaders: ["ETag"],
                    maxAgeSeconds: 3600
                }
            ]
        })
    });

    const updateData = await updateRes.json();

    if (!updateRes.ok) {
        console.error("Failed to update CORS rules:", updateData);
        return;
    }

    console.log("CORS rules updated successfully:");
    console.log(JSON.stringify(updateData.corsRules, null, 2));
}

main().catch(err => {
    console.error("Unexpected error:", err);
});
