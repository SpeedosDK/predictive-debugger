import fs from "fs";
import os from "os";
import path from "path";

const isWindows = process.platform === "win32";

function candidateNames(command: string): string[] {
    if (!isWindows) {
        return [command];
    }
    const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
        .split(";")
        .filter(Boolean);
    // Prefer .cmd/.exe over the extensionless shell script npm also drops in.
    return pathext.map((ext) => command + ext.toLowerCase()).concat(command);
}

/**
 * Directories to search in addition to PATH.
 *
 * VS Code extensions inherit the environment of whatever launched the editor,
 * which on macOS (Dock/Spotlight) and Windows (Start menu) often omits the
 * shell rc files that put these on PATH.
 */
function extraSearchDirs(): string[] {
    const home = os.homedir();
    const dirs: string[] = [
        path.join(home, ".local", "bin"),
        path.join(home, ".bun", "bin")
    ];

    if (isWindows) {
        if (process.env.APPDATA) {
            dirs.push(path.join(process.env.APPDATA, "npm"));
        }
        if (process.env.LOCALAPPDATA) {
            dirs.push(path.join(process.env.LOCALAPPDATA, "Programs", "claude"));
        }
    } else {
        dirs.push("/usr/local/bin", "/opt/homebrew/bin");
    }

    return dirs;
}

function isExecutableFile(candidate: string): boolean {
    try {
        if (!fs.statSync(candidate).isFile()) {
            return false;
        }
        if (!isWindows) {
            fs.accessSync(candidate, fs.constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}

/** Resolve `command` against PATH plus the well-known install locations. */
export function which(command: string): string | undefined {
    const pathDirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
    const names = candidateNames(command);

    for (const dir of [...pathDirs, ...extraSearchDirs()]) {
        for (const name of names) {
            const candidate = path.join(dir, name);
            if (isExecutableFile(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

/** True if `file` exists and is a non-empty regular file. */
export function hasNonEmptyFile(file: string): boolean {
    try {
        const stat = fs.statSync(file);
        return stat.isFile() && stat.size > 0;
    } catch {
        return false;
    }
}
