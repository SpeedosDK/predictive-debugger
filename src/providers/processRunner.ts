import { spawn } from "child_process";

export interface RunResult {
    code: number | null;
    stdout: string;
    stderr: string;
}

export interface RunOptions {
    file: string;
    args: string[];
    /** Written to the child's stdin, then stdin is closed. */
    input?: string;
    cwd?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
}

const isWindows = process.platform === "win32";

/** Quote a single argument for cmd.exe when using windowsVerbatimArguments. */
function quoteForCmd(arg: string): string {
    if (arg.length > 0 && !/[\s"^&|<>()%!]/.test(arg)) {
        return arg;
    }
    // Escape embedded quotes, then wrap. cmd.exe metacharacters are neutralised
    // by the surrounding quotes.
    return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
}

/**
 * Spawn a CLI and collect its output.
 *
 * npm installs `claude` and `codex` on Windows as `.cmd` shims, which Node
 * refuses to spawn directly since the CVE-2024-27980 fix. We route those
 * through cmd.exe ourselves rather than using `shell: true`, so that we control
 * the quoting instead of letting Node build the command line.
 */
export function runProcess(options: RunOptions): Promise<RunResult> {
    const { file, args, input, cwd, timeoutMs = 120_000, signal, env } = options;

    let spawnFile = file;
    let spawnArgs = args;
    let verbatim = false;

    if (isWindows && /\.(cmd|bat)$/i.test(file)) {
        const comspec = process.env.ComSpec || "cmd.exe";
        const commandLine = [file, ...args].map(quoteForCmd).join(" ");
        spawnFile = comspec;
        spawnArgs = ["/d", "/s", "/c", `"${commandLine}"`];
        verbatim = true;
    }

    return new Promise((resolve, reject) => {
        const child = spawn(spawnFile, spawnArgs, {
            cwd,
            env: env ?? process.env,
            windowsHide: true,
            windowsVerbatimArguments: verbatim,
            stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            fn();
        };

        const kill = () => {
            // On Windows the shim spawns a child of its own; SIGTERM to the
            // group is the best we can do without a process-tree killer.
            child.kill(isWindows ? "SIGTERM" : "SIGTERM");
        };

        const timer = setTimeout(() => {
            kill();
            finish(() =>
                reject(new Error(`CLI timed out after ${timeoutMs}ms: ${file}`))
            );
        }, timeoutMs);

        const onAbort = () => {
            kill();
            finish(() => reject(new Error("Cancelled")));
        };

        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener("abort", onAbort, { once: true });
        }

        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });

        child.on("error", (err) => finish(() => reject(err)));
        child.on("close", (code) =>
            finish(() => resolve({ code, stdout, stderr }))
        );

        if (child.stdin) {
            child.stdin.on("error", () => {
                /* the CLI may close stdin early; not fatal */
            });
            if (input !== undefined) {
                child.stdin.write(input, "utf8");
            }
            child.stdin.end();
        }
    });
}
