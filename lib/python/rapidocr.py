import json
import sys

try:
    from rapidocr_onnxruntime import RapidOCR
except Exception as exc:  # noqa: BLE001
    print(json.dumps({"ok": False, "error": "rapidocr 未安装: " + repr(exc)}, ensure_ascii=False))
    sys.exit(0)

engine = RapidOCR()
image = sys.argv[1]
result, _elapse = engine(image)
lines = []
for item in (result or []):
    box, text, score = item[0], item[1], float(item[2])
    if score is None or score < 0.3:
        continue
    lines.append({"text": str(text), "confidence": float(score), "bbox": box})
print(json.dumps({"ok": True, "lines": lines}, ensure_ascii=False))
