// holo-libretro-real.js — a REAL libretro frontend driving a REAL emulator core
// (Gambatte / Game Boy), built here from source with emscripten. This is the production
// path the whole effort was aiming at: the full libretro callback ABI — environment,
// video_refresh, audio, input — wired across the wasm boundary via a function table
// (emscripten addFunction), the ROM handed in through a retro_game_info struct, RGB565
// frames converted to RGBA. It presents the SAME libretro-shaped surface as the mock and
// the synthetic wasm cores, so LibretroMachine + κ-snapshot + run-ahead + rollback drive
// real Gambatte unchanged — the κ seams are the constant, the engine is now real.

// RETRO_ENVIRONMENT / device constants (from libretro.h)
const ENV_GET_CAN_DUPE = 3;
const ENV_SET_PIXEL_FORMAT = 10;

export async function loadRealCore(moduleFactory) {
  const M = await moduleFactory();
  const cw = (n, ret, args) => M.cwrap(n, ret, args);

  const retro = {
    set_environment: cw("retro_set_environment", null, ["number"]),
    init: cw("retro_init", null, []),
    set_video_refresh: cw("retro_set_video_refresh", null, ["number"]),
    set_audio_sample: cw("retro_set_audio_sample", null, ["number"]),
    set_audio_sample_batch: cw("retro_set_audio_sample_batch", null, ["number"]),
    set_input_poll: cw("retro_set_input_poll", null, ["number"]),
    set_input_state: cw("retro_set_input_state", null, ["number"]),
    load_game: cw("retro_load_game", "number", ["number"]),
    get_av_info: cw("retro_get_system_av_info", null, ["number"]),
    run: cw("retro_run", null, []),
    serialize_size: cw("retro_serialize_size", "number", []),
    serialize: cw("retro_serialize", "number", ["number", "number"]),
    unserialize: cw("retro_unserialize", "number", ["number", "number"]),
  };

  let currentInput = 0;
  let W = 160, H = 144, lastVideo = null;
  let realSampleRate = 32000;
  let audioAccum = [];   // interleaved-stereo float32 captured this frame
  let pixelFormat = 2;   // RETRO_PIXEL_FORMAT: 0=0RGB1555, 1=XRGB8888, 2=RGB565 (default)

  // ── the libretro callbacks, installed into the wasm function table ──
  const envCb = M.addFunction((cmd, data) => {
    if (cmd === ENV_SET_PIXEL_FORMAT) { pixelFormat = M.getValue(data, "i32"); return true; }   // accept the core's format
    if (cmd === ENV_GET_CAN_DUPE) { M.setValue(data, 1, "i8"); return true; }
    return false;                                                // everything else: use core defaults
  }, "iii");

  // convert any libretro pixel format → RGBA. Handles RGB565 (Gambatte), 0RGB1555 + XRGB8888 (NES/others).
  const videoCb = M.addFunction((data, width, height, pitch) => {
    W = width; H = height;
    if (!data) return;                                           // duped frame → keep last
    const out = new Uint8Array(width * height * 4);
    if (pixelFormat === 1) {                                     // XRGB8888 (32-bit)
      const u32 = new Uint32Array(M.HEAPU8.buffer, data, (pitch / 4) * height);
      const stride = pitch / 4;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = u32[y * stride + x]; const o = (y * width + x) * 4;
        out[o] = (p >> 16) & 0xff; out[o + 1] = (p >> 8) & 0xff; out[o + 2] = p & 0xff; out[o + 3] = 255;
      }
    } else {                                                     // 16-bit: RGB565 (2) or 0RGB1555 (0)
      const u16 = new Uint16Array(M.HEAPU8.buffer, data, (pitch / 2) * height);
      const stride = pitch / 2, is565 = pixelFormat !== 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = u16[y * stride + x]; const o = (y * width + x) * 4;
        if (is565) {
          const r5 = (p >> 11) & 0x1f, g6 = (p >> 5) & 0x3f, b5 = p & 0x1f;
          out[o] = (r5 << 3) | (r5 >> 2); out[o + 1] = (g6 << 2) | (g6 >> 4); out[o + 2] = (b5 << 3) | (b5 >> 2);
        } else {                                                 // 0RGB1555
          const r5 = (p >> 10) & 0x1f, g5 = (p >> 5) & 0x1f, b5 = p & 0x1f;
          out[o] = (r5 << 3) | (r5 >> 2); out[o + 1] = (g5 << 3) | (g5 >> 2); out[o + 2] = (b5 << 3) | (b5 >> 2);
        }
        out[o + 3] = 255;
      }
    }
    lastVideo = out;
  }, "viiii");

  const inputPollCb = M.addFunction(() => {}, "v");
  const inputStateCb = M.addFunction((port, device, index, id) => (port === 0 ? (currentInput >> id) & 1 : 0), "iiiii");
  // audio: capture Gambatte's real int16 stereo samples → float32 → the κ-audio seam.
  const audioSampleCb = M.addFunction((left, right) => {
    audioAccum.push(left / 32768, right / 32768);
  }, "vii");
  const audioBatchCb = M.addFunction((data, frames) => {
    const s16 = new Int16Array(M.HEAPU8.buffer, data, frames * 2);   // interleaved L,R
    for (let i = 0; i < frames * 2; i++) audioAccum.push(s16[i] / 32768);
    return frames;
  }, "iii");

  // ── libretro lifecycle: environment → init → callbacks ──
  retro.set_environment(envCb);
  retro.init();
  retro.set_video_refresh(videoCb);
  retro.set_audio_sample(audioSampleCb);
  retro.set_audio_sample_batch(audioBatchCb);
  retro.set_input_poll(inputPollCb);
  retro.set_input_state(inputStateCb);

  let frameCount = 0;

  return {
    get geometry() { return { width: W, height: H }; },
    get sampleRate() { return Math.round(realSampleRate); },
    get fps() { return 60; },
    get frame() { return frameCount; },

    loadGame(romBytes, pathHint = "") {
      const dataPtr = M._malloc(romBytes.length);
      M.HEAPU8.set(romBytes, dataPtr);
      // some cores (e.g. Genesis Plus GX) load from the ROM's PATH (via the emscripten FS),
      // not info->data, and detect the system from the extension. Provide both: write the
      // bytes into the in-memory FS at pathHint, and pass the path + data.
      let pathPtr = 0;
      if (pathHint) {
        if (M.FS) { try { M.FS.writeFile(pathHint, romBytes); } catch (e) {} }
        pathPtr = M._malloc(pathHint.length + 1);
        for (let i = 0; i < pathHint.length; i++) M.setValue(pathPtr + i, pathHint.charCodeAt(i), "i8");
        M.setValue(pathPtr + pathHint.length, 0, "i8");
      }
      const info = M._malloc(16);                 // retro_game_info { path, data, size, meta }
      M.setValue(info + 0, pathPtr, "i32");
      M.setValue(info + 4, dataPtr, "i32");
      M.setValue(info + 8, romBytes.length, "i32");
      M.setValue(info + 12, 0, "i32");
      const ok = retro.load_game(info);
      if (!ok) { M._free(dataPtr); if (pathPtr) M._free(pathPtr); M._free(info); throw new Error("retro_load_game refused the ROM"); }
      const av = M._malloc(48);                    // read geometry + timing from av_info
      retro.get_av_info(av);
      W = M.getValue(av, "i32") || W; H = M.getValue(av + 4, "i32") || H;
      realSampleRate = M.getValue(av + 32, "double") || realSampleRate;   // timing.sample_rate
      M._free(av);
      frameCount = 0;
      return true;
    },

    run(input = 0) {
      currentInput = input | 0;
      audioAccum.length = 0;
      retro.run();                                 // core calls videoCb + audio cbs with real data
      frameCount++;
      return { video: lastVideo || new Uint8Array(W * H * 4), audio: Float32Array.from(audioAccum) };
    },

    serialize() {
      const n = retro.serialize_size();
      const ptr = M._malloc(n);
      if (!retro.serialize(ptr, n)) { M._free(ptr); throw new Error("retro_serialize failed"); }
      const out = M.HEAPU8.slice(ptr, ptr + n);
      M._free(ptr);
      return out;
    },
    unserialize(bytes) {
      const ptr = M._malloc(bytes.length);
      M.HEAPU8.set(bytes, ptr);
      const ok = retro.unserialize(ptr, bytes.length);
      M._free(ptr);
      if (!ok) throw new Error("retro_unserialize failed");
      return true;
    },
  };
}
