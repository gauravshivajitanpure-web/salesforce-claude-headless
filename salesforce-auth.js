import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const CLIENT_ID = process.env.SF_CLIENT_ID;
const ORG_TYPE = (process.env.SF_ORG_TYPE || "sandbox").toLowerCase();

if (!CLIENT_ID) {
    console.error("SF_CLIENT_ID is not set.");
    process.exit(1);
}

const LOGIN_BASE =
    ORG_TYPE === "production"
        ? "https://login.salesforce.com"
        : "https://test.salesforce.com";

const REDIRECT_URI = "http://localhost:8787/callback";
const SCOPE = "mcp_api api refresh_token";

const verifier = crypto.randomBytes(64).toString("base64url");

const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64url");

const state = crypto.randomBytes(24).toString("hex");

const authUrl = new URL(`${LOGIN_BASE}/services/oauth2/authorize`);

authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", challenge);
authUrl.searchParams.set("code_challenge_method", "S256");

const tokenDirectory = path.join(
    process.env.LOCALAPPDATA || process.cwd(),
    "salesforce-headless-bridge"
);

const tokenFile = path.join(tokenDirectory, "tokens.json");

const server = http.createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url, REDIRECT_URI);

        if (requestUrl.pathname !== "/callback") {
            res.writeHead(404);
            res.end("Not Found");
            return;
        }

        const returnedState = requestUrl.searchParams.get("state");
        const code = requestUrl.searchParams.get("code");
        const error = requestUrl.searchParams.get("error");

        if (error) {
            throw new Error(
                `${error}: ${
                    requestUrl.searchParams.get("error_description") || ""
                }`
            );
        }

        if (returnedState !== state) {
            throw new Error("OAuth state mismatch.");
        }

        if (!code) {
            throw new Error("Salesforce did not return an authorization code.");
        }

        const body = new URLSearchParams({
            grant_type: "authorization_code",
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            code,
            code_verifier: verifier
        });

        const tokenResponse = await fetch(
            `${LOGIN_BASE}/services/oauth2/token`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/x-www-form-urlencoded"
                },
                body
            }
        );

        const tokenData = await tokenResponse.json();

        if (!tokenResponse.ok) {
            throw new Error(JSON.stringify(tokenData));
        }

        await fs.mkdir(tokenDirectory, { recursive: true });

        await fs.writeFile(
            tokenFile,
            JSON.stringify(
                {
                    ...tokenData,
                    client_id: CLIENT_ID,
                    org_type: ORG_TYPE,
                    login_base: LOGIN_BASE,
                    saved_at: new Date().toISOString()
                },
                null,
                2
            ),
            "utf8"
        );

        res.writeHead(200, {
            "Content-Type": "text/html"
        });

        res.end(`
            <html>
                <body style="font-family:Arial;padding:40px">
                    <h2>Salesforce connected successfully.</h2>
                    <p>You can close this browser window.</p>
                </body>
            </html>
        `);

        console.log("");
        console.log("Salesforce OAuth successful.");
        console.log(`Tokens saved to: ${tokenFile}`);

        if (tokenData.refresh_token) {
            console.log("Refresh token received.");
        } else {
            console.log("WARNING: No refresh token was returned.");
        }

        server.close();
    } catch (err) {
        console.error("OAuth failed:", err);

        res.writeHead(500, {
            "Content-Type": "text/plain"
        });

        res.end(`OAuth failed: ${err.message}`);

        server.close();
    }
});

server.listen(8787, "127.0.0.1", () => {
    console.log("Waiting for Salesforce OAuth callback...");
    console.log("");
    console.log("Opening Salesforce login:");
    console.log(authUrl.toString());
    console.log("");

    try {
        const child = spawn(
            "rundll32.exe",
            [
                "url.dll,FileProtocolHandler",
                authUrl.toString()
            ],
            {
                detached: true,
                stdio: "ignore"
            }
        );

        child.unref();
    } catch {
        console.log(
            "Browser did not open automatically. Copy the URL above into your browser."
        );
    }
});