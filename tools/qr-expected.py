import json
import sys

sys.path.insert(0, r"./.tmp/qrverify")
import qrcode
from qrcode.constants import ERROR_CORRECT_M
from qrcode.util import QRData, MODE_8BIT_BYTE

CASES = [
    ("AUR-XXXX", 1),
    ("http://127.0.0.1:5180/redeem?code=ZX-JDF3", 4),
    ("http://127.0.0.1:5180/redeem?code=ZX-ABCD", 4),
    ("http://127.0.0.1:5180/redeem?code=ZX-ABCDEFGHIJKLMNOPQRSTUVWXYZ", 5),
    ("x" * 100, 6),
]

out = []
for text, version in CASES:
    qr = qrcode.QRCode(version=version, error_correction=ERROR_CORRECT_M, box_size=1, border=0, mask_pattern=0)
    qr.add_data(QRData(text.encode("utf-8"), mode=MODE_8BIT_BYTE))
    qr.make(fit=False)
    matrix = [[1 if cell else 0 for cell in row] for row in qr.get_matrix()]
    out.append({"text": text, "version": version, "matrix": matrix})
    print(f"case v{version} len={len(text)} size={len(matrix)}")

with open("tools/qr-expected.json", "w", encoding="utf-8") as f:
    json.dump(out, f)
