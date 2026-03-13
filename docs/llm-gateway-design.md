# LLM 网关设计文档

> 智盈云 QuantOracle - LLM 调用层架构

## 核心理念

所有 LLM 调用通过 `llm_gateway.py` 统一路由，**网关地址完全由环境变量控制**。  
当前默认：AIHubMix；将来自研中转站上线后，只需改一个环境变量，业务代码零改动。

```
TradingAgents / Kronos / 回测引擎
          ↓
    llm_gateway.py（统一入口）
          ↓ 环境变量决定走哪里
   ┌──────────────────────────────┐
   │ 优先级1: 自研中转站（将来） │  LLM_GATEWAY_URL + LLM_GATEWAY_KEY
   │ 优先级2: AIHubMix（当前）   │  AIHUBMIX_API_KEY
   │ 优先级3: OpenRouter（兜底） │  OPENROUTER_API_KEY
   │ 优先级4: OpenAI直连         │  OPENAI_API_KEY
   └──────────────────────────────┘
```

---

## 切换中转站

### 当前（使用 AIHubMix）
```bash
export AIHUBMIX_API_KEY=sk-xxx
# LLM_GATEWAY_URL 不设置，自动使用 AIHubMix
```

### 将来（切换到自研中转站）
```bash
export LLM_GATEWAY_URL=https://api.quantoracle-relay.com/v1
export LLM_GATEWAY_KEY=qo-xxx
# 业务代码一行不改，所有调用自动走新网关
```

---

## 模型别名映射

前端 ModelSelector 展示的是「免费 / 标准 / 高级 / 旗舰」，  
网关层把别名翻译成实际模型 ID。将来换供应商时，只改映射表，前端和业务代码都不用动。

| 别名 | 当前模型 | 说明 |
|------|----------|------|
| `free` | stepfun/step-3.5-flash:free | 免费，适合简单任务 |
| `standard` | deepseek/deepseek-chat | 均衡，日常分析 |
| `advanced` | anthropic/claude-3-5-sonnet | 高质量，复杂推理 |
| `flagship` | google/gemini-1.5-pro | 旗舰，长文本分析 |
| `fast` | deepseek/deepseek-chat | 速度优先 |
| `cheap` | stepfun/step-3.5-flash:free | 成本优先 |
| `smart` | anthropic/claude-3-5-sonnet | 质量优先 |
| `orchestrator` | anthropic/claude-3-5-sonnet | 主控 Agent |
| `analyst` | deepseek/deepseek-chat | 分析 Agent |
| `screener` | stepfun/step-3.5-flash:free | 选股 Agent |

### 覆盖别名映射（JSON格式）
```bash
# 将"标准"模型切换为 GPT-4o
export LLM_MODEL_ALIASES='{"standard":"gpt-4o","advanced":"claude-opus-4"}'
```

---

## 降级链路

```
指定模型调用
   └─ 失败 → Ollama 本地（Mac Mini M4，qwen2.5:9b）
               └─ 失败 → OpenRouter 兜底（stepfun:free）
                           └─ 失败 → 规则引擎兜底（纯代码，无LLM）
```

本地 Ollama 优先：成本为零，延迟低，适合高频调用。  
OpenRouter 兜底：确保云端有网时一定可用。  
规则引擎兜底：极端情况下系统仍可运行，不会崩溃。

---

## 与 AIHubMix 的关系

| 维度 | AIHubMix（当前） | 自研中转站（规划） |
|------|-----------------|-------------------|
| 定位 | API 聚合器（开发者工具） | 金融 AI 应用平台 |
| 盈利模式 | Token 差价 | Token 差价 + 策略订阅 + 数据变现 |
| 核心壁垒 | 接入模型多 | 金融垂类数据 + 知识库 + 回测 |
| 目标用户 | 开发者 | 个人/机构投资者 |

**AIHubMix 是临时上游供应商，自研中转站是终点。**  
自研中转站将额外提供：
- 金融垂类模型调度（如 Kronos 时序模型优先）
- Token 成本追踪与用户级计量
- 用户级别模型访问控制（套餐管理）
- A/B 测试和输出质量评估

---

## API

```
GET /api/gateway/status   查看当前网关配置（脱敏）
```

响应示例：
```json
{
  "gateway": {
    "active": "AIHubMix",
    "url": "https://aihubmix.com/v1 (默认)",
    "self_hosted": false,
    "switchInstruction": "设置 LLM_GATEWAY_URL=https://api.your-relay.com/v1 即可切换"
  }
}
```
