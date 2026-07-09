// serverless-bundle stub — Harper (23MB) is not shipped; grammar is a pass-through here.
// Same API as the OS module (check/correct/warm/ready): sends are never blocked, slowed, or changed.
export async function check() { return []; }
export async function correct(text) { return text; }
export async function warm() {}
export function ready() { return false; }
export default { check, correct, warm, ready };
