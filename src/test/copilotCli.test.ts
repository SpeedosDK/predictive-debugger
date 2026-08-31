import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    CopilotCliProvider,
    completeArgs,
    parseVersion
} from "../providers/copilotCli";

describe("parseVersion", () => {
    it("reads the version out of the CLI banner", () => {
        assert.equal(
            parseVersion("GitHub Copilot CLI 1.0.82.\nRun 'copilot update' to check for updates.\n"),
            "1.0.82"
        );
    });

    it("keeps a prerelease suffix", () => {
        assert.equal(parseVersion("GitHub Copilot CLI 1.1.0-beta.2."), "1.1.0-beta.2");
    });

    it("returns undefined when nothing looks like a version", () => {
        assert.equal(parseVersion("copilot: command not found"), undefined);
    });
});

describe("completeArgs", () => {
    it("never puts the prompt on the command line", () => {
        // The prompt carries up to 120 KB of source, well past the command
        // line limit; `-p` would also make the CLI ignore stdin entirely.
        assert.ok(!completeArgs().includes("-p"));
        assert.ok(!completeArgs().includes("--prompt"));
    });

    it("asks for the reply alone, so stdout is the answer", () => {
        assert.ok(completeArgs().includes("--silent"));
        assert.ok(completeArgs().includes("--no-color"));
    });

    it("denies the tools that could act on the untrusted source", () => {
        const args = completeArgs();
        assert.ok(args.includes("--deny-tool=shell,write,url"));
        assert.ok(args.includes("--disable-builtin-mcps"));
    });

    it("passes a model override through and omits it otherwise", () => {
        const args = completeArgs("gpt-5.4");
        assert.deepEqual(args.slice(-2), ["--model", "gpt-5.4"]);
        assert.ok(!completeArgs().includes("--model"));
        assert.ok(!completeArgs("").includes("--model"));
    });
});

describe("CopilotCliProvider.checkAuth", () => {
    const envVars = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] as const;

    /** Run `fn` with only the given auth variables set. */
    function withEnv<T>(values: Partial<Record<string, string>>, fn: () => T): T {
        const saved = new Map(envVars.map((name) => [name, process.env[name]]));
        try {
            for (const name of envVars) {
                delete process.env[name];
            }
            for (const [name, value] of Object.entries(values)) {
                process.env[name] = value;
            }
            return fn();
        } finally {
            for (const [name, value] of saved) {
                if (value === undefined) {
                    delete process.env[name];
                } else {
                    process.env[name] = value;
                }
            }
        }
    }

    it("reports the environment variable the CLI would pick", () => {
        const provider = new CopilotCliProvider();

        for (const name of envVars) {
            const auth = withEnv({ [name]: "token" }, () => provider.checkAuth());
            assert.equal(auth.hasCredentials, true);
            assert.equal(auth.credentialsPath, name);
        }
    });

    it("follows the CLI's precedence when several are set", () => {
        const provider = new CopilotCliProvider();
        const auth = withEnv(
            { GITHUB_TOKEN: "token", GH_TOKEN: "token", COPILOT_GITHUB_TOKEN: "token" },
            () => provider.checkAuth()
        );
        assert.equal(auth.credentialsPath, "COPILOT_GITHUB_TOKEN");
    });

    it("never returns the token itself", () => {
        const provider = new CopilotCliProvider();
        const auth = withEnv({ GH_TOKEN: "ghu_supersecret" }, () => provider.checkAuth());
        assert.ok(!JSON.stringify(auth).includes("ghu_supersecret"));
    });
});
