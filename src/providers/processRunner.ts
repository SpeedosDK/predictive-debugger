import { spawn } from "child_process";
import path from "path";

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
export function quoteForCmd(arg: string): string {
    // cmd.exe does not honour backslash-escaped quotes, and expands percent
    // variables even inside quotes. Reject these inputs before spawning a shim.
    if (/["%!\r\n\0]/.test(arg)) {
        throw new Error("Unsafe argument for Windows CLI shim: quotes, variable expansion and line breaks are not supported.");
    }
    if (arg.length > 0 && !/[\s"^&|<>()%!]/.test(arg)) {
        return arg;
    }
    // Remaining metacharacters stay inside quotes; preserve trailing slashes
    // for the executable's argument parser.
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
    if (signal?.aborted) return Promise.reject(new Error("Cancelled"));

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
            detached: !isWindows,
            stdio: ["pipe", "pipe", "pipe"]
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let stopping = false;

        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            fn();
        };

        const stop = async (reason: string) => {
            if (settled || stopping) return;
            stopping = true;
            clearTimeout(timer);
            try {
                if (child.pid !== undefined) await killProcessTree(child.pid);
            } catch (err) {
                reason += `; process cleanup failed: ${err instanceof Error ? err.message : String(err)}`;
            } finally {
                child.stdin.destroy();
                child.stdout.destroy();
                child.stderr.destroy();
                finish(() => reject(new Error(reason)));
            }
        };

        const timer = setTimeout(() => {
            void stop(`CLI timed out after ${timeoutMs}ms: ${file}`);
        }, timeoutMs);

        const onAbort = () => {
            void stop("Cancelled");
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
        child.on("close", (code) => {
            if (!stopping) finish(() => resolve({ code, stdout, stderr }));
        });

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

async function killProcessTree(pid: number): Promise<void> {
    if (!isWindows) {
        try {
            process.kill(-pid, "SIGKILL");
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
        }
        return;
    }
    // Killing only cmd.exe leaves the CLI running. Use the Windows tree killer
    // directly, with a numeric PID and no shell or PATH-based executable lookup.
    const taskkill = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe");
    await new Promise<void>((resolve, reject) => {
        const killer = spawn(taskkill, ["/pid", String(pid), "/t", "/f"], {
            windowsHide: true, stdio: "ignore"
        });
        const timer = setTimeout(() => {
            killer.kill();
            reject(new Error("taskkill timed out"));
        }, 10_000);
        killer.on("error", err => { clearTimeout(timer); reject(err); });
        killer.on("close", code => {
            clearTimeout(timer);
            if (code === 0 || code === 128) resolve();
            else reject(new Error(`taskkill exited with code ${code}`));
        });
    });
}
