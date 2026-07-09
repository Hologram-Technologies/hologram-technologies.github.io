// gen-exposed.mjs — regenerate model.exposed.onnx with a fixed probe set. Names live in-code (NOT argv) so the
// MSYS/Git-Bash shell can't mangle leading-"/" tensor names into Windows paths. Edit PROBES to change the taps.
import { exposeOutputs } from "./onnx-expose.mjs";

const MODEL = "../../../../../../holo-os/system/os/usr/lib/holo/voice/vendor/models/onnx-community/Kokoro-82M-v1.0-ONNX/onnx/model.onnx";
const S = "/decoder/decoder/generator/m_source/l_sin_gen/";
const PROBES = [
  S + "Sub_output_0",     // early in the phase chain (fractional / F0 prep)
  S + "Resize_output_0",  // F0 upsample frame-rate → sample-rate (mode-sensitive)
  S + "CumSum_output_0",  // phase accumulation
  S + "Sin_output_0",     // final source sine
];
console.log(exposeOutputs(MODEL, PROBES, "model.exposed.onnx"));
console.log("probes:", PROBES.length);
