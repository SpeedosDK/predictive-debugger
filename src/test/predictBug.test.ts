import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePrediction } from "../core/prediction/predictBug";

describe("parsePrediction", () => {
    it("parses a clean JSON verdict", () => {
        const result = parsePrediction(
            '{"pattern":"off_by_one","score":0.9,"line":3,"reason":"loop runs one too far"}'
        );
        assert.equal(result.pattern, "off_by_one");
        assert.equal(result.score, 0.9);
        assert.equal(result.line, 3);
        assert.equal(result.reason, "loop runs one too far");
    });

    it("strips code fences", () => {
        const result = parsePrediction(
            '```json\n{"pattern":"null_reference","score":0.5,"reason":"x"}\n```'
        );
        assert.equal(result.pattern, "null_reference");
    });

    it("ignores prose around the object", () => {
        const result = parsePrediction(
            'Here is my analysis:\n{"pattern":"race_condition","score":0.7,"reason":"y"}\nHope that helps!'
        );
        assert.equal(result.pattern, "race_condition");
        assert.equal(result.score, 0.7);
    });

    it("forces score to 0 when the pattern is none", () => {
        const result = parsePrediction('{"pattern":"none","score":0.8,"reason":"looks fine"}');
        assert.equal(result.score, 0);
    });

    it("clamps out-of-range scores", () => {
        assert.equal(parsePrediction('{"pattern":"x","score":5}').score, 1);
        assert.equal(parsePrediction('{"pattern":"x","score":-2}').score, 0);
        assert.equal(parsePrediction('{"pattern":"x","score":"abc"}').score, 0);
    });

    it("drops a non-positive or missing line number", () => {
        assert.equal(parsePrediction('{"pattern":"x","score":0.5,"line":0}').line, undefined);
        assert.equal(parsePrediction('{"pattern":"x","score":0.5,"line":null}').line, undefined);
        assert.equal(parsePrediction('{"pattern":"x","score":0.5}').line, undefined);
    });

    it("floors a fractional line number", () => {
        assert.equal(parsePrediction('{"pattern":"x","score":0.5,"line":7.8}').line, 7);
    });

    it("degrades to an unknown verdict on unparseable output", () => {
        const result = parsePrediction("I could not analyse that file.");
        assert.equal(result.pattern, "unknown");
        assert.equal(result.score, 0);
        assert.match(result.reason, /Could not parse/);
    });

    it("degrades to an unknown verdict on malformed JSON", () => {
        const result = parsePrediction('{"pattern": "x", "score":');
        assert.equal(result.pattern, "unknown");
    });

    it("treats an empty pattern as none", () => {
        assert.equal(parsePrediction('{"pattern":"   ","score":0.9}').pattern, "none");
    });
});
