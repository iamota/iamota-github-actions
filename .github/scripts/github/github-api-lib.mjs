import https from "node:https";

export async function apiRequest(method, url, token, bodyObj) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = bodyObj ? JSON.stringify(bodyObj) : null;

        const req = https.request(
            {
                method,
                hostname: u.hostname,
                path: u.pathname + u.search,
                headers: {
                    Authorization: `Bearer ${token}`,
                    "User-Agent": "iamota-github-actions",
                    Accept: "application/vnd.github+json",
                    ...(payload
                        ? {
                              "Content-Type": "application/json",
                              "Content-Length": Buffer.byteLength(payload),
                          }
                        : {}),
                },
            },
            (res) => {
                let data = "";
                res.on("data", (c) => (data += c));
                res.on("end", () => {
                    const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
                    const parsed = data ? JSON.parse(data) : {};
                    if (ok) {
                        resolve({ data: parsed, headers: res.headers, statusCode: res.statusCode || 0 });
                    } else {
                        reject(new Error(`GitHub API ${res.statusCode}: ${data}`));
                    }
                });
            }
        );

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function nextLink(linkHeader) {
    const raw = String(linkHeader || "");
    if (!raw) return "";
    const parts = raw.split(",").map((s) => s.trim());
    for (const p of parts) {
        const m = p.match(/^<([^>]+)>;\s*rel="([^"]+)"$/);
        if (m && m[2] === "next") return m[1];
    }
    return "";
}

export async function paginateGet(startUrl, token) {
    let url = startUrl;
    const out = [];

    while (url) {
        const { data, headers } = await apiRequest("GET", url, token);
        if (Array.isArray(data)) out.push(...data);
        url = nextLink(headers.link);
    }

    return out;
}
