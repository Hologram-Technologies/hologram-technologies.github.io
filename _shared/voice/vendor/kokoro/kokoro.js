// serverless-bundle stub — kokoro-js vendor is not shipped; warmHD Plan B fails fast → speechSynthesis floor.
export class KokoroTTS { static async from_pretrained() { throw new Error("Kokoro not in serverless bundle (follow-up: HD via κ); using floor voice"); } }
export default { KokoroTTS };
