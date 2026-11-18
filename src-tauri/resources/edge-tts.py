"""BionicLLM EdgeTTS worker: one JSON request on stdin, bounded MP3 on stdout."""
import asyncio
import json
import sys

MAX_AUDIO = 10 * 1024 * 1024
VOICES = {"pt-BR-FranciscaNeural", "pt-BR-AntonioNeural", "pt-BR-ThalitaMultilingualNeural"}


async def main():
    import edge_tts
    payload = json.loads(sys.stdin.buffer.read(64000))
    text, voice = payload.get("text"), payload.get("voice")
    rate = payload.get("rate", 100)
    if not isinstance(text, str) or not text.strip() or len(text) > 6000:
        raise ValueError("Invalid text")
    if voice not in VOICES or type(rate) is not int or not 50 <= rate <= 150:
        raise ValueError("Invalid voice parameters")
    speech = edge_tts.Communicate(text, voice, rate=f"{rate - 100:+d}%")
    total = 0
    async for chunk in speech.stream():
        if chunk["type"] != "audio":
            continue
        total += len(chunk["data"])
        if total > MAX_AUDIO:
            raise ValueError("Audio limit")
        sys.stdout.buffer.write(chunk["data"])
    sys.stdout.buffer.flush()
    if not total:
        raise RuntimeError("No audio")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        # Never echo the user's text, payload, SSML or network headers to logs.
        print("EDGE_TTS_ERROR:" + type(error).__name__, file=sys.stderr)
        sys.exit(1)
