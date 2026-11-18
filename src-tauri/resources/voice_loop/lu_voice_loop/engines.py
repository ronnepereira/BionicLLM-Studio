"""The speech models, loaded once per process and shared by every session.

Importing torch and loading the weights takes seconds, so it happens in a
worker thread right after the server starts listening. /health reports
"loading" until it is done.
"""

import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .models import EDGE_VOICES, STT_ID, TTS_ID, ModelEntry, ModelFile, voices

# CPU threads for Whisper. The LLM usually runs on the same machine, so the
# recognizer must not grab every core.
STT_THREADS = max(1, min(4, (os.cpu_count() or 2) // 2))


@dataclass
class Engines:
    whisper: Any
    tts: Any
    voice_states: dict[str, Any] = field(default_factory=dict)
    tts_sample_rate: int = 24000
    # Every voice LU offers, and where its state file belongs. A voice the
    # user picked after this process started is on disk but not loaded yet.
    models_dir: Path | None = None
    voice_files: dict[str, ModelFile | None] = field(default_factory=dict)
    pocket_dir: Path | None = None

    def _voice_path(self, name: str) -> Path | None:
        f = self.voice_files.get(name)
        if f is None or self.models_dir is None:
            return None
        path = self.models_dir / f.path
        try:
            return path if path.is_file() and path.stat().st_size == f.size else None
        except OSError:
            return None

    def has_voice(self, name: str) -> bool:
        """The voice is loaded, or installed and loadable."""
        return name in EDGE_VOICES or name in self.voice_states or self._voice_path(name) is not None

    def voice_state(self, name: str) -> Any:
        """The state of an installed voice. Blocking the first time a voice is asked for."""
        if name in EDGE_VOICES:
            return None
        state = self.voice_states.get(name)
        if state is None:
            path = self._voice_path(name)
            if path is None:
                raise KeyError(name)
            if self.tts is None:
                self.tts = _load_pocket(self.pocket_dir)
            state = self.tts.get_state_for_audio_prompt(str(path))
            self.voice_states[name] = state
        return state


def _pocket_tts_config(tts_dir: Path) -> str:
    """Pocket TTS config for the English model, pointing at the installed files.

    The packaged config names Hugging Face paths, which would download at
    first use. The architecture is copied from it and only the three file
    locations are replaced, so nothing leaves the machine.
    """
    import yaml
    from pocket_tts.models import tts_model as pocket_module

    packaged = Path(pocket_module.CONFIGS_DIR) / "english.yaml"
    config = yaml.safe_load(packaged.read_text(encoding="utf-8"))
    config["weights_path"] = str(tts_dir / "model.safetensors")
    config.pop("weights_path_without_voice_cloning", None)
    config["flow_lm"]["lookup_table"]["tokenizer_path"] = str(tts_dir / "tokenizer.model")
    return yaml.safe_dump(config)


def load_engines(models_dir: Path, manifest: dict[str, ModelEntry]) -> Engines:
    """Blocking. Call from a worker thread."""
    import threading

    from tqdm import tqdm

    # tqdm (pulled in by the model libraries) otherwise creates a
    # multiprocessing lock, which starts a resource tracker child process.
    tqdm.set_lock(threading.RLock())

    from faster_whisper import WhisperModel

    whisper = WhisperModel(
        str(models_dir / manifest[STT_ID].dir), device="cpu", compute_type="int8",
        cpu_threads=STT_THREADS, local_files_only=True,
    )

    import numpy as np

    segments, _ = whisper.transcribe(np.zeros(16000, dtype=np.float32), language="pt", beam_size=1)
    list(segments)
    return Engines(
        whisper=whisper, tts=None, models_dir=models_dir, voice_files=voices(manifest),
        pocket_dir=models_dir / manifest[TTS_ID].dir,
    )


def _load_pocket(tts_dir: Path):
    """Load the legacy local synthesizer only when a Pocket voice is selected."""
    from pocket_tts import TTSModel

    # load_model only accepts a config file path. The file is removed again
    # right after loading.
    fd, config_path = tempfile.mkstemp(prefix="lu-voice-tts-", suffix=".yaml")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(_pocket_tts_config(tts_dir))
        tts = TTSModel.load_model(config=config_path)
    finally:
        try:
            os.unlink(config_path)
        except OSError:
            pass

    return tts
