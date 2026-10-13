# 逐句音频强制对齐；缓存句内相对时间，字幕导出时加当前时间轴偏移。
import argparse
import hashlib
import json
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('project')
ap.add_argument('--ids', default='')
ap.add_argument('--device', default='cpu')
ap.add_argument('--force', action='store_true')
a = ap.parse_args()
p = Path(a.project)
read = lambda path: json.loads(path.read_text('utf-8-sig'))
script = read(p / 'script.json')
timeline = read(p / 'timeline.json')
if timeline['version'] != script['version']:
    ap.error('时间轴版本失效，重跑timeline')
sentences = {s['id']: s for s in script['sentences']}
only = set(filter(None, a.ids.split(',')))
if only - sentences.keys():
    ap.error('未知句子ID')
out_path = p / 'align.json'
old = read(out_path) if out_path.exists() else {}
result = old.get('items', {}) if old.get('schema') == 2 and old.get('timebase') == 'sentence' else {}
result = {sid: value for sid, value in result.items() if sid in sentences}
model_name = 'jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn'
pending = []
for sentence, item in zip(script['sentences'], timeline['items'], strict=True):
    sid = sentence['id']
    if sid != item['id'] or not sid.isascii() or not sid[0].isalpha() or not all(c.isalnum() or c in '_-' for c in sid):
        ap.error('时间轴顺序或句子ID无效')
    text = sentence['text'] if sentence.get('tts') is None else sentence['tts']
    wav = p / 'audio' / 'trim' / f'{sid}.wav'
    audio_hash = hashlib.sha256(wav.read_bytes()).hexdigest()
    if item.get('tts') != text or item.get('audioHash') != audio_hash:
        ap.error(f'{sid} 音频与时间轴不匹配，重跑trim/timeline')
    cached = result.get(sid, {})
    valid = cached.get('tts') == text and cached.get('audioHash') == audio_hash and cached.get('model') == model_name and bool(cached.get('chars'))
    if not valid:
        result.pop(sid, None)
    if only and sid not in only:
        if not valid:
            ap.error(f'{sid} 缓存失效且未包含在--ids中，请补入或不指定--ids')
        continue
    if valid and not a.force and not only:
        continue
    pending.append((sid, text, wav, audio_hash, item['end'] - item['start']))

if pending:
    import whisperx
    model, meta = whisperx.load_align_model(language_code='zh', device=a.device, model_name=model_name)
    for sid, text, wav, audio_hash, duration in pending:
        audio = whisperx.load_audio(str(wav))
        aligned = whisperx.align([{'start': 0, 'end': duration, 'text': text}], model, meta, audio, a.device, return_char_alignments=True)
        chars = [{'c': c['char'], 's': c.get('start'), 'e': c.get('end')}
                 for segment in aligned['segments'] for c in (segment.get('chars') or [])]
        if not chars:
            raise RuntimeError(f'{sid} 对齐失败，未产生字符时间戳')
        result[sid] = {'tts': text, 'audioHash': audio_hash, 'model': model_name, 'chars': chars}
        print('aligned', sid, len(chars))

out_path.write_text(json.dumps({'schema': 2, 'timebase': 'sentence', 'items': result}, ensure_ascii=False, indent=1), 'utf8')
