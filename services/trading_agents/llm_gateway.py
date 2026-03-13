"""
LLM 网关配置层 - 可替换中转站设计

设计原则：
  所有模型调用通过此层路由，网关 base_url 完全由环境变量控制。
  当前默认：AIHubMix（https://aihubmix.com/v1）
  将来：改 LLM_GATEWAY_URL 环境变量即可切换到自研中转站，业务代码零改动。

环境变量优先级（高→低）：
  1. LLM_GATEWAY_URL        自定义网关（最高优先级，填自研中转站地址）
  2. AIHUBMIX_API_KEY       AIHubMix（当前默认供应商）
  3. OPENAI_API_KEY         OpenAI 直连
  4. OPENROUTER_API_KEY     OpenRouter 兜底
  
  LLM_GATEWAY_FALLBACK_MODE: "cascade"（逐级降级）或 "random"（随机轮询）

模型别名系统：
  用户在 ModelSelector 选的是"免费/标准/高级/旗舰"，
  网关层把别名翻译成实际模型 ID，这样将来换供应商无需改前端。

  alias → actual model（可通过 LLM_MODEL_ALIASES 环境变量 JSON 覆盖整个映射）:
    "free"      → stepfun/step-3.5-flash（OpenRouter免费）
    "standard"  → deepseek/deepseek-chat（DeepSeek标准）
    "advanced"  → claude-3-5-sonnet-20241022（Claude高级）
    "flagship"  → gemini-1.5-pro（Gemini旗舰）
    "fast"      → deepseek/deepseek-chat（速度优先）
    "cheap"     → stepfun/step-3.5-flash（成本优先）
    "smart"     → claude-3-5-sonnet-20241022（质量优先）
    
成本追踪：
  每次调用后记录 prompt_tokens/completion_tokens/cost_usd 到 SQLite，
  供 Token 计量系统（/api/usage）读取。
"""

import os
import json
import logging
import time
from typing import Optional, Dict, Any, List
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# ─── 网关配置 ──────────────────────────────────────────────
# 修改一个环境变量即可切换整个中转站
# 将来自研中转站上线后，设置 LLM_GATEWAY_URL=https://api.your-relay.com/v1

GATEWAY_PROFILES = {
    "self_hosted": {
        "name": "自研中转站",
        "base_url": os.getenv("LLM_GATEWAY_URL", ""),
        "api_key_env": "LLM_GATEWAY_KEY",
        "priority": 0,  # 最高优先级
    },
    "aihubmix": {
        "name": "AIHubMix",
        "base_url": "https://aihubmix.com/v1",
        "api_key_env": "AIHUBMIX_API_KEY",
        "priority": 1,
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "api_key_env": "OPENROUTER_API_KEY",
        "priority": 2,
    },
    "openai_direct": {
        "name": "OpenAI直连",
        "base_url": "https://api.openai.com/v1",
        "api_key_env": "OPENAI_API_KEY",
        "priority": 3,
    },
}

# 模型别名映射（前端用alias，这里翻译成实际ID）
# 可以通过 LLM_MODEL_ALIASES 环境变量（JSON格式）完整覆盖
DEFAULT_MODEL_ALIASES = {
    "free":     "openrouter/stepfun/step-3.5-flash:free",
    "standard": "deepseek/deepseek-chat",
    "advanced": "anthropic/claude-3-5-sonnet-20241022",
    "flagship": "google/gemini-1.5-pro",
    "fast":     "deepseek/deepseek-chat",
    "cheap":    "openrouter/stepfun/step-3.5-flash:free",
    "smart":    "anthropic/claude-3-5-sonnet-20241022",
    # 内部 Agent 使用的别名
    "orchestrator": "anthropic/claude-3-5-sonnet-20241022",
    "analyst":      "deepseek/deepseek-chat",
    "screener":     "openrouter/stepfun/step-3.5-flash:free",
}

@dataclass
class GatewayConfig:
    """
    当前生效的网关配置
    优先使用 self_hosted（LLM_GATEWAY_URL 非空时），
    否则按 priority 顺序找第一个有 API Key 的供应商
    """
    name: str
    base_url: str
    api_key: str
    profile_id: str
    model_aliases: Dict[str, str] = field(default_factory=dict)

    @classmethod
    def resolve(cls) -> "GatewayConfig":
        """
        自动选择当前可用的最高优先级网关
        """
        # 允许通过环境变量覆盖整个别名映射
        aliases = DEFAULT_MODEL_ALIASES.copy()
        if alias_override := os.getenv("LLM_MODEL_ALIASES"):
            try:
                aliases.update(json.loads(alias_override))
            except json.JSONDecodeError:
                logger.warning("LLM_MODEL_ALIASES 格式错误，使用默认映射")

        sorted_profiles = sorted(GATEWAY_PROFILES.items(), key=lambda x: x[1]["priority"])
        for profile_id, profile in sorted_profiles:
            base_url = profile["base_url"]
            api_key = os.getenv(profile["api_key_env"], "")
            if base_url and api_key:
                logger.info(f"LLM 网关：使用 {profile['name']} ({base_url})")
                return cls(
                    name=profile["name"],
                    base_url=base_url,
                    api_key=api_key,
                    profile_id=profile_id,
                    model_aliases=aliases,
                )
        
        # 最终兜底：OpenRouter（可能有免费额度）
        logger.warning("未找到可用网关配置，使用 OpenRouter 兜底（可能缺少 API Key）")
        return cls(
            name="OpenRouter兜底",
            base_url="https://openrouter.ai/api/v1",
            api_key=os.getenv("OPENROUTER_API_KEY", ""),
            profile_id="openrouter",
            model_aliases=aliases,
        )

    def resolve_model(self, model_or_alias: str) -> str:
        """
        把别名翻译成实际模型 ID
        如果不是别名，直接原样返回
        """
        return self.model_aliases.get(model_or_alias, model_or_alias)

    def to_dict(self) -> Dict:
        """返回脱敏的配置信息（用于日志/调试）"""
        return {
            "name": self.name,
            "base_url": self.base_url,
            "profile_id": self.profile_id,
            "api_key_masked": f"{self.api_key[:6]}...{self.api_key[-4:]}" if len(self.api_key) > 10 else "***",
        }


# 全局单例
_gateway_config: Optional[GatewayConfig] = None

def get_gateway() -> GatewayConfig:
    """获取当前网关配置（单例，进程内缓存）"""
    global _gateway_config
    if _gateway_config is None:
        _gateway_config = GatewayConfig.resolve()
    return _gateway_config

def reset_gateway():
    """重置网关配置（环境变量改变后调用）"""
    global _gateway_config
    _gateway_config = None