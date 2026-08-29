import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectMetrics } from "../core/analysis/ast";

describe("collectMetrics", () => {
    it("counts functions of every shape", async () => {
        const metrics = await collectMetrics(`
            function a() {}
            const b = function () {};
            const c = () => {};
        `);
        assert.equal(metrics.functions, 3);
    });

    it("counts await and timers as async boundaries", async () => {
        const metrics = await collectMetrics(`
            async function f() {
                await g();
                setTimeout(() => {}, 10);
            }
        `);
        assert.equal(metrics.asyncCalls, 2);
    });

    it("detects nested loops but not sibling loops", async () => {
        const nested = await collectMetrics(
            "for (let i=0;i<2;i++) { for (let j=0;j<2;j++) {} }"
        );
        const siblings = await collectMetrics(
            "for (let i=0;i<2;i++) {} for (let j=0;j<2;j++) {}"
        );
        assert.equal(nested.nestedLoops, 1);
        assert.equal(siblings.nestedLoops, 0);
    });

    it("parses TypeScript and JSX", async () => {
        const metrics = await collectMetrics(
            "const f = (x: number): JSX.Element => <div>{x}</div>;"
        );
        assert.equal(metrics.functions, 1);
    });

    it("parses decorated classes", async () => {
        // Angular, Nest, TypeORM and MobX all emit these. Before the decorator
        // plugins were enabled this threw, and analyzeSource turned it into a
        // zero-risk result, so a decorated file sorted last in scan_project.
        const metrics = await collectMetrics(`
            @Injectable()
            export class OrderService {
                @observable items = [];
                constructor(@Inject(REPO) private readonly repo: Repo) {}
                @Get(":id")
                async find(@Param("id") id: string) {
                    return await this.repo.get(id);
                }
            }
        `);
        assert.equal(metrics.asyncCalls, 1);
        // The constructor and find(), both ClassMethod nodes.
        assert.equal(metrics.functions, 2);
    });

    it("counts class and object methods as functions", async () => {
        // Babel does not report a method as a FunctionExpression, so a visitor
        // that lists only the function node types is blind to every method in a
        // class-based codebase. That kept longFunctions at zero for all 40 files
        // of the benchmark corpus while carrying 0.15 of the risk weight.
        const cls = await collectMetrics("class A { m() {} n() {} }");
        assert.equal(cls.functions, 2);

        const obj = await collectMetrics("const o = { m() {}, get n() { return 1; } };");
        assert.equal(obj.functions, 2);
    });

    it("parses the accessor keyword", async () => {
        const metrics = await collectMetrics("class C { @logged accessor x = 1; }");
        assert.equal(metrics.functions, 0);
    });

    it("throws on input Babel cannot parse", async () => {
        // errorRecovery repairs some damage but not unbalanced braces. This is
        // the raw primitive, so it propagates — analyzeSource is the layer that
        // turns a parse failure into a reportable result. See risk.test.ts.
        await assert.rejects(collectMetrics("function broken( {"));
    });

    it("flags functions longer than 20 statements", async () => {
        const body = Array.from({ length: 25 }, (_, i) => `let v${i} = ${i};`).join("\n");
        const metrics = await collectMetrics(`function big() {\n${body}\n}`);
        assert.equal(metrics.longFunctions, 1);
    });
});
