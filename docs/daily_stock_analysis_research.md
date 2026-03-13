# daily_stock_analysis 项目分析报告

> 项目地址：https://github.com/ZhuLinsen/daily_stock_analysis
> 分析时间：2026-03-14

## 亮点功能详解

### 1. LiteLLM 统一模型调用
- **如何实现的（代码结构）**
  - 核心配置在 `src/config.py` 中，通过 `litellm_model` 和 `litellm_fallback_models` 配置主模型和备用模型。
  - 支持多级配置优先级：1) LITELLM_CONFIG YAML 文件 2) LLM_CHANNELS 环境变量（多通道配置）3) 传统环境变量（GEMINI_API_KEY 等）。
  - LLM 调用通过 `src/agent/llm_adapter.py` 中的 `LLMToolAdapter` 类统一封装，底层使用 `litellm.completion()` 或 `litellm.Router`（多 Key 负载均衡）。
  - 支持模型前缀自动补全（如 `gemini/gemini-2.5-flash`），自动解析 provider。

- **支持的模型列表（含 AIHubMix）**
  - **直接支持**：Gemini、Anthropic Claude、OpenAI 兼容（包括 DeepSeek、通义千问等）、Vertex AI、Ollama。
  - **通过 AIHubMix 支持**：AIHubMix 是一个 API 聚合器，提供统一 OpenAI 兼容接口，支持 GPT、Claude、Gemini、DeepSeek 等主流模型，且无需科学上网。
  - **配置方式**：通过 `AIHUBMIX_KEY` 环境变量，自动设置 `OPENAI_BASE_URL=https://aihubmix.com/v1`。

- **配置方式（环境变量/config文件）**
  - **传统环境变量**：`GEMINI_API_KEY`、`ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`AIHUBMIX_KEY`、`OPENAI_BASE_URL`、`LITELLM_MODEL`、`LITELLM_FALLBACK_MODELS`。
  - **多通道配置**：`LLM_CHANNELS=aihubmix,deepseek,gemini` 配合 `LLM_<NAME>_PROTOCOL`、`LLM_<NAME>_BASE_URL`、`LLM_<NAME>_API_KEY`、`LLM_<NAME>_MODELS`。
  - **YAML 高级配置**：`LITELLM_CONFIG` 指向一个标准的 LiteLLM YAML 配置文件，支持复杂的多模型路由、负载均衡、故障转移。

- **与我们现有 llm_client.py 的差距**
  - **优势**：统一模型调用层，支持超过 20 种 provider，内置多 Key 负载均衡和故障转移，支持模型路由（Router）和复杂配置。
  - **差距**：我们目前的 `llm_client.py` 仅支持单一 OpenAI 兼容接口，缺少多模型、多 Key 管理和自动降级能力。
  - **改进方向**：用 LiteLLM 替换现有调用，获得多模型支持、负载均衡、统一错误处理。

### 2. AIHubMix 集成
- **AIHubMix 是什么（一Key多用，OpenAI兼容API）**
  - AIHubMix 是一个商业化的 AI 模型聚合平台，提供一个 API Key 即可调用 GPT、Claude、Gemini、DeepSeek 等主流模型。
  - 提供 OpenAI 兼容的接口（`https://aihubmix.com/v1`），因此任何支持 OpenAI 的客户端都可以直接使用，只需修改 `base_url`。
  - 支持免费模型（如 glm-5、gpt-4o-free）和付费模型，高稳定性、无限并发。

- **如何配置**
  - 设置环境变量 `AIHUBMIX_KEY`（必填），系统会自动将 `OPENAI_BASE_URL` 设为 `https://aihubmix.com/v1`。
  - 无需配置其他模型的 Key，只需在 `LITELLM_MODEL` 中指定模型名称（如 `gpt-4o`、`claude-3-5-sonnet`、`gemini-2.5-flash`）。
  - 支持通过 `LLM_CHANNELS` 配置多通道，其中一个通道可指向 AIHubMix。

- **与我们的 AI 中转站商业模式的关联**
  - **相似点**：都是聚合多个上游模型，提供统一 API 接口，按 Token 差价盈利。
  - **差异点**：AIHubMix 是通用聚合器，我们是金融垂类应用。AIHubMix 可成为我们的上游供应商，我们可以在其基础上构建金融专属能力（如 RAG、策略知识库、回测、实盘跟踪）。
  - **战略**：使用 AIHubMix 作为多模型接入的基础设施，减少自研模型接入成本，聚焦金融垂直领域增值服务。

### 3. AI决策仪表盘
- **核心结论 + 买卖点位 + 操作清单的实现思路**
  - 分析结果封装在 `AnalysisResult` 类中，包含 `dashboard` 字段，结构为：
    - `core_conclusion`：一句话核心结论。
    - `intelligence`：舆情情报、风险警报、利好催化。
    - `data_perspective`：数据透视（技术面、筹码结构、资金流向等）。
    - `battle_plan`：作战计划，包含狙击点位（买入价、止损价、目标价）、检查清单（满足/注意/不满足）。
  - 输出格式为 Markdown，推送时按渠道适配（支持 Markdown 转图片）。
  - 买卖点位由 LLM 根据技术面、资金面、情绪面综合生成，并遵循交易纪律（如乖离率阈值、多头排列）。

- **与我们 HotStockAnalysis 的差距**
  - **结构化程度**：daily_stock_analysis 的输出高度结构化，便于解析和后续处理；我们目前的输出为自由文本，解析困难。
  - **完整性**：包含舆情情报、风险警报、利好催化、数据透视、作战计划等多个维度；我们主要侧重技术面和简单建议。
  - **可扩展性**：支持模板渲染（Jinja2）、完整性校验、历史信号对比。
  - **改进方向**：借鉴其仪表盘结构，升级我们的分析输出为结构化格式，增加舆情、风险、利好等维度。

### 4. 智能导入（Vision LLM）
- **图片识别股票代码的实现方式**
  - 使用 Vision LLM（Gemini、Anthropic Claude、OpenAI 等支持图像的模型）解析截图或照片中的股票代码和名称。
  - 接口：`POST /api/v1/stocks/extract-from-image`，支持 JPG/PNG/WebP/GIF，≤5MB。
  - 置信度分层：高置信度自动勾选，中/低置信度需手动确认。
  - 支持多源解析：图片、CSV/Excel 文件、剪贴板粘贴。

- **是否值得移植**
  - **价值**：提升用户体验，方便用户导入自选股；可作为增值功能展示技术实力。
  - **成本**：需要 Vision API 支持（额外费用），前端需要相应 UI。
  - **优先级**：锦上添花，优先级较低。可考虑作为后续版本亮点功能。

### 5. Agent问股（多轮问答）
- **11种内置策略（均线金叉/缠论/波浪等）**
  - 策略定义在 `strategies/` 目录下，通过 YAML 文件配置，无需写代码。
  - 支持策略：均线金叉、缠论、波浪理论、多头趋势、空头趋势、震荡突破、MACD 背离、RSI 超买超卖、布林带、筹码集中、资金流入。
  - Agent 自动调用实时行情、K线、技术指标、新闻搜索等工具，生成分析结论。

- **与我们 TradingAgents 的差距**
  - **策略数量**：daily_stock_analysis 内置 11 种策略，我们目前可能较少。
  - **交互方式**：提供 Web 聊天界面、Bot 命令（`/ask <code> [strategy]`）、API 全链路支持。
  - **流式进度反馈**：实时展示 AI 思考路径（行情获取 → 技术分析 → 新闻搜索 → 生成结论）。
  - **扩展性**：支持自定义策略 YAML 文件，用户可自行添加策略。
  - **建议**：借鉴其策略定义和交互方式，丰富我们的策略库，提升用户体验。

### 6. 多渠道推送
- **企业微信/飞书/Telegram/钉钉/邮件/Pushover**
  - 支持渠道：企业微信 Webhook、飞书 Webhook、Telegram Bot、邮件 SMTP、Pushover（手机/桌面推送）、PushPlus（国内推送）、Server酱3、Discord、AstrBot、自定义 Webhook。
  - 实现架构：每个渠道对应一个 Sender 类（如 `WechatSender`、`FeishuSender`），继承自同一个基类，通过 `NotificationService` 统一管理。
  - 支持 Markdown 转图片（对不支持 Markdown 的渠道），支持消息长度限制、分批发送。

- **我们已有飞书，还缺什么**
  - **渠道覆盖**：我们目前主要支持飞书；缺少企业微信、Telegram、邮件、Pushover 等渠道。
  - **功能完整性**：缺乏 Markdown 转图片、消息长度自动分批、发送失败重试、多 Key 负载均衡（针对需要 API Key 的渠道）。
  - **建议**：参考其架构，逐步增加其他主流渠道，提升推送稳定性和用户体验。

### 7. 数据源矩阵
- **AkShare/Tushare/Pytdx/Baostock/YFinance/AkShare港股**
  - 行情数据源优先级：腾讯财经 > 新浪财经 (akshare_sina) > 东财 (efinance/akshare_em) > Tushare。
  - 支持 A股、港股、美股及美股指数（SPX、DJI、IXIC 等）。
  - 实时行情增强：支持盘中实时技术指标计算（MA/多头排列）、筹码分布（可选）、基本面聚合。

- **新闻：Tavily/SerpAPI/Bocha/Brave/MiniMax**
  - 新闻搜索支持多 Key 负载均衡，支持中文优化（Bocha 博查搜索）、隐私优先（Brave Search）、结构化结果（MiniMax）。
  - 新闻最大时效可配置（默认 3 天），避免使用过时信息。

- **与我们现有数据源的对比**
  - **行情数据**：我们目前主要使用 Tushare、AkShare；daily_stock_analysis 增加了腾讯财经、新浪财经、东财等多个源，并实现了熔断降级和优先级策略。
  - **新闻数据**：我们可能缺少专门的新闻搜索 API；daily_stock_analysis 集成了多个付费/免费新闻搜索，提升舆情分析质量。
  - **建议**：引入腾讯财经、新浪财经作为备用数据源，增加新闻搜索 API（如 Bocha 或 Tavily）提升舆情分析能力。

## 移植优先级

| 功能 | 优先级 | 工作量 | 说明 |
|------|--------|--------|------|
| LiteLLM 替换现有 llm_client.py | 🔴 高 | 中 | 一键接入所有模型，与中转站战略一致 |
| AIHubMix 作为默认中转 | 🔴 高 | 低 | 直接配置，无需开发 |
| 买卖点位输出格式 | 🟡 中 | 低 | 改进现有 AI 分析输出格式 |
| 新闻源补充（Tavily/Bocha） | 🟡 中 | 低 | 付费API，需评估成本 |
| Vision LLM 股票图片识别 | 🟢 低 | 中 | 锦上添花 |
| Agent问股多轮对话 | 🟢 低 | 高 | 已有类似功能 |

## 立即可行动的事项

### A. LiteLLM 集成（最高价值）
```python
# 替换现有 llm_client.py 核心调用为 LiteLLM
# pip install litellm
import litellm

response = litellm.completion(
    model="openai/gpt-4o",          # OpenAI
    # model="anthropic/claude-3-5-sonnet",  # Claude
    # model="gemini/gemini-1.5-pro",        # Gemini
    # model="deepseek/deepseek-chat",       # DeepSeek
    # model="openai/gpt-4o",               # AIHubMix (兼容OpenAI格式，只改base_url)
    messages=[{"role": "user", "content": "分析股票"}],
    api_base="https://aihubmix.com/v1",  # AIHubMix 端点
    api_key=os.getenv("AIHUBMIX_API_KEY"),
)
```

### B. 输出格式升级
参考 daily_stock_analysis 的 AI决策仪表盘格式，升级我们的分析输出

### C. 新闻数据源补充
Bocha（博查）是国内新闻搜索API，对A股新闻覆盖更好

## AIHubMix vs 我们的 AI 中转站

| 维度 | AIHubMix（现有） | 我们的 AI 中转站（规划中） |
|------|-----------------|--------------------------|
| 定位 | API 聚合器，开发者工具 | 面向投资者的 AI 应用平台 |
| 盈利模式 | 按 Token 差价 | Token 差价 + 策略订阅 + 数据变现 |
| 核心壁垒 | 接入模型多 | 金融垂类数据 + 策略知识库 |
| 目标用户 | 开发者 | 个人/机构投资者 |
| 差异化 | 无 | 金融 RAG + 历史回测 + 实盘跟踪 |

结论：AIHubMix 是我们的上游供应商，我们是它的下游垂类应用。我们可以用 AIHubMix 作为多模型接入的基础设施，在上面构建金融专属能力。

## 代码可直接复用的部分

（列出具体文件名和函数名，如果能抓到代码的话）

- `src/config.py`：配置管理、LiteLLM 初始化、多通道解析。
  - `Config._load_from_env()`：环境变量加载逻辑。
  - `Config._parse_llm_channels()`：多通道解析。
  - `Config._channels_to_model_list()`：通道转模型列表。
- `src/agent/llm_adapter.py`：统一 LLM 工具调用适配器。
  - `LLMToolAdapter`：核心适配器类，支持多模型、多 Key、Router。
  - `get_thinking_extra_body()`：处理思考模式。
- `src/notification.py`：多渠道推送服务。
  - `NotificationService`：统一推送入口。
  - 各渠道 Sender 类。
- `src/analyzer.py`：AI 分析核心，包含仪表盘结构、完整性校验。
  - `check_content_integrity()`：报告完整性校验。
  - `fill_chip_structure_if_needed()`：筹码结构填充。
- `src/core/pipeline.py`：分析流水线，协调数据获取、AI 分析、结果生成。

**注意**：直接复制代码需注意许可证兼容性（MIT 许可证），并适当修改以适应我们的代码结构。