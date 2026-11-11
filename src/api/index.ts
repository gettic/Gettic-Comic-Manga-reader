// The only module allowed to import @tauri-apps/*. Everything else imports from here,
// so the plain web build still works without Tauri.

export const isTauri = (): boolean => "__TAURI_INTERNALS__" in globalThis;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error(`"${cmd}" needs the desktop app`);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}
