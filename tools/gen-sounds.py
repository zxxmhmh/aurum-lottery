"""生成抽奖舞台的音效：滚动滴答、庆典揭晓、落空。
目标：更响、更喜庆（号角 + 钟声 + 镲片 + 低音鼓点）。
"""
import math
import os
import wave

import numpy as np

SR = 22050
OUT = os.path.join("public", "sounds")
rng = np.random.default_rng(2026)


def env(n, attack=0.004, decay=0.18, curve=4.0):
    a = max(1, int(attack * SR))
    env_arr = np.exp(-np.linspace(0, 1, n) * curve * (0.25 / max(decay, 1e-3)))
    head = np.linspace(0, 1, min(a, n), endpoint=False)
    env_arr[: len(head)] *= head
    return env_arr[:n]


def saw(freq, dur, vol=0.4, decay=0.2, harmonics=9, attack=0.004):
    n = int(dur * SR)
    t = np.arange(n) / SR
    w = np.zeros(n)
    for k in range(1, harmonics + 1):
        if freq * k > SR / 2 - 200:
            break
        w += (1.0 / k) * np.sin(2 * math.pi * freq * k * t)
    return w * env(n, attack=attack, decay=decay) * vol / 2.2


def sine(freq, dur, vol=0.5, decay=0.3, attack=0.002):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return np.sin(2 * math.pi * freq * t) * env(n, attack=attack, decay=decay) * vol


def bell(freq, dur, vol=0.35, decay=0.8):
    n = int(dur * SR)
    t = np.arange(n) / SR
    partials = [(1.0, 1.0), (2.76, 0.55), (5.40, 0.3), (8.93, 0.18)]
    w = np.zeros(n)
    for ratio, amp in partials:
        if freq * ratio < SR / 2 - 200:
            w += amp * np.sin(2 * math.pi * freq * ratio * t) * np.exp(-np.linspace(0, 1, n) * 5.5)
    return w * env(n, attack=0.001, decay=decay) * vol


def cymbal(dur, vol=0.3, decay=0.5):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    # 简易高通：一阶差分 + 再差分，把低频压掉，留下“沙沙”的镲片感
    bright = np.diff(np.diff(noise))
    bright = np.pad(bright, (0, n - len(bright)))
    return bright * env(n, attack=0.001, decay=decay) * vol / 6.0


def thump(dur=0.28, vol=0.55):
    n = int(dur * SR)
    t = np.arange(n) / SR
    freq = np.linspace(120, 55, n)
    return np.sin(2 * math.pi * freq * t) * env(n, attack=0.002, decay=0.16) * vol


def mix(*parts):
    length = max(len(p) for p in parts)
    out = np.zeros(length)
    for p in parts:
        out[: len(p)] += p
    return out


def place(part, at_sec, total):
    out = np.zeros(total)
    start = int(at_sec * SR)
    end = min(total, start + len(part))
    out[start:end] += part[: end - start]
    return out


def save(name, data, peak=0.97):
    data = np.asarray(data, dtype=np.float64)
    top = np.max(np.abs(data)) or 1.0
    data = np.tanh(data / top * 1.2) / np.tanh(1.2)  # 轻微软限幅，整体更响也不爆
    data = data / max(np.max(np.abs(data)), 1e-9) * peak
    pcm = (data * 32767).astype(np.int16)
    path = os.path.join(OUT, name)
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(SR)
        fh.writeframes(pcm.tobytes())
    print(f"{path}  {len(data) / SR:.2f}s  {os.path.getsize(path) / 1024:.1f}KB")


os.makedirs(OUT, exist_ok=True)

# 1) 滚动滴答：清脆咔哒 + 低频鼓点
tick = mix(
    saw(1650, 0.08, vol=0.75, decay=0.012, harmonics=3, attack=0.001),
    sine(820, 0.05, vol=0.35, decay=0.01, attack=0.001),
    thump(0.16, vol=0.5),
)
save("tick.wav", tick)

# 2) 揭晓：号角进场 + 钟声 + 镲片 + 低音，庆典感
total = int(2.6 * SR)
fanfare = [
    (523.25, 0.00, 0.30),   # C5
    (659.25, 0.13, 0.30),   # E5
    (783.99, 0.26, 0.30),   # G5
    (1046.50, 0.39, 0.85),  # C6 长音
]
reveal = np.zeros(total)
for freq, at, dur in fanfare:
    reveal += place(saw(freq, dur + 0.22, vol=0.5, decay=0.22, harmonics=10), at, total)

# 长音和弦（C6 持续 + E6 + G6），压在最后
for freq, vol in [(1046.50, 0.34), (1318.51, 0.2), (1567.98, 0.16)]:
    reveal += place(saw(freq, 1.6, vol=vol, decay=0.7, harmonics=8), 0.5, total)

reveal += place(cymbal(1.6, vol=0.55, decay=0.7), 0.5, total)
reveal += place(bell(2093.0, 1.8, vol=0.3, decay=1.1), 0.52, total)
reveal += place(bell(3135.96, 1.4, vol=0.18, decay=0.9), 0.66, total)
reveal += place(thump(0.3, vol=0.7), 0.5, total)
save("reveal.wav", reveal)

# 3) 落空：柔和下行
miss = np.zeros(int(0.95 * SR))
miss += place(saw(440.0, 0.32, vol=0.35, decay=0.28, harmonics=4), 0.0, len(miss))
miss += place(saw(329.63, 0.60, vol=0.35, decay=0.45, harmonics=4), 0.16, len(miss))
save("miss.wav", miss)
