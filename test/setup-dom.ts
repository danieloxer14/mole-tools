import { JSDOM } from "jsdom";

/**
 * Installs a real DOM into the test process so `DOMPurify.sanitize` performs
 * genuine sanitization (it is a no-op in the DOM-less Bun runtime). Import
 * this before any module that transitively imports `dompurify`: the library
 * captures the global `window` at module load time.
 */
const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as Record<string, unknown>).window = dom.window;
(globalThis as Record<string, unknown>).document = dom.window.document;
(globalThis as Record<string, unknown>).Node = dom.window.Node;
(globalThis as Record<string, unknown>).NodeFilter = dom.window.NodeFilter;
(globalThis as Record<string, unknown>).HTMLElement = dom.window.HTMLElement;
(globalThis as Record<string, unknown>).HTMLTemplateElement =
	dom.window.HTMLTemplateElement;
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;
