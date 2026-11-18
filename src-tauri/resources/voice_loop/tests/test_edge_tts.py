"""Portuguese Edge voices work without Pocket model files."""

import asyncio
import io
import wave
import pytest
from pipecat.frames.frames import ErrorFrame, TTSAudioRawFrame, TTSSpeakFrame
from pipecat.tests.utils import SleepFrame, run_test
import httpx

from lu_voice_loop.engines import Engines
from lu_voice_loop.models import EDGE_VOICES, STT_ID, check_installed, load_manifest
from lu_voice_loop.speech import EdgeTTSService, SharedWhisperSTTService, edge_pcm


def test_edge_voices_need_only_the_multilingual_recognizer(tmp_path):
    manifest = load_manifest()
    for file in manifest[STT_ID].files:
        target = tmp_path / file.path
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('wb') as handle:
            handle.truncate(file.size)
    check_installed(tmp_path, manifest)
    engines = Engines(whisper=None, tts=None, models_dir=tmp_path)
    for voice in EDGE_VOICES:
        assert engines.has_voice(voice)
        assert engines.voice_state(voice) is None
    assert not engines.has_voice('unknown')
    assert engines.tts is None


@pytest.mark.asyncio
async def test_unknown_voice_is_refused_before_network_access():
    with pytest.raises(ValueError):
        await edge_pcm('Olá', '../voice')


@pytest.mark.asyncio
async def test_network_failure_is_reported_in_portuguese(monkeypatch):
    async def fail(*args):
        raise ConnectionError('offline')

    monkeypatch.setattr('lu_voice_loop.speech.edge_pcm', fail)
    service = EdgeTTSService(voice='edge_thalita')
    frames = [frame async for frame in service.run_tts('Olá', 'test')]
    assert len(frames) == 1
    assert isinstance(frames[0], ErrorFrame)
    assert 'internet' in frames[0].error


@pytest.mark.asyncio
async def test_interruption_cancels_synthesis_without_an_error_frame(monkeypatch):
    entered = asyncio.Event()

    async def wait(*args):
        entered.set()
        await asyncio.Future()

    monkeypatch.setattr('lu_voice_loop.speech.edge_pcm', wait)
    service = EdgeTTSService(voice='edge_thalita')

    async def consume():
        return [frame async for frame in service.run_tts('Olá', 'test')]

    task = asyncio.create_task(consume())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


def test_recognizer_uses_multilingual_portuguese_settings():
    service = SharedWhisperSTTService(whisper_model=None)
    assert service._settings.model == 'base'
    assert service.language_to_service_language(None) == 'pt'
    english = SharedWhisperSTTService(whisper_model=None, language='en')
    assert english.language_to_service_language(None) == 'en'


@pytest.mark.asyncio
async def test_edge_audio_flows_through_the_existing_pipeline(monkeypatch):
    async def pcm(*args):
        return b'\x00\x01' * 2400

    monkeypatch.setattr('lu_voice_loop.speech.edge_pcm', pcm)
    service = EdgeTTSService(voice='edge_thalita')
    down, up = await run_test(service, frames_to_send=[TTSSpeakFrame('Olá.'), SleepFrame(0.3)])
    assert any(isinstance(frame, TTSAudioRawFrame) for frame in down)
    assert not any(isinstance(frame, ErrorFrame) for frame in [*down, *up])


@pytest.mark.asyncio
async def test_edge_sample_uses_the_authenticated_existing_endpoint(harness, monkeypatch):
    async def pcm(text, voice):
        assert voice == 'edge_thalita'
        assert text.startswith('Olá!')
        return b'\x00\x01' * 2400

    monkeypatch.setattr('lu_voice_loop.speech.edge_pcm', pcm)
    async with httpx.AsyncClient() as client:
        response = await client.post(harness.base + '/sample', json={'voice': 'edge_thalita'}, headers=harness.headers())
    assert response.status_code == 200
    with wave.open(io.BytesIO(response.content), 'rb') as audio:
        assert audio.getframerate() == 24000
        assert audio.getnchannels() == 1
        assert audio.getnframes() == 2400
