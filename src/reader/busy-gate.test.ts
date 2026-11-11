import { describe, expect, it } from "vitest";
import { BusyGate } from "./busy-gate";

describe("BusyGate: a size learned during a turn doesn't end it", () => {
  it("runs at once when no turn is running", () => {
    const gate = new BusyGate(() => false);
    let ran = 0;
    gate.run("sizes", () => ran++);
    expect(ran).toBe(1);
  });

  it("waits while a turn runs, then runs once when it ends", () => {
    let turning = true;
    let turnEnded = false;
    const gate = new BusyGate(() => turning);
    let relayouts = 0;
    // Page sizes arrive mid-flip: the relayout must not run (it would end the flip).
    gate.run("sizes", () => {
      relayouts++;
      turnEnded = !turning;
    });
    gate.run("sizes", () => {
      relayouts++;
      turnEnded = !turning;
    }); // a second batch replaces the first
    gate.release(); // still turning: nothing happens
    expect(relayouts).toBe(0);
    expect(gate.pending).toBe(1);
    turning = false; // the flip finished on its own
    gate.release();
    expect(relayouts).toBe(1);
    expect(turnEnded).toBe(true);
    expect(gate.pending).toBe(0);
  });

  it("keeps different jobs apart", () => {
    let busy = true;
    const gate = new BusyGate(() => busy);
    const ran: string[] = [];
    gate.run("sizes", () => ran.push("sizes"));
    gate.run("refill-a", () => ran.push("a"));
    busy = false;
    gate.release();
    expect(ran.sort()).toEqual(["a", "sizes"]);
  });
});
