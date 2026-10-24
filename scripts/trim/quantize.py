"""
Quantizes the transformer layers' MatMul weights to int8 (dynamic quantization). The original
int8 model only quantized the vocabulary table; its 22 layers are float32 (~170 MB).

    .venv-trim/Scripts/python scripts/trim/quantize.py .cache/trim/south-asia .cache/trim/south-asia-int8
"""

import json
import shutil
import sys
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic

source, target = Path(sys.argv[1]), Path(sys.argv[2])
target.mkdir(parents=True, exist_ok=True)
quantize_dynamic(
    str(source / 'model_quantized.onnx'),
    str(target / 'model_quantized.onnx'),
    op_types_to_quantize=['MatMul'],
    weight_type=QuantType.QInt8,
    per_channel=True,
)
for name in ['tokenizer.json', 'tokenizer_config.json', 'config.json']:
    shutil.copy(source / name, target / name)
trim = json.loads((source / 'TRIM.json').read_text(encoding='utf-8'))
(target / 'TRIM.json').write_text(json.dumps({**trim, 'int8Layers': True}, indent=2), encoding='utf-8')
print(f'{(target / "model_quantized.onnx").stat().st_size / 1e6:.1f} MB')
