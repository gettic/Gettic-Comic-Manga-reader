// The UI's only door to the Rust side. Only files in src\api import @tauri-apps/*, so the
// plain web build still works without Tauri (it then uses the demo backend in demo.ts).

export { isTauri, invoke } from "./core";
export * from "./types";
export * from "./comics";
export * from "./settings";
export * from "./window";
