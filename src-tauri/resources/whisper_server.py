"""
Persistent faster-whisper server for BionicLLM Studio.
Communicates via stdin/stdout with line-based JSON protocol.

Input (one JSON per line on stdin):
  {"action": "transcribe", "path": "/tmp/audio.wav"}
  {"action": "status"}
  {"action": "quit"}

Output (one JSON per line on stdout):
  {"status": "ready", "backend": "faster-whisper"}
  {"transcript": "hello world", "language": "en"}
  {"error": "..."}
"""

import sys
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory


def error_text(e: BaseException) -> str:
    """One exception, in English.

    An OSError carries the operating system's own sentence in `strerror`, and
    on a German Windows that sentence is German. This text is not a log line:
    it travels back to the app in the `error` field and is shown to the user,
    who set the app to English. So the wording is dropped and the number kept.
    The number means the same thing in every language and is what anyone
    searches for. Every other exception's text is Python's own and is already
    English, so it is passed through untouched.
    """
    if isinstance(e, OSError):
        code = getattr(e, "winerror", None) or e.errno
        where = " on %s" % e.filename if e.filename else ""
        if code is None:
            return "%s%s" % (type(e).__name__, where)
        return "%s%s (os error %s)" % (type(e).__name__, where, code)
    return str(e)

WHISPER_RATE = 16000


def wav_samples(path: str):
    """A 16-bit PCM WAV file as mono float32 at 16 kHz, or None when it is not one.

    Dictation always records this format (src/api/voice.ts, pcmToWav), at
    16 kHz or at the lower rate of the microphone. Read with the standard
    library, so it does not depend on the audio decoder faster-whisper uses
    for files.
    """
    import wave

    import numpy as np

    try:
        with wave.open(path, "rb") as wav:
            if wav.getsampwidth() != 2 or wav.getcomptype() != "NONE":
                return None
            rate, channels = wav.getframerate(), wav.getnchannels()
            frames = wav.readframes(wav.getnframes())
    except (wave.Error, EOFError, OSError):
        return None
    if rate <= 0 or channels <= 0:
        return None
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    if channels > 1:
        samples = samples[: len(samples) - len(samples) % channels].reshape(-1, channels).mean(axis=1)
    if rate != WHISPER_RATE and len(samples) > 0:
        count = int(round(len(samples) * WHISPER_RATE / rate))
        samples = np.interp(np.linspace(0, len(samples) - 1, count), np.arange(len(samples)), samples)
    return samples.astype(np.float32)


def keep_decoder_call_working(av):
    """Let faster-whisper open a file on a PyAV that dropped `metadata_errors`.

    faster-whisper up to 1.2.1 opens every file with
    av.open(file, mode="r", metadata_errors="ignore"). PyAV 19 removed that
    argument and reads metadata byte exact instead, so the call dies with a
    TypeError before a sample is read, and "ignore" has nothing left to ask
    for. A fresh install on Python 3.12 or later gets exactly this pair,
    because faster-whisper asks for av>=11 and nothing more.

    Pinning av at install time would not hold. Dictation shares its Python
    with ComfyUI, whose own requirements ask for a floating av, so any later
    ComfyUI install, update or repair moves av forward again, and the pin
    would reach nobody whose install is already broken. This file ships with
    the app, so it mends both. The argument is only dropped after PyAV has
    refused it; an older PyAV still gets it.
    """
    opened = av.open

    def open_for_faster_whisper(*args, **kwargs):
        try:
            return opened(*args, **kwargs)
        except TypeError as e:
            if "metadata_errors" not in kwargs or "metadata_errors" not in str(e):
                raise
            kwargs.pop("metadata_errors")
            return opened(*args, **kwargs)

    av.open = open_for_faster_whisper


def transcribe_file(model, path: str):
    """Text and language of one recording.

    faster-whisper decodes a file through PyAV. Should that decoder fail on
    the WAV that dictation writes, for a reason keep_decoder_call_working
    does not cover, the samples are read here and handed over directly.
    """
    try:
        segments, info = model.transcribe(path)
    except Exception:
        samples = wav_samples(path)
        if samples is None:
            raise
        segments, info = model.transcribe(samples)
    return " ".join([s.text for s in segments]).strip(), info.language


def load_base_model():
    from faster_whisper import WhisperModel
    from faster_whisper.utils import download_model
    from huggingface_hub import hf_hub_download
    from huggingface_hub.utils import LocalEntryNotFoundError

    try:
        folder = Path(download_model("base", local_files_only=True))
    except LocalEntryNotFoundError:
        folder = Path(download_model("base"))

    # A snapshot can exist even when a cached blob is empty or a link points
    # to a missing blob. A normal Hub download treats that file as cached.
    for filename in ("model.bin", "config.json"):
        try:
            if (folder / filename).stat().st_size > 0:
                continue
        except FileNotFoundError:
            pass
        print(f"Repairing faster-whisper cache: {filename}", file=sys.stderr, flush=True)
        try:
            # Download beside the snapshot. Some Hub versions keep a broken
            # pointer even after forcing a download into the shared cache.
            with TemporaryDirectory(prefix=".bionic-repair-", dir=folder) as staging:
                repaired = Path(hf_hub_download(
                    "Systran/faster-whisper-base",
                    filename,
                    revision=folder.name,
                    local_dir=staging,
                    force_download=True,
                    token=False,
                ))
                if repaired.stat().st_size == 0:
                    raise ValueError("Empty model file after download")
                os.replace(repaired, folder / filename)
        except Exception as e:
            print(f"Whisper cache repair failed: {type(e).__name__}", file=sys.stderr, flush=True)
            raise RuntimeError("O arquivo do modelo Whisper está incompleto. Conecte-se à internet e tente transcrever novamente para reparar o download.") from e

    return WhisperModel(str(folder), device="cpu", compute_type="int8")


def main():
    # Unbuffered stdout for real-time communication with Node.js
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)

    print("Loading faster-whisper model...", file=sys.stderr, flush=True)

    try:
        import av
        import faster_whisper
    except ImportError:
        respond({"status": "error", "error": "faster-whisper not installed"})
        sys.exit(1)
    keep_decoder_call_working(av)

    # Load model once — this is the slow part (~170s on some systems)
    try:
        model = load_base_model()
        print("Model loaded, ready for transcription.", file=sys.stderr, flush=True)
    except Exception as e:
        respond({"status": "error", "error": f"Model load failed: {error_text(e)}"})
        sys.exit(1)

    # Signal readiness
    respond({"status": "ready", "backend": "faster-whisper"})

    # Main loop: read commands from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            respond({"error": "Invalid JSON"})
            continue

        action = cmd.get("action", "")

        if action == "status":
            respond({"status": "ready", "backend": "faster-whisper"})

        elif action == "transcribe":
            audio_path = cmd.get("path", "")
            if not audio_path or not os.path.exists(audio_path):
                respond({"error": f"File not found: {audio_path}", "transcript": ""})
                continue

            try:
                text, language = transcribe_file(model, audio_path)
                respond({"transcript": text, "language": language})
            except Exception as e:
                respond({"error": error_text(e), "transcript": ""})

        elif action == "quit":
            respond({"status": "stopped"})
            break

        else:
            respond({"error": f"Unknown action: {action}"})


def respond(data: dict):
    """Write a JSON response line to stdout."""
    print(json.dumps(data), flush=True)


if __name__ == "__main__":
    main()
