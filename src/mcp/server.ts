import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeFile } from "../core/analysis/risk";
import { analyzeLogs } from "../core/logs/analyzeLogs";
import {
    actionableFindings,
    assessmentStatus,
    isActionablePrediction,
    MIN_ACTIONABLE_SCORE,
    predictionStatus
} from "../core/prediction/confidence";
import { predictFile } from "../core/prediction/predictFile";
import { DEFAULT_CONCURRENCY, predictFiles } from "../core/prediction/predictFiles";
import { collectSourceFiles, isTestFile } from "../core/sourceFiles";
import { FilePrediction } from "../core/types";
import { ProviderRegistry } from "../providers/registry";
import { ProviderId } from "../providers/types";

/**
 * Injected by esbuild from package.json. Declared rather than imported because
 * the tsc build in `out/` emits no JSON; `typeof` on an undeclared name is safe
 * in JavaScript, so the fallback applies there instead of throwing.
 */
declare const __PACKAGE_VERSION__: string | undefined;

const registry = new ProviderRegistry();

/**
 * Advertised once at initialize, so a session pays for this prose one time
 * rather than per call, and a client that ignores the field pays nothing.
 *
 * The verification rule ships here rather than being left to the calling
 * agent's judgement because that judgement is the thing it corrects. An agent
 * that has just written code is the worst-placed reader of it: the reasoning
 * that made the code look right is still in its context, so a second look from
 * the same seat re-derives the first one instead of testing it. Leaving the
 * rule to each user's own project instructions means only the users who
 * already knew about the failure mode get the benefit.
 *
 * The trigger is "you pointed these tools at your own recent work", not "you
 * fixed a finding". The contamination argument never depended on the change
 * being a fix, and scoping it to fixes left out the case that needs it most:
 * new feature code, where a clean `predict_failures` reply reads as a
 * clearance and is not one. It stays anchored to an invocation of this server
 * so the rule cannot fire on work the tools were never shown.
 *
 * Routing exists because the two outside seats are not interchangeable and do
 * not cost the same. `predict_failures` is already a second model, but it
 * reads each file on its own; a sub-agent can be told what was being attempted
 * and can read across files, and pays to rebuild context. Sending every change
 * to the expensive seat is what gets a rule like this switched off, so the
 * cheap seat is the default and the sub-agent is kept for the checks the cheap
 * seat structurally cannot perform.
 *
 * File count is the gate because it is the only part of this that is checkable.
 * An earlier version also sent "anything whose correctness depends on what was
 * asked for" to the sub-agent, which sounds narrow and is not: every feature
 * exists to satisfy an ask, so the clause was true of essentially all
 * non-trivial work and quietly made the expensive seat the default for it.
 * Whether a change crosses a file boundary is a fact about the diff that an
 * agent cannot argue itself past, and it tracks the one thing the cheap seat
 * genuinely cannot do -- see whether two files still agree.
 *
 * That the sub-agent earns its cost is still an argument rather than a result.
 * The benchmark measures review of code the reviewer did not write, which is
 * the one setting where the contamination this rule exists to correct cannot
 * occur, so it can price the sub-agent but not value it. Until that changes,
 * the trigger is kept as narrow as the argument supports.
 *
 * The batching clause is here because measurement put the wall-clock cost
 * somewhere other than where this comment used to assume. It read the
 * sub-agent as the thing that made a review slow; the benchmark found the
 * opposite. A sub-agent arm ran at about the wall-clock of an agent reading
 * the same files, while the tool arm ran several times longer -- not because
 * a verdict is slow, but because an agent asked for one file at a time and
 * paid the provider's latency once per file, in series. `files` collapses
 * that back to a single wait, which is worth more than any advice about when
 * to spawn.
 *
 * The background clause is about wall-clock, not tokens, and survives that
 * correction: a blocking sub-agent still adds its wait to the turn a user is
 * watching. The review is a second opinion on work already done rather than a
 * gate, so nothing downstream needs to wait.
 *
 * It is a floor, not a ceiling. "At minimum" leaves the agent free to verify
 * more often than the rule requires, and the mechanical-fix exemption is what
 * stops it from doubling the cost of correcting a typo.
 */
const INSTRUCTIONS = [
    "Deterministic tools first: scan_project and analyze_file cost nothing and answer most " +
        "questions about where the risk sits. predict_failures spawns a second model, so call " +
        "it when you want a verdict independent of your own.",
    "When you point these tools at code you wrote in this session -- a fix for something they " +
        "flagged, or a feature you just finished -- have it checked from outside the context " +
        "that wrote it. Re-reading your own work in the context that produced it is the " +
        "weakest check available, because the reasoning that made it look right is still in " +
        "scope and tends to confirm itself.",
    "Which outside seat depends on how far the change reaches. A change confined to one file, " +
        "including a whole feature in one file: a fresh predict_failures on it, a second model " +
        "for one call. A change spanning several files: a sub-agent where the host has them, " +
        "because predict_failures reads each file on its own and never sees how they have to " +
        "agree. File count is the test -- not how large the change felt, and not whether it " +
        "was a fix or a feature. A clean predict_failures on new code is not a clearance -- it " +
        "means the file is locally sound, not that the feature is right.",
    "Reviewing more than one file: pass them all as `files` in a single predict_failures call. " +
        "The verdicts are independent and run concurrently, so a batch bills the same as the " +
        "same files one at a time and returns in roughly the time of the slowest one. Calling " +
        "once per file pays that wait again for every file and is the main reason this tool " +
        "feels slow.",
    "Scope the sub-agent: give it the changed files and what you were trying to do, and ask " +
        "it to review only that. An unscoped agent rebuilds the project from cold and reports " +
        "on code nobody touched, which is what makes this expensive. Where the host can run it " +
        "in the background, do not block on it: this is a second opinion on work already " +
        "done, not a gate the next step waits behind. Do this at minimum for actionable " +
        "findings and for changes that span files, and use your judgement above that. A " +
        "mechanical fix -- a typo, a missing await, an off-by-one with one correct value -- " +
        "needs neither seat."
].join("\n\n");

const server = new McpServer(
    {
        name: "predictive-debugger",
        version: typeof __PACKAGE_VERSION__ === "string" ? __PACKAGE_VERSION__ : "0.0.0-dev"
    },
    { instructions: INSTRUCTIONS }
);

/**
 * Serialise a reply, compactly.
 *
 * The reader is a model, and every space and newline in the indentation is
 * billed to it. Two-space indent cost 46 of the 161 tokens in a typical
 * `predict_failures` reply -- 29% of the response, spent entirely on making the
 * raw transcript pleasant for a human who is not the audience. Pretty-printing
 * an array is the worst of it: `checked` puts each pattern id on its own
 * indented line, which is most of what the coverage field appeared to cost when
 * it was added.
 *
 * This is the whole point of the tool. It is worth calling instead of reading
 * the file only while the answer is much smaller than the file, so the
 * response budget is the product, not a detail of it.
 */
function json(value: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** Two decimals is all the precision these heuristics have, and it is shorter. */
function round(value: number): number {
    return Math.round(value * 100) / 100;
}

function failure(message: string) {
    return {
        content: [{ type: "text" as const, text: message }],
        isError: true
    };
}

/* ------------------------------------------------------------------ *
 * Deterministic tools: no model call, no credentials, milliseconds.
 * These are the ones a reviewing agent should reach for.
 * ------------------------------------------------------------------ */

server.registerTool(
    "analyze_file",
    {
        title: "Analyze one source file",
        description:
            "Return static complexity metrics and a heuristic risk score (0-1) for a single " +
            "JavaScript or TypeScript file. Deterministic and fast — no model call. " +
            "Call this when reviewing a file to find out where the structural risk sits " +
            "(nested loops, long functions, async boundaries, unguarded mutation) before " +
            "reading the whole file yourself.",
        inputSchema: {
            file: z.string().describe("Absolute path to a .js/.jsx/.ts/.tsx file")
        }
    },
    async ({ file }) => {
        try {
            return json(await analyzeFile(path.resolve(file)));
        } catch (err) {
            return failure(`Could not analyze ${file}: ${message(err)}`);
        }
    }
);

server.registerTool(
    "scan_project",
    {
        title: "Rank a project's files by risk",
        description:
            "Walk a directory and rank its JavaScript/TypeScript files by risk density — " +
            "how concentrated the failure-prone code is, not how big the file is. " +
            "Test files are left out by default; pass includeTests to rank them too. " +
            "Deterministic and fast — no model call. " +
            "Call this at the start of a code review to decide which files are worth your " +
            "attention, instead of reading the tree in arbitrary order.",
        inputSchema: {
            directory: z.string().describe("Absolute path to the directory to scan"),
            limit: z
                .number()
                .int()
                .positive()
                .max(500)
                .optional()
                .describe("Maximum number of files to return (default 50)"),
            verbose: z
                .boolean()
                .optional()
                .describe("Include the raw metric counts for every file (default false)"),
            includeTests: z
                .boolean()
                .optional()
                .describe(
                    "Rank test files too — *.spec.*, *.test.*, and anything under " +
                        "__tests__/test/tests/spec/__mocks__ (default false). They rank high " +
                        "for a structural reason rather than a real one: mocked awaits read " +
                        "as async complexity. Turn this on to audit a suite's own complexity."
                )
        }
    },
    async ({ directory, limit, verbose, includeTests }) => {
        try {
            const root = path.resolve(directory);
            const walked = await collectSourceFiles(root);
            // Filtered here rather than inside the walker so that the walker
            // keeps one behaviour for both surfaces: the VS Code project run
            // still covers tests, where a human asked for the whole workspace
            // and is not paying per file read. Only this ranking, which exists
            // to spend an agent's reading budget, opts out. One walk either
            // way, so the count below is exact rather than a second pass.
            const files = includeTests
                ? walked
                : walked.filter((file) => !isTestFile(path.relative(root, file)));
            const excludedTests = walked.length - files.length;
            const analyses = await Promise.all(
                files.map((file) =>
                    analyzeFile(file).catch((err) => ({
                        file,
                        error: message(err)
                    }))
                )
            );

            // Ranked by density rather than by the size-driven total: the agent
            // pays per token, so "most risk per line read" is the ordering that
            // spends its budget best. See bench/RESULTS.md section 5.
            const ranked = analyses
                .filter((entry): entry is Awaited<ReturnType<typeof analyzeFile>> => "riskScore" in entry)
                .sort((a, b) => b.riskDensity - a.riskDensity)
                .slice(0, limit ?? 50);

            return json({
                scanned: files.length,
                returned: ranked.length,
                orderedBy: "riskDensity",
                // Only when something was actually withheld: silence would
                // leave a caller wondering why the spec file it expected to
                // see is missing, and a zero would cost every other reply.
                ...(excludedTests > 0 ? { excludedTests } : {}),
                // Paths are echoed relative to the scanned root and the metric
                // counts are dropped by default: this output lands whole in the
                // caller's context, and the same numbers are already spelled out
                // in `signals`.
                files: ranked.map((entry) => ({
                    file: path.relative(root, entry.file).replace(/\\/g, "/"),
                    riskDensity: round(entry.riskDensity),
                    riskScore: round(entry.riskScore),
                    lines: entry.metrics.lines,
                    signals: entry.signals,
                    ...(verbose ? { metrics: entry.metrics } : {}),
                    ...(entry.parseError ? { parseError: entry.parseError } : {})
                }))
            });
        } catch (err) {
            return failure(`Could not scan ${directory}: ${message(err)}`);
        }
    }
);

server.registerTool(
    "analyze_logs",
    {
        title: "Find anomalous log lines",
        description:
            "Score a log file's lines by severity and how unusual their wording is, and " +
            "return the anomalies, worst first. Deterministic — no model call, no API key. " +
            "Call this when you have a log file and want the handful of lines worth reading " +
            "rather than the whole file.",
        inputSchema: {
            logFile: z.string().describe("Absolute path to the log file"),
            threshold: z
                .number()
                .min(0)
                .max(1)
                .optional()
                .describe("Anomaly score cutoff, 0-1 (default 0.5)")
        }
    },
    async ({ logFile, threshold }) => {
        const result = await analyzeLogs({
            logPath: path.resolve(logFile),
            threshold
        });
        return result.skipped ? failure(result.skipped) : json(result);
    }
);

/* ------------------------------------------------------------------ *
 * Model-backed tool. Spawns the Claude/Codex/Copilot CLI, so it is slow and
 * billed. An agent calling this is asking a second model to do work it
 * could do itself — hence the explicit "only if" in the description.
 * ------------------------------------------------------------------ */

/**
 * The per-file body of a `predict_failures` reply.
 *
 * Shared by the single-file and batch shapes so the two cannot drift. Whatever
 * a caller learns about one file, it learns in the same fields whether it asked
 * about one file or ten — the only difference between the shapes is that a
 * batch nests these under `results` and hoists the advice that is identical for
 * every entry.
 */
function predictionBody(
    file: string,
    result: FilePrediction,
    options: { verbose?: boolean; logFile?: string }
) {
    // The point of this tool is to cost the caller less context than
    // reading the file would. Measured on bench/corpus, the verdict is
    // about a fifth of the response: the rest was the metric block, a
    // log stanza saying log analysis was not requested, and the absolute
    // path the caller had just supplied. All three are now opt-in, which
    // moves the break-even point down to files of roughly 70 tokens.
    const { findings, truncated, checked } = result.ai;
    const [top, ...rest] = findings;

    return {
        // Echoed as given rather than resolved: shorter, and the caller
        // already knows which file it asked about.
        file,
        // The top finding stays at the top level whatever the mode. A
        // caller that asked one question gets one answer, and the array
        // is there for the caller that asked for the list.
        pattern: top.pattern,
        score: top.score,
        line: top.line ?? null,
        reason: top.reason,
        status: assessmentStatus(result.ai),
        actionable: isActionablePrediction(top),
        // Emitted when there is more than one finding even if `multi`
        // was not set: a model that volunteers a second demonstrable
        // defect has done work, and dropping it silently would be the
        // one-per-file behaviour this replaced.
        ...(rest.length > 0
            ? {
                  findings: findings.map((finding) => ({
                      pattern: finding.pattern,
                      score: finding.score,
                      line: finding.line ?? null,
                      reason: finding.reason,
                      status: predictionStatus(finding),
                      actionable: isActionablePrediction(finding)
                  }))
              }
            : {}),
        // Always present, and empty when the model named nothing:
        // being able to see that coverage was not reported is the
        // point of the field, so hiding it behind `verbose` would
        // defeat it.
        checked: checked ?? [],
        combinedScore: round(result.combinedScore),
        staticRisk: round(result.riskScore),
        ...(truncated ? { truncated } : {}),
        ...(options.verbose ? { metrics: result.metrics, logs: result.logs } : {}),
        ...(!options.verbose && options.logFile ? { logAnomalies: result.logs.anomalyCount } : {})
    };
}

/**
 * The verification rule restated on the wire, in one line.
 *
 * `instructions` is advertised once at initialize and not every client forwards
 * it to the model, whereas a tool result always reaches it -- and this is the
 * turn where the rule applies.
 *
 * Emitted on every reply rather than gated on the precision gate. That gate was
 * the wrong shape: a clean reply on code the agent just wrote is the turn where
 * the rule matters most and is least likely to be remembered, because "no
 * findings" reads as a clearance. It is a file-local one only -- this tool
 * never saw what the code was meant to do. The wording forks so neither case
 * pays for the other's advice.
 *
 * A batch resolves the fork across the whole set rather than per file, because
 * it is hoisted out of `results`: one actionable finding anywhere in a change
 * set is enough to make the fix wording the right advice for the change set.
 */
function reviewHint(results: FilePrediction[]): string {
    return results.some((result) => actionableFindings(result.ai).length > 0)
        ? "verify the fix outside this context unless mechanical"
        : "clean file, not a cleared feature -- review new code outside this context";
}

server.registerTool(
    "predict_failures",
    {
        title: "Predict the most likely runtime failure in a file",
        description:
            "Combine static analysis with a second-opinion verdict from the signed-in " +
            "Claude Code, Codex, or GitHub Copilot CLI, returning the most likely runtime " +
            "failure with a line number and reason. `status` distinguishes actionable, " +
            "uncertain, no-finding, and unavailable results. `checked` lists the bug " +
            "categories the model reports having considered, so a clean file weighed " +
            "against the whole catalogue is distinguishable from one where it stopped " +
            "early; it is a self-report, and an empty list means no coverage was " +
            "reported. Pass `multi: true` to get every " +
            "finding the model can demonstrate, ranked, in a `findings` array instead of " +
            "one verdict — experimental, and more findings per call is also more surface " +
            "for false positives per call. Treat it as a defect only when " +
            "`actionable` is true; " +
            `that applies the measured score >= ${MIN_ACTIONABLE_SCORE} precision gate. ` +
            "This spawns another model and takes 5-15 seconds, so only call it " +
            "when you specifically want an independent second opinion. If you are yourself " +
            "reviewing the code, use analyze_file and read the source instead. " +
            "Reviewing several files? Pass them all as `files` in one call rather than " +
            "calling once per file: the verdicts run concurrently, so the batch costs the " +
            "same and takes about as long as a single file.",
        inputSchema: {
            file: z
                .string()
                .optional()
                .describe("Absolute path to a .js/.jsx/.ts/.tsx file"),
            files: z
                .array(z.string())
                .optional()
                .describe(
                    "Absolute paths to review in one call, run concurrently. Prefer this " +
                        "over one call per file when checking a change set: the verdicts are " +
                        "independent, so a batch bills the same as the same files one at a " +
                        "time but finishes in roughly the time of the slowest one. Replies " +
                        "carry a `results` array in the order given. Supersedes `file`."
                ),
            concurrency: z
                .number()
                .int()
                .min(1)
                .max(8)
                .optional()
                .describe(
                    `Verdicts in flight at once for a batch (default ${DEFAULT_CONCURRENCY}). ` +
                        "Lower it if the provider starts rate-limiting."
                ),
            provider: z
                .enum(["claude", "codex", "copilot"])
                .optional()
                .describe("Which CLI to ask (default: whichever is installed)"),
            model: z.string().optional().describe("Model override passed to the CLI"),
            calleeContext: z
                .boolean()
                .optional()
                .describe(
                    "Also send the definitions of imported functions the file calls, one " +
                        "level deep, so the model can see whether a callee already handles " +
                        "the case it is about to flag (default true). Turning this off is " +
                        "cheaper per call and measurably less accurate."
                ),
            multi: z
                .boolean()
                .optional()
                .describe(
                    "Return every finding the model can demonstrate, ranked by score, " +
                        "rather than the single most likely one (default false). " +
                        "Experimental: the precision gate was measured on one-finding " +
                        "replies, so `actionable` is less well characterised here."
                ),
            logFile: z
                .string()
                .optional()
                .describe("Optional log file to fold into the combined score"),
            verbose: z
                .boolean()
                .optional()
                .describe(
                    "Include the static metric counts and the full log breakdown (default false)"
                )
        }
    },
    async ({ file, files, concurrency, provider, model, logFile, verbose, calleeContext, multi }) => {
        // `files` supersedes `file` so a caller migrating from one to the other
        // cannot accidentally pay for the same file twice, and duplicates
        // within a batch collapse for the same reason: each entry is a billed
        // model call, and asking the same question twice in one call is never
        // what was meant.
        const batched = Boolean(files && files.length > 0);
        const requested = batched ? files! : file ? [file] : [];
        if (requested.length === 0) {
            return failure("predict_failures needs either `file` or a non-empty `files` array.");
        }

        // Resolved for the provider, echoed as given. Keeping both directions
        // means the reply names files the way the caller named them even though
        // deduplication happens on the resolved form, where "./a.js" and the
        // absolute path to the same file are visibly one file.
        const givenFor = new Map<string, string>();
        for (const entry of requested) {
            const resolved = path.resolve(entry);
            if (!givenFor.has(resolved)) {
                givenFor.set(resolved, entry);
            }
        }
        const targets = [...givenFor.keys()];

        try {
            const active = await registry.resolveActive(provider as ProviderId | undefined);
            const options = {
                provider: active.provider,
                location: active.location,
                model,
                calleeContext,
                multi,
                logs: logFile ? { logPath: path.resolve(logFile) } : undefined
            };

            // `file` keeps the flat reply it has always had. Wrapping a single
            // verdict in a one-element array to make the shapes uniform would
            // cost every existing caller a rewrite and every future one an
            // extra indirection, to buy nothing.
            //
            // The fork is on which parameter was used, not on how many targets
            // survived deduplication. A caller knows what it passed; it should
            // not have to reason about whether its paths collapsed to one to
            // know whether the reply has a `results` array.
            if (!batched) {
                const result = await predictFile(targets[0], options);
                return json({
                    ...predictionBody(givenFor.get(targets[0])!, result, { verbose, logFile }),
                    review: reviewHint([result]),
                    viaProvider: active.provider.id
                });
            }

            const { results, failures } = await predictFiles(targets, {
                ...options,
                concurrency
            });

            return json({
                results: results.map((result) =>
                    predictionBody(givenFor.get(result.file) ?? result.file, result, {
                        verbose,
                        logFile
                    })
                ),
                // Hoisted: identical for every entry, and repeating it per file
                // would make the advice a per-file cost that scales with the
                // batch while saying the same thing each time.
                review: reviewHint(results),
                viaProvider: active.provider.id,
                // Only present when something went wrong. A batch where every
                // file succeeded should not spend tokens on an empty array
                // proving it.
                ...(failures.length > 0
                    ? {
                          failures: failures.map((entry) => ({
                              file: givenFor.get(entry.file) ?? entry.file,
                              reason: entry.reason
                          }))
                      }
                    : {})
            });
        } catch (err) {
            const subject = targets.length === 1 ? givenFor.get(targets[0])! : `${targets.length} files`;
            return failure(`Prediction failed for ${subject}: ${message(err)}`);
        }
    }
);

server.registerTool(
    "list_providers",
    {
        title: "Show available CLI providers",
        description:
            "Report which supported CLIs (Claude Code, Codex, GitHub Copilot) are installed " +
            "and signed in. " +
            "Call this to diagnose why predict_failures is failing.",
        inputSchema: {}
    },
    async () => {
        const detected = await registry.detectAll();
        return json(
            detected.map(({ provider, location, auth }) => ({
                id: provider.id,
                label: provider.label,
                installed: Boolean(location),
                path: location?.file,
                version: location?.version,
                signedIn: auth.hasCredentials,
                credentials: auth.credentialsPath,
                hint: location ? undefined : provider.installHint
            }))
        );
    }
);

function message(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
    // stdout is the JSON-RPC channel; anything we want to say goes to stderr.
    await server.connect(new StdioServerTransport());
    process.stderr.write("predictive-debugger MCP server ready\n");
}

main().catch((err) => {
    process.stderr.write(`predictive-debugger MCP server failed: ${message(err)}\n`);
    process.exit(1);
});
