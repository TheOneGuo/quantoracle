"""
LLM 客户端，支持 Ollama 主力（qwen2.5:9b）和 OpenRouter 兜底
配置从环境变量读取：
- OLLAMA_BASE_URL: Ollama 地址（默认 http://localhost:11434）
- OPENROUTER_API_KEY: 兜底模型 API Key
"""

import os
import json
import logging
import time
from typing import Optional, Dict, Any, Union

import requests
from requests.exceptions import RequestException, Timeout

logger = logging.getLogger(__name__)


class LLMClient:
    """
    统一 LLM 调用客户端，支持多路降级策略和动态模型选择。
    
    调用顺序：
    1. 如果指定了模型ID且是OpenRouter模型，直接调用OpenRouter
    2. 否则尝试 Ollama（qwen2.5:9b）
    3. 若失败，尝试 OpenRouter 默认兜底模型
    4. 若兜底也失败，返回模拟数据并标记 llm_available=False
    """
    
    def __init__(self):
        # 配置读取
        self.ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self.openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        self.openrouter_url = "https://openrouter.ai/api/v1/chat/completions"
        
        # 模型配置
        # 主力：Ollama 本地（Mac Mini M4，离线时自动降级）
        self.ollama_model = "qwen2.5:9b"
        # 当前兜底：StepFun step-3.5-flash（免费，OpenRouter）
        # 待 Mac Mini 上线后可切回 deepseek/deepseek-v3.2
        self.default_openrouter_model = os.getenv(
            "OPENROUTER_MODEL", "stepfun/step-3.5-flash:free"
        )
        
        # 超时配置（秒）
        self.ollama_timeout = 60
        self.openrouter_timeout = 30
        self.max_retries = 2
        
        # 状态标记
        self.llm_available = True
        self.last_error = None
        
        # 模型成本映射（token/次，简化估算）
        self.model_cost_map = {
            "stepfun/step-3.5-flash:free": 0,
            "deepseek/deepseek-v3.2": 15000,
            "anthropic/claude-sonnet-4-5": 60000,
            "openai/gpt-4.5": 120000
        }
    
    def _call_ollama(self, prompt: str, system_prompt: Optional[str] = None) -> Optional[str]:
        """
        调用 Ollama API
        
        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词，可选
            
        Returns:
            模型回复文本，失败返回 None
        """
        payload = {
            "model": self.ollama_model,
            "prompt": prompt,
            "system": system_prompt or "You are a helpful AI assistant for quantitative stock analysis.",
            "stream": False,
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "max_tokens": 2048
            }
        }
        
        for attempt in range(self.max_retries):
            try:
                logger.debug(f"Calling Ollama (attempt {attempt+1}) at {self.ollama_url}")
                response = requests.post(
                    f"{self.ollama_url}/api/generate",
                    json=payload,
                    timeout=self.ollama_timeout
                )
                response.raise_for_status()
                result = response.json()
                return result.get("response", "").strip()
            except Timeout:
                logger.warning(f"Ollama timeout (attempt {attempt+1})")
                if attempt == self.max_retries - 1:
                    self.last_error = "Ollama 服务超时"
            except RequestException as e:
                logger.warning(f"Ollama request failed: {e}")
                if attempt == self.max_retries - 1:
                    self.last_error = f"Ollama 请求失败: {e}"
            except Exception as e:
                logger.error(f"Unexpected Ollama error: {e}")
                if attempt == self.max_retries - 1:
                    self.last_error = f"Ollama 未知错误: {e}"
            
            # 等待后重试
            if attempt < self.max_retries - 1:
                time.sleep(1)
        
        return None
    
    def _call_openrouter(self, messages: list, model_id: Optional[str] = None) -> Optional[str]:
        """
        调用 OpenRouter API
        
        Args:
            messages: OpenAI 格式的消息列表
            model_id: 指定的模型ID，如果为None则使用默认兜底模型
            
        Returns:
            模型回复文本，失败返回 None
        """
        if not self.openrouter_key:
            logger.warning("OpenRouter API key not configured")
            return None
        
        headers = {
            "Authorization": f"Bearer {self.openrouter_key}",
            "Content-Type": "application/json"
        }
        
        # 使用指定的模型或默认兜底模型
        model_to_use = model_id or self.default_openrouter_model
        
        payload = {
            "model": model_to_use,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 2048
        }
        
        try:
            logger.debug(f"Calling OpenRouter with model: {model_to_use}")
            response = requests.post(
                self.openrouter_url,
                json=payload,
                headers=headers,
                timeout=self.openrouter_timeout
            )
            response.raise_for_status()
            result = response.json()
            
            # 记录token使用量（如果API返回）
            if "usage" in result:
                tokens_used = result["usage"].get("total_tokens", 0)
                logger.debug(f"OpenRouter API used {tokens_used} tokens")
            
            return result["choices"][0]["message"]["content"].strip()
        except Timeout:
            logger.warning("OpenRouter timeout")
            self.last_error = "OpenRouter 服务超时"
        except RequestException as e:
            logger.warning(f"OpenRouter request failed: {e}")
            self.last_error = f"OpenRouter 请求失败: {e}"
        except Exception as e:
            logger.error(f"Unexpected OpenRouter error: {e}")
            self.last_error = f"OpenRouter 未知错误: {e}"
        
        return None
    
    def generate(self, prompt: str, system_prompt: Optional[str] = None, 
                model_id: Optional[str] = None) -> Dict[str, Any]:
        """
        生成 LLM 回复，支持动态模型选择和自动降级策略
        
        Args:
            prompt: 用户提示词
            system_prompt: 系统提示词，可选
            model_id: 指定的模型ID（如 "deepseek/deepseek-v3.2"），
                    如果为None则使用默认策略（先Ollama，后OpenRouter兜底）
            
        Returns:
            字典包含：
            - text: 生成的文本（若失败则为空字符串）
            - model: 使用的模型名称
            - llm_available: LLM 是否可用
            - is_fallback: 是否使用了兜底模型
            - error: 错误信息（如果有）
            - estimated_tokens: 预估token消耗（基于模型成本映射）
        """
        # 构建消息列表
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})
        
        # 计算预估token消耗（简化估算）
        estimated_tokens = 0
        if model_id and model_id in self.model_cost_map:
            estimated_tokens = self.model_cost_map[model_id]
        elif model_id and "stepfun/step-3.5-flash" in model_id:
            estimated_tokens = 0  # 免费模型
        
        # 1. 如果指定了模型ID且是OpenRouter支持的模型
        if model_id and (model_id.startswith("stepfun/") or 
                        model_id.startswith("deepseek/") or 
                        model_id.startswith("anthropic/") or 
                        model_id.startswith("openai/")):
            
            openrouter_response = self._call_openrouter(messages, model_id)
            if openrouter_response is not None:
                return {
                    "text": openrouter_response,
                    "model": model_id,
                    "llm_available": True,
                    "is_fallback": False,
                    "error": None,
                    "estimated_tokens": estimated_tokens
                }
            else:
                # 指定的OpenRouter模型失败，降级到默认策略
                logger.warning(f"指定模型 {model_id} 调用失败，降级到默认策略")
        
        # 2. 尝试 Ollama（默认主力）
        ollama_response = self._call_ollama(prompt, system_prompt)
        if ollama_response is not None:
            return {
                "text": ollama_response,
                "model": self.ollama_model,
                "llm_available": True,
                "is_fallback": False,
                "error": None,
                "estimated_tokens": 0  # 本地模型不计费
            }
        
        # 3. 尝试 OpenRouter 默认兜底模型
        openrouter_response = self._call_openrouter(messages, None)  # 使用默认兜底模型
        if openrouter_response is not None:
            return {
                "text": openrouter_response,
                "model": self.default_openrouter_model,
                "llm_available": True,
                "is_fallback": True,
                "error": self.last_error,
                "estimated_tokens": self.model_cost_map.get(self.default_openrouter_model, 0)
            }
        
        # 4. 全部失败，标记为不可用
        self.llm_available = False
        logger.error("All LLM providers failed, falling back to mock responses")
        return {
            "text": "",
            "model": "none",
            "llm_available": False,
            "is_fallback": True,
            "error": self.last_error,
            "estimated_tokens": 0
        }
    
    def generate_json(self, prompt: str, system_prompt: Optional[str] = None,
                    model_id: Optional[str] = None) -> Optional[Dict]:
        """
        生成 JSON 格式的 LLM 回复，自动解析，支持动态模型选择
        
        Args:
            prompt: 提示词，要求模型返回 JSON
            system_prompt: 系统提示词，可选
            model_id: 指定的模型ID
            
        Returns:
            解析后的字典，解析失败或生成失败返回 None
        """
        # 增强系统提示词，要求返回 JSON
        json_system_prompt = (system_prompt or "") + "\n\n请确保你的回复是有效的 JSON 格式。"
        
        result = self.generate(prompt, json_system_prompt, model_id)
        if not result["text"]:
            return None
        
        try:
            # 尝试提取 JSON（可能模型返回了一些额外的文字）
            text = result["text"].strip()
            # 寻找第一个 { 和最后一个 }
            start = text.find('{')
            end = text.rfind('}')
            if start >= 0 and end > start:
                json_str = text[start:end+1]
                return json.loads(json_str)
            # 如果没找到，尝试直接解析整个文本
            return json.loads(text)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM JSON response: {e}\nResponse: {result['text']}")
            return None
    
    def is_available(self) -> bool:
        """
        检查 LLM 服务是否可用（至少有一种可用）
        
        Returns:
            bool: 是否可用
        """
        return self.llm_available


# 全局单例实例
_llm_client = None

def get_llm_client() -> LLMClient:
    """
    获取全局 LLM 客户端实例（单例模式）
    
    Returns:
        LLMClient 实例
    """
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient()
    return _llm_client


if __name__ == "__main__":
    # 测试代码
    client = LLMClient()
    print("Testing LLM client...")
    result = client.generate("Hello, who are you?", "You are a helpful assistant.")
    print(f"Result: {result}")
    print(f"LLM available: {client.is_available()}")