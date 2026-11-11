import { describe, expect, it } from "vitest";
import { BINDINGS, commandForKey, keyName } from "./keys";

describe("key map", () => {
  it("arrows are visual, space and page keys are reading order", () => {
    expect(commandForKey({ key: "ArrowRight" })).toBe("visualRight");
    expect(commandForKey({ key: "ArrowLeft" })).toBe("visualLeft");
    expect(commandForKey({ key: " " })).toBe("next");
    expect(commandForKey({ key: " ", shiftKey: true })).toBe("prev");
    expect(commandForKey({ key: "PageDown" })).toBe("next");
    expect(commandForKey({ key: "PageUp" })).toBe("prev");
  });

  it("modifiers pick other commands", () => {
    expect(commandForKey({ key: "ArrowLeft", shiftKey: true })).toBe("shiftLeft");
    expect(commandForKey({ key: "ArrowRight", ctrlKey: true })).toBe("jumpRight");
    expect(commandForKey({ key: "o", ctrlKey: true })).toBe("openFile");
    expect(commandForKey({ key: "O", ctrlKey: true, shiftKey: true })).toBe("openFolder");
  });

  it("letters ignore case, symbols ignore shift", () => {
    expect(commandForKey({ key: "F" })).toBe("fullscreen");
    expect(commandForKey({ key: "?", shiftKey: true })).toBe("help");
    expect(commandForKey({ key: "+", shiftKey: true })).toBe("zoomIn");
    expect(keyName({ key: "D" })).toBe("d");
    expect(commandForKey({ key: "4" })).toBe("layoutBook");
  });

  it("unknown keys do nothing", () => {
    expect(commandForKey({ key: "x" })).toBeUndefined();
    expect(commandForKey({ key: "d", altKey: true })).toBeUndefined();
  });

  it("no key is bound twice", () => {
    const all = BINDINGS.flatMap((b) => b.keys);
    expect(new Set(all).size).toBe(all.length);
  });
});
