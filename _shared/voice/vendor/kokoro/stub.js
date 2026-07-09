// browser stub for node built-ins kokoro-js imports but doesn't use client-side.
export const join = (...a) => a.join('/');
export const resolve = (...a) => a.join('/');
export const dirname = (p) => String(p).replace(/\/[^/]*$/, '');
export const readFile = async () => { throw new Error('fs unavailable in browser'); };
export default {};
