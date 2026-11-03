import json
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel

wav_path = sys.argv[1]
model_path = sys.argv[2]
language = sys.argv[3] if len(sys.argv) > 3 else "zh"
device = sys.argv[4] if len(sys.argv) > 4 else "cpu"
compute_type = sys.argv[5] if len(sys.argv) > 5 else "int8"

with wave.open(wav_path) as handle:
    frames = handle.readframes(handle.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

model = WhisperModel(model_path, device=device, compute_type=compute_type)
segments, info = model.transcribe(samples, language=language, vad_filter=True, beam_size=1)
lines = []
for segment in segments:
    text = segment.text.strip()
    if text:
        lines.append({"start": round(float(segment.start), 3), "end": round(float(segment.end), 3), "text": text})
print(json.dumps({"ok": True, "segments": lines, "duration": getattr(info, "duration", None)}, ensure_ascii=False))
