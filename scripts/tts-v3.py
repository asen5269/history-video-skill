"""V3 binary WebSocket TTS bridge. Job JSON via stdin; credentials only from env."""
import asyncio
import gzip
import hashlib
import json
import os
import struct
import sys
import uuid
from pathlib import Path

CONNECTION_EVENTS = {1, 2, 50, 51, 52}


def packet(event, payload=None, session='', kind=1, connection=''):
    body = payload if isinstance(payload, bytes) else json.dumps(payload or {}, ensure_ascii=False).encode('utf8')
    parts = [bytes([0x11, (kind << 4) | 4, 0 if isinstance(payload, bytes) else 0x10, 0]), struct.pack('>i', event)]
    identifier = connection if event in {50, 51, 52} else session
    if event not in {1, 2}:
        b = identifier.encode('utf8')
        parts += [struct.pack('>I', len(b)), b]
    return b''.join(parts + [struct.pack('>I', len(body)), body])


def unpack(data):
    if not isinstance(data, bytes) or len(data) < 4 or data[0] >> 4 != 1:
        raise ValueError('无效V3消息头')
    offset = (data[0] & 15) * 4
    if offset < 4 or offset > len(data):
        raise ValueError('无效V3头长度')
    kind, flags, compression = data[1] >> 4, data[1] & 15, data[2] & 15

    def number(signed=False):
        nonlocal offset
        if offset + 4 > len(data):
            raise ValueError('V3消息截断')
        n = struct.unpack_from('>i' if signed else '>I', data, offset)[0]
        offset += 4
        return n

    def sized():
        nonlocal offset
        size = number()
        if offset + size > len(data):
            raise ValueError('V3载荷截断')
        b = data[offset:offset + size]
        offset += size
        return b

    code = number() if kind == 15 else None
    sequence = number(True) if kind != 15 and (flags & 3) in {1, 3} else None
    event = number(True) if flags & 4 else None
    identifier = sized().decode('utf8') if event is not None and event not in {1, 2} else ''
    body = sized()
    if offset != len(data):
        raise ValueError('V3消息含多余字节')
    if compression == 1:
        body = gzip.decompress(body)
    elif compression != 0:
        raise ValueError('不支持的V3压缩')
    return {'kind': kind, 'event': event, 'id': identifier, 'code': code, 'sequence': sequence, 'body': body}


def headers():
    result = {'X-Api-Resource-Id': 'seed-tts-2.0', 'X-Api-Connect-Id': str(uuid.uuid4()),
              'X-Api-Request-Id': str(uuid.uuid4()), 'X-Control-Require-Usage-Tokens-Return': '*'}
    key = os.environ.get('DOUBAO_TTS_API_KEY')
    if key:
        result['X-Api-Key'] = key
    elif os.environ.get('DOUBAO_TTS_APPID') and os.environ.get('DOUBAO_TTS_TOKEN'):
        result.update({'X-Api-App-Id': os.environ['DOUBAO_TTS_APPID'], 'X-Api-Access-Key': os.environ['DOUBAO_TTS_TOKEN']})
    else:
        raise ValueError('缺少DOUBAO_TTS_API_KEY，或旧版APPID/TOKEN')
    return result


def safe_error(error):
    if isinstance(error, ValueError):
        msg = str(error)
    elif getattr(error, 'response', None) is not None:
        response = error.response
        msg = f'WebSocket HTTP {response.status_code}'
        body = getattr(response, 'body', b'')
        if body:
            msg += ': ' + body.decode('utf8', 'replace')[:500]
    else:
        msg = type(error).__name__
    for key in ['DOUBAO_TTS_API_KEY', 'DOUBAO_TTS_APPID', 'DOUBAO_TTS_TOKEN']:
        value = os.environ.get(key)
        if value:
            msg = msg.replace(value, '[redacted]')
    return msg


async def receive(ws):
    msg = unpack(await asyncio.wait_for(ws.recv(), timeout=30))
    if msg['kind'] == 15 or msg['event'] in {51, 153}:
        payload = json.loads(msg['body'])
        raise ValueError('TTS服务拒绝: ' + json.dumps(payload, ensure_ascii=False))
    return msg


async def expect(ws, event, session=None):
    msg = await receive(ws)
    if msg['event'] != event or (session is not None and msg['id'] != session):
        raise ValueError('V3事件顺序或会话ID不匹配')
    return msg


async def synthesize(ws, item, output):
    session = str(uuid.uuid4())
    spec = item['spec']
    params = {'speaker': spec['voice'], 'audio_params': {
        'format': spec['encoding'], 'sample_rate': spec['sampleRate'], 'bit_rate': spec['bitRate'],
        'speech_rate': spec['speechRate'], 'enable_subtitle': spec['enableSubtitle']}}
    start = {'user': {'uid': 'history-video'}, 'namespace': 'BidirectionalTTS', 'event': 100, 'req_params': params}
    await ws.send(packet(100, start, session))
    await expect(ws, 150, session)
    task = {'user': {'uid': 'history-video'}, 'namespace': 'BidirectionalTTS', 'event': 200, 'req_params': {'text': item['text']}}
    await ws.send(packet(200, task, session))
    await ws.send(packet(102, session=session))
    audio, subtitles, usage = [], [], None
    while True:
        msg = await receive(ws)
        if msg['id'] != session:
            raise ValueError('V3返回了其他会话的数据')
        if msg['kind'] == 11 and msg['event'] == 352:
            audio.append(msg['body'])
        elif msg['event'] == 364:
            subtitles.append(json.loads(msg['body']))
        elif msg['event'] in {154, 152}:
            payload = json.loads(msg['body'])
            usage = payload.get('usage', usage)
        if msg['event'] == 152:
            break
    data = b''.join(audio)
    if not data:
        raise ValueError('V3会话结束但音频为空')
    target = output / (item['id'] + '.mp3')
    temporary = Path(str(target) + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(target)
    digest = hashlib.sha256(data).hexdigest()
    subtitle_file = Path(str(target) + '.subtitles.json')
    subtitle_file.write_text(json.dumps({'schema': 1, 'timebase': 'raw-sentence', 'tts': item['text'],
        'audioHash': digest, 'events': subtitles, 'usage': usage}, ensure_ascii=False, indent=2), 'utf8')
    meta = {**item['spec'], 'audioHash': digest, 'subtitleFile': subtitle_file.name}
    Path(str(target) + '.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2), 'utf8')
    print('ok ' + item['id'], flush=True)


async def run(job):
    from websockets.asyncio.client import connect
    output = Path(job['output'])
    for item in job['items']:
        if not item['id'].isascii() or not item['id'][0].isalpha() or any(not(c.isalnum() or c in '_-') for c in item['id']):
            raise ValueError('非法句子ID')
    output.mkdir(parents=True, exist_ok=True)
    url = os.environ.get('HV_TTS_V3_URL', 'wss://openspeech.bytedance.com/api/v3/tts/bidirection')
    async with connect(url, additional_headers=headers(), open_timeout=20, close_timeout=5,
                       max_size=16 * 1024 * 1024, compression=None) as ws:
        await ws.send(packet(1))
        await expect(ws, 50)
        for item in job['items']:
            await asyncio.wait_for(synthesize(ws, item, output), timeout=300)
        await ws.send(packet(2))
        await expect(ws, 52)


if __name__ == '__main__':
    try:
        asyncio.run(run(json.load(sys.stdin)))
    except Exception as error:
        print('FAIL ' + safe_error(error), file=sys.stderr)
        sys.exit(1)
