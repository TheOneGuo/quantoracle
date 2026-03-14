"""
@file Telegram私有频道/群消息抓取服务
@description 使用 Telethon 以用户身份登录，读取私有频道消息
             需要从 my.telegram.org 申请 api_id 和 api_hash
             配置方式：在 .env 中填入 TG_API_ID / TG_API_HASH / TG_PHONE

使用方法：
  1. 首次运行：python private_fetcher.py --auth
     会要求输入手机号和验证码，完成后保存 session 文件
  2. 后续运行：python private_fetcher.py
     自动使用已保存的 session，无需重新登录

HTTP服务：监听 :8768，供 Node.js 后端调用
  GET /fetch?channel=<username_or_id>&limit=20
  GET /health
"""

import os
import asyncio
import argparse
from datetime import datetime
from flask import Flask, jsonify, request
from telethon import TelegramClient
from telethon.sessions import StringSession

# 从环境变量读取（.env 不进 git）
API_ID = int(os.getenv('TG_API_ID', '0'))
API_HASH = os.getenv('TG_API_HASH', '')
PHONE = os.getenv('TG_PHONE', '')
SESSION_STRING = os.getenv('TG_SESSION_STRING', '')  # 或用文件session

app = Flask(__name__)
client = None

async def init_client():
    """初始化 Telethon 客户端"""
    global client
    if SESSION_STRING:
        client = TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH)
    else:
        client = TelegramClient('tg_session', API_ID, API_HASH)
    await client.start(phone=PHONE)
    return client

async def fetch_messages(channel_id: str, limit: int = 20, offset_id: int = 0):
    """
    从频道抓取消息
    @param channel_id: 频道username（@cnwallstreet）或数字ID
    @param limit: 抓取数量
    @param offset_id: 从此消息ID之后抓取（增量用）
    @returns: 标准化消息列表
    """
    messages = []
    async for msg in client.iter_messages(channel_id, limit=limit, offset_id=offset_id):
        if msg.text:
            messages.append({
                'raw_id': str(msg.id),
                'content': msg.text,
                'published_at': msg.date.isoformat(),
                'views': getattr(msg, 'views', 0) or 0,
                'url': f'https://t.me/{channel_id.lstrip("@")}/{msg.id}',
            })
    return messages

@app.route('/fetch')
def fetch():
    channel = request.args.get('channel', '')
    limit = int(request.args.get('limit', 20))
    offset_id = int(request.args.get('offset_id', 0))
    
    if not channel:
        return jsonify({'success': False, 'error': 'channel参数必填'})
    
    loop = asyncio.new_event_loop()
    try:
        msgs = loop.run_until_complete(fetch_messages(channel, limit, offset_id))
        return jsonify({'success': True, 'count': len(msgs), 'data': msgs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
    finally:
        loop.close()

@app.route('/health')
def health():
    return jsonify({'ok': True, 'connected': client.is_connected() if client else False})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth', action='store_true', help='首次登录认证')
    parser.add_argument('--port', type=int, default=8768)
    args = parser.parse_args()
    
    asyncio.run(init_client())
    app.run(host='0.0.0.0', port=args.port)
