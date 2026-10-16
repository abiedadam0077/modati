#!/usr/bin/env python3
"""Procedurally synthesizes every CRAFTORIA sound effect (original audio, no samples).

Requires: numpy, soundfile (with libsndfile OGG/Vorbis support):
    pip install --user numpy soundfile
Writes assets/sounds/<name>.ogg (mono, 44.1 kHz, Vorbis).
"""
import os
import numpy as np
import soundfile as sf

SR = 44100
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "assets", "sounds")
rng = np.random.default_rng(1234)


def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def env(n, attack=0.005, decay=0.2, sustain=0.0, release=0.05, dur=None):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.exp(-np.maximum(t - attack, 0) / max(decay, 1e-4))
    e = a * (sustain + (1 - sustain) * d)
    if dur is not None:
        rel_start = dur - release
        e *= np.clip((dur - t) / max(release, 1e-4), 0, 1) if release > 0 else 1
    return e


def lowpass(x, cutoff):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    X *= 1 / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(X, len(x))


def bandpass(x, lo, hi):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = (1 / np.sqrt(1 + (lo / np.maximum(f, 1)) ** 4)) * (1 / np.sqrt(1 + (f / hi) ** 4))
    X *= g
    return np.fft.irfft(X, len(x))


def noise(dur):
    return rng.standard_normal(int(SR * dur))


def partials(dur, freqs, decays, amps):
    t = t_axis(dur)
    out = np.zeros_like(t)
    for f, d, a in zip(freqs, decays, amps):
        out += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
    return out


def norm(x, peak=0.85):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def fade(x, ms=8):
    n = int(SR * ms / 1000)
    if n * 2 < len(x):
        x[:n] *= np.linspace(0, 1, n)
        x[-n:] *= np.linspace(1, 0, n)
    return x


def save(name, x, peak=0.85):
    os.makedirs(OUT, exist_ok=True)
    x = fade(norm(x, peak).astype(np.float32))
    sf.write(os.path.join(OUT, f"{name}.ogg"), x, SR, format="OGG", subtype="VORBIS")


def clank(dur=0.6, base=180):
    # heavy metallic impact: inharmonic partials + thump + noise transient
    x = partials(dur, [base, base * 2.76, base * 5.4, base * 8.9, base * 13.3], [0.25, 0.12, 0.07, 0.04, 0.02], [1, 0.6, 0.4, 0.25, 0.15])
    thump = np.sin(2 * np.pi * 55 * t_axis(dur)) * np.exp(-t_axis(dur) / 0.08)
    tr = bandpass(noise(dur), 800, 6000) * np.exp(-t_axis(dur) / 0.015)
    return x * 0.7 + thump * 0.8 + tr * 0.5


def whir(dur, f0, f1, wobble=4.0, bright=0.4):
    t = t_axis(dur)
    f = np.linspace(f0, f1, len(t)) * (1 + 0.03 * np.sin(2 * np.pi * wobble * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) + bright * np.sin(2 * ph) + 0.2 * np.sin(3 * ph)
    hiss = bandpass(noise(dur), 300, 3000) * 0.25
    e = env(len(t), 0.05, 10, 1.0, 0.15, dur)
    return (tone + hiss) * e


def grind(dur, lo, hi, rough=12):
    t = t_axis(dur)
    n = bandpass(noise(dur), lo, hi)
    mod = 0.6 + 0.4 * np.abs(np.sin(2 * np.pi * rough * t + rng.uniform(0, 6)))
    crunch = (rng.uniform(size=len(t)) > 0.9993).astype(float)
    crunch = lowpass(crunch, 2500) * 40
    return (n * mod + crunch) * env(len(t), 0.04, 10, 1.0, 0.12, dur)


def main():
    # hand crank: wooden ratchet clicks
    d = 0.45
    x = np.zeros(int(SR * d))
    for i, p in enumerate([0.0, 0.11, 0.22, 0.33]):
        c = partials(0.06, [1400 + i * 40, 2900, 4700], [0.012, 0.008, 0.005], [1, 0.5, 0.3])
        s = int(p * SR)
        x[s:s + len(c)] += c
    save("crank", x + 0.15 * bandpass(noise(d), 200, 900) * env(len(x), 0.01, 0.3))

    save("press", clank(0.7, 160))
    save("press_light", clank(0.35, 320), 0.6)

    # mixer: swirling whisk in liquid (filtered noise with fast tremolo)
    d = 1.2
    t = t_axis(d)
    n = bandpass(noise(d), 400, 2200) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * t))
    save("mixer", n * env(len(t), 0.1, 10, 1, 0.3, d) + 0.3 * whir(d, 90, 95, 7, 0.2))

    save("millstone", grind(1.0, 120, 1400, 4))
    save("crusher", grind(1.0, 60, 900, 9) + 0.4 * whir(1.0, 55, 50, 3, 0.6))
    # saw: bright buzz with tooth modulation
    d = 0.8
    t = t_axis(d)
    buzz = np.sign(np.sin(2 * np.pi * 220 * t)) * 0.3 + bandpass(noise(d), 2000, 7000) * (0.5 + 0.5 * np.sin(2 * np.pi * 45 * t))
    save("saw", buzz * env(len(t), 0.02, 10, 1, 0.2, d), 0.7)
    # drill: whine + chatter
    save("drill", whir(0.9, 420, 470, 25, 0.8) + 0.5 * grind(0.9, 300, 3000, 30), 0.75)
    # deployer: pneumatic push + click
    d = 0.4
    psh = bandpass(noise(d), 500, 4000) * np.exp(-t_axis(d) / 0.08)
    save("deployer", psh * 0.6 + clank(d, 600) * 0.5, 0.7)
    # mechanical arm servo
    save("arm", whir(0.5, 520, 760, 9, 0.3) * np.hanning(int(SR * 0.5)), 0.55)
    # encased fan whoosh
    d = 1.0
    t = t_axis(d)
    save("fan", bandpass(noise(d), 150, 1200) * (0.7 + 0.3 * np.sin(2 * np.pi * 11 * t)) * env(len(t), 0.15, 10, 1, 0.3, d), 0.55)
    # pump gurgle
    d = 0.9
    t = t_axis(d)
    bub = np.zeros_like(t)
    for _ in range(9):
        s = rng.uniform(0, d - 0.12)
        f = rng.uniform(250, 600)
        tt = t - s
        m = (tt > 0) & (tt < 0.12)
        bub[m] += np.sin(2 * np.pi * (f + 900 * tt[m]) * tt[m]) * np.exp(-tt[m] / 0.04)
    save("pump", bub + 0.2 * lowpass(noise(d), 500), 0.6)
    # kinetic hum (subtle gear whir) used near running networks
    save("hum", whir(1.5, 110, 112, 2, 0.5) * 0.6 + 0.2 * grind(1.5, 800, 3000, 20), 0.35)
    # contraption start / stop rumble
    save("contraption_start", whir(0.8, 60, 120, 3, 0.7) + 0.4 * grind(0.8, 60, 400, 5), 0.7)
    save("contraption_stop", clank(0.6, 110) * 0.7 + 0.4 * whir(0.6, 120, 50, 3, 0.7), 0.7)
    # train horn: two detuned square-ish tones
    d = 1.4
    t = t_axis(d)
    horn = sum(np.tanh(3 * np.sin(2 * np.pi * f * t)) for f in (233, 277, 311))
    save("train_horn", lowpass(horn, 2500) * env(len(t), 0.06, 10, 1, 0.25, d), 0.8)
    save("train_move", grind(1.2, 40, 500, 6) + 0.3 * whir(1.2, 45, 45, 1.5, 0.8), 0.6)
    # station chime (three bell tones)
    d = 1.3
    x = np.zeros(int(SR * d))
    for i, f in enumerate([784, 659, 523]):
        c = partials(0.9, [f, f * 2.0, f * 3.0], [0.5, 0.25, 0.1], [1, 0.3, 0.15])
        s = int(i * 0.18 * SR)
        x[s:s + len(c)] += c[: len(x) - s]
    save("station_chime", x, 0.6)
    # wrench ratchet
    d = 0.25
    x = np.zeros(int(SR * d))
    for p in (0.0, 0.07):
        c = partials(0.05, [2600, 5100, 7300], [0.01, 0.006, 0.004], [1, 0.5, 0.3])
        s = int(p * SR)
        x[s:s + len(c)] += c
    save("wrench", x, 0.6)
    # fault alarm
    d = 0.8
    t = t_axis(d)
    alarm = np.sign(np.sin(2 * np.pi * 440 * t)) * (np.sin(2 * np.pi * 6 * t) > 0)
    save("fault", lowpass(alarm, 3000) * env(len(t), 0.01, 10, 1, 0.1, d), 0.5)
    # funnel / item pop
    save("item_pop", partials(0.12, [900, 1800], [0.03, 0.015], [1, 0.4]) * 1.0, 0.45)
    # super glue squelch
    d = 0.35
    t = t_axis(d)
    save("glue", bandpass(noise(d), 200, 1500) * np.exp(-t / 0.1) * (1 + np.sin(2 * np.pi * 30 * t)), 0.5)
    # water wheel splash
    d = 0.9
    t = t_axis(d)
    save("water_wheel", bandpass(noise(d), 300, 5000) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 2.5 * t))) * env(len(t), 0.1, 10, 1, 0.2, d), 0.5)
    print("sounds written to", OUT)


if __name__ == "__main__":
    main()
