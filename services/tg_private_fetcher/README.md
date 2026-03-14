# Telegram 私有频道抓取服务

## 首次配置步骤

### 1. 申请 Telegram API
前往 https://my.telegram.org，用手机号登录，点「API development tools」申请。
获得 `api_id` 和 `api_hash` 后填入 `.env`。

### 2. 配置 .env
在项目根目录 `.env` 中填入：
```
TG_API_ID=你的api_id
TG_API_HASH=你的api_hash
TG_PHONE=+86你的手机号
```

### 3. 首次登录（生成session）
```bash
cd services/tg_private_fetcher
pip install -r requirements.txt
python private_fetcher.py --auth
# 输入手机号和Telegram发来的验证码
# session 文件自动保存为 tg_session.session
```

### 4. 启动服务
```bash
python private_fetcher.py --port 8768
```

### 5. 验证
```bash
curl "http://localhost:8768/fetch?channel=cnwallstreet&limit=5"
```

## 注意事项
- `tg_session.session` 文件不要提交到 Git（已在 .gitignore 中）
- 同一账号同时只能有一个活跃 session
- 公开频道也可以用本服务抓取（比RSS更稳定）
