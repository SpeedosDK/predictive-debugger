import fs from "fs";
import path from "path";
import ts from "typescript";

declare const __TYPESCRIPT_LIB_DIR__: string | undefined;

interface TypeDiagnostic {
    code: number;
    message: string;
    file?: string;
    line?: number;
    column?: number;
}

export type TypeCheckResult = {
    compiler: string;
    project: string | null;
} & ({ status: "unavailable"; reason: string } | {
    status: "checked";
    mode: "project" | "inferred";
    checked: string[];
    skipped: Array<{ file: string; reason: string }>;
    diagnostics: TypeDiagnostic[];
    contextIssues: TypeDiagnostic[];
    truncated: boolean;
});

/** Check selected files in their complete project context, without emitting or running code. */
export function checkTypes(options: { files: string[]; project?: string }): TypeCheckResult {
    const files = [...new Set(options.files.map(file => path.resolve(file)))];
    let project: string | null = options.project ? path.resolve(options.project) : null;
    const base = () => ({ compiler: ts.version, project });
    try {
        if (!files.length || files.length > 20) throw new Error("Select between 1 and 20 files.");
        const cache = new Map<string, string | undefined>();
        let bytes = 0;
        let readFailure: string | undefined;
        const readFile = (file: string): string | undefined => {
            const absolute = path.resolve(file);
            if (cache.has(absolute)) return cache.get(absolute);
            let value: string | undefined;
            try {
                const stat = fs.statSync(absolute);
                if (!stat.isFile()) return undefined;
                if (stat.size > 4 * 1024 * 1024) throw new Error(`Compiler input exceeds 4 MB: ${absolute}`);
                if (cache.size >= 1000 || bytes + stat.size > 32 * 1024 * 1024) {
                    throw new Error("Compiler read limit reached: 1,000 files or 32 MB.");
                }
                const descriptor = fs.openSync(absolute, "r");
                try {
                    const buffer = Buffer.alloc(4 * 1024 * 1024 + 1);
                    let length = 0;
                    while (length < buffer.length) {
                        const count = fs.readSync(descriptor, buffer, length, buffer.length - length, null);
                        if (count === 0) break;
                        length += count;
                    }
                    if (length === buffer.length) throw new Error(`Compiler input exceeds 4 MB: ${absolute}`);
                    value = buffer.toString("utf8", 0, length);
                } finally { fs.closeSync(descriptor); }
                bytes += Buffer.byteLength(value);
                if (bytes > 32 * 1024 * 1024) throw new Error("Compiler read limit reached: 32 MB.");
            } catch (error) {
                if (!(error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR"))) {
                    readFailure = error instanceof Error ? error.message : String(error);
                    throw error;
                }
            }
            cache.set(absolute, value);
            return value;
        };
        const nearestProject = (file: string): string | null => {
            let directory = path.dirname(file);
            for (let depth = 0; depth < 64; depth++) {
                for (const name of ["tsconfig.json", "jsconfig.json"]) {
                    const candidate = path.join(directory, name);
                    if (ts.sys.fileExists(candidate)) return candidate;
                }
                const parent = path.dirname(directory);
                if (parent === directory) return null;
                directory = parent;
            }
            throw new Error("Config discovery exceeded 64 parent directories.");
        };
        if (!project) {
            const projects = new Set(files.map(nearestProject));
            if (projects.size !== 1) throw new Error("Selected files belong to different configs; check each project separately.");
            project = projects.values().next().value ?? null;
        }
        let compilerOptions: ts.CompilerOptions = {
            allowJs: true, checkJs: true, strictNullChecks: true, noImplicitThis: true, skipLibCheck: true,
            target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve
        };
        let roots = files;
        if (project) {
            const config = ts.readConfigFile(project, readFile);
            if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, " "));
            const parsed = ts.parseJsonConfigFileContent(config.config, { ...ts.sys, readFile }, path.dirname(project), undefined, project);
            if (parsed.errors.length) throw new Error(parsed.errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, " ")).join("; "));
            if (parsed.projectReferences?.length) throw new Error("Project references are not supported; select a leaf project's config.");
            roots = parsed.fileNames;
            compilerOptions = parsed.options;
        }
        if (roots.length > 1000) throw new Error("Project exceeds the 1,000 root-file limit.");
        if (compilerOptions.noCheck) throw new Error("This project disables semantic checking with noCheck.");
        compilerOptions = { ...compilerOptions, noEmit: true };
        const host = ts.createCompilerHost(compilerOptions);
        host.readFile = readFile;
        host.writeFile = () => { throw new Error("Type checking must not emit files."); };
        const libraryDirectory = typeof __TYPESCRIPT_LIB_DIR__ === "string"
            ? path.resolve(__dirname, __TYPESCRIPT_LIB_DIR__) : path.dirname(ts.getDefaultLibFilePath(compilerOptions));
        host.getDefaultLibFileName = opts => path.join(libraryDirectory, ts.getDefaultLibFileName(opts));
        host.getDefaultLibLocation = () => libraryDirectory;
        const program = ts.createProgram(roots, compilerOptions, host);
        // The compiler catches host read exceptions and turns them into missing
        // source diagnostics. A resource limit must invalidate this check instead.
        if (readFailure) throw new Error(readFailure);
        const diagnostics: TypeDiagnostic[] = [];
        const contextIssues: TypeDiagnostic[] = [];
        let truncated = false;
        const append = (target: TypeDiagnostic[], diagnostic: ts.Diagnostic) => {
            if (diagnostics.length + contextIssues.length >= 100) { truncated = true; return; }
            const position = diagnostic.file && diagnostic.start !== undefined
                ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start) : undefined;
            target.push({ code: diagnostic.code,
                message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, 1000),
                ...(diagnostic.file ? { file: diagnostic.file.fileName } : {}),
                ...(position ? { line: position.line + 1, column: position.character + 1 } : {}) });
        };
        for (const diagnostic of [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics()]) append(contextIssues, diagnostic);
        const contextCodes = new Set([2307, 2503, 2688, 2792, 7016]);
        const selected = new Set(files.map(file => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase()));
        // An unresolved dependency can turn a selected expression into `any`,
        // hiding its errors even when the selected file imports successfully.
        for (const source of program.getSourceFiles()) {
            if (program.isSourceFileDefaultLibrary(source) || selected.has(ts.sys.useCaseSensitiveFileNames
                ? path.resolve(source.fileName) : path.resolve(source.fileName).toLowerCase())) continue;
            for (const diagnostic of program.getSemanticDiagnostics(source)) {
                if (contextCodes.has(diagnostic.code)) append(contextIssues, diagnostic);
            }
        }
        const checked: string[] = [], skipped: Array<{ file: string; reason: string }> = [];
        for (const file of files) {
            const source = program.getSourceFile(file);
            if (!source) { skipped.push({ file, reason: "Not included in the compiler program, or unreadable." }); continue; }
            let directive: boolean | undefined;
            for (const comment of ts.getLeadingCommentRanges(source.text, 0) ?? []) {
                if (comment.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
                const match = source.text.slice(comment.pos, comment.end).match(/^\/\/\s*@ts-(no)?check\b/);
                if (match) directive = !match[1];
            }
            if (directive === false) {
                skipped.push({ file, reason: "File disables semantic checking with @ts-nocheck." }); continue;
            }
            if (/\.[cm]?jsx?$/i.test(file) && !(directive ?? compilerOptions.checkJs)) {
                skipped.push({ file, reason: "JavaScript checking is disabled by this project's settings." }); continue;
            }
            for (const diagnostic of [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)]) {
                append(contextCodes.has(diagnostic.code) ? contextIssues : diagnostics, diagnostic);
            }
            checked.push(file);
        }
        if (readFailure) throw new Error(readFailure);
        return { ...base(), status: "checked", mode: project ? "project" : "inferred", checked, skipped, diagnostics, contextIssues, truncated };
    } catch (error) {
        return { ...base(), status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
    }
}
