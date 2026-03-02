import { apiRequest } from "./github-api-lib.mjs";

function arg(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1) throw new Error(`Missing ${name}`);
    return process.argv[idx + 1];
}

async function main() {
    const repo = arg("--repo");
    const pr = arg("--pr");
    const body = arg("--body");

    const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!token) throw new Error("Missing GH_TOKEN/GITHUB_TOKEN");

    const url = `https://api.github.com/repos/${repo}/issues/${pr}/comments`;
    const created = await apiRequest("POST", url, token, { body });

    process.stdout.write(
        JSON.stringify(
            {
                comment_id: created?.data?.id || "",
            },
            null,
            2
        )
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
