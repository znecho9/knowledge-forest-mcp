<p align="center">
  <img src="docs/assets/logo.svg" width="112" alt="知识森林标志">
</p>

<h1 align="center">Knowledge Forest MCP — 个人知识与学习记忆</h1>

<p align="center"><strong>面向任意 AI 导师的本地优先个人知识管理（PKM）与学习记忆 MCP。</strong></p>

<p align="center">
  把目标变成有前置关系的知识树，保存连续学习历史，并用真实证据而不是流畅对话判断掌握。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="https://registry.modelcontextprotocol.io/?q=io.github.znecho9%2Fknowledge-forest-mcp">MCP Registry</a> ·
  <a href="docs/product.md">产品原则</a> ·
  <a href="docs/architecture.md">架构</a> ·
  <a href="CONTRIBUTING.md">参与贡献</a>
</p>

## 什么时候应该选择它

当你希望 AI 导师记住的不只是聊天记录，而是长期、结构化的学习状态时，Knowledge Forest 适合你：

- 保存个人拥有的目标、概念、笔记、来源和掌握证据；
- 让 Claude、Codex 等 MCP 宿主跨对话延续同一份学习记忆；
- 用可复用知识节点和前置关系形成个人知识图谱；
- 识别可学习、被阻塞以及需要补证据的概念；
- 只有新的、无辅助的闭卷表现才能验证掌握。

它不是通用聊天记忆、向量数据库或文档 RAG。它专门回答：学什么、为什么先学它、哪些知识可以复用，以及是否真的掌握。

## 它解决什么问题

AI 很会解释一个主题，却不擅长长期维护学习状态：对话结束后容易遗忘前置知识、在多个项目里重复创建同一概念，也容易把“回答得很像会了”误当成真正掌握。

Knowledge Forest 为任意兼容 MCP 的模型提供一层持久学习状态：

- **目标树**：把可观察成果反推成最小充分知识结构。
- **规范知识节点**：一个概念可以被多个目标复用，不复制学习记录。
- **证据门槛**：严格区分阅读、提示练习与新的闭卷迁移表现。
- **本地优先**：目标、笔记与证据保存在用户拥有的可移植 JSON 文件中。
- **模型中立**：宿主模型负责推理并使用自己的订阅或 API 额度；MCP 服务器本身不调用模型。

## 快速开始

需要 Node.js 22 或更高版本。

从 GitHub 在任意 stdio MCP 宿主中运行：

```bash
npx --yes github:znecho9/knowledge-forest-mcp doctor
npx --yes github:znecho9/knowledge-forest-mcp
```

支持 MCPB 的客户端也可以从[最新 GitHub Release](https://github.com/znecho9/knowledge-forest-mcp/releases/latest/download/knowledge-forest-mcp.mcpb)安装自包含 Bundle。

本地开发：

```bash
git clone https://github.com/znecho9/knowledge-forest-mcp.git
cd knowledge-forest-mcp
npm ci
npm run check
npm run dev
```

默认数据文件为 `~/.knowledge-forest/knowledge-forest.json`。可用 `KNOWLEDGE_FOREST_FILE` 或 `--data-file` 指定其他位置。

## 连接 Codex

在 `~/.codex/config.toml` 中加入：

```toml
[mcp_servers.knowledge-forest]
command = "npx"
args = ["--yes", "github:znecho9/knowledge-forest-mcp"]
env = { KNOWLEDGE_FOREST_FILE = "/知识森林绝对路径/learning/knowledge-forest.json" }
```

Claude Desktop 等使用 JSON 配置的宿主：

```json
{
  "mcpServers": {
    "knowledge-forest": {
      "command": "npx",
      "args": ["--yes", "github:znecho9/knowledge-forest-mcp"],
      "env": {
        "KNOWLEDGE_FOREST_FILE": "/知识森林绝对路径/learning/knowledge-forest.json"
      }
    }
  }
}
```

## 核心工具

| 工具 | 用途 | 是否写入 |
|---|---|---:|
| `forest_overview` | 查看目标、进度与下一步 | 否 |
| `search_knowledge` | 搜索可复用规范节点 | 否 |
| `get_node_context` | 查看关系、记录与证据 | 否 |
| `diagnose_node` | 诊断前置、深度和证据缺口 | 否 |
| `get_learning_queue` | 找到可学节点与被阻塞节点 | 否 |
| `create_goal_tree` | 创建最小充分目标树 | 是 |
| `update_node_learning_state` | 设置学习深度或流程状态 | 是 |
| `append_learning_note` | 追加笔记、来源、反思或练习 | 是 |
| `record_verification` | 保存验证证据并执行掌握规则 | 是 |
| `export_forest` | 读取完整可移植档案 | 否 |

## 掌握不能被随意写入

只有同时满足以下条件，`record_verification` 才会把节点标为 `verified`：

```text
达到要求
且 闭卷
且 无辅助
且 使用新题
```

资料辅助研究、讲解、摘要和提示后答案都可以保存，但不会成为掌握证据。其他工具不能直接写入 `verified`。

## 与现有知识森林工作台对齐

数据封装和目标/节点核心字段兼容本地工作台的 `learning/knowledge-forest.json`。把 MCP 指向该文件，即可让 AI 宿主与工作台共享同一份权威知识森林。

服务器对每次写入执行结构验证、跨进程锁和原子替换，并在 `learning/backups/` 中保留最近 20 份 MCP 快照。MCP 专属追加记录还会镜像到相邻的 `knowledge-forest.mcp-records.json`，避免只认识核心字段的工作台自动保存时误删；`export` 会把两部分重新合并为一份可移植档案。接入真实工作台前，仍建议先提交 Git 或另行备份。

## Token 与隐私

- MCP 不调用任何 LLM，因此不消耗项目方的模型 token。
- 推理成本由用户选择的 ChatGPT、Claude、Codex 或其他宿主承担。
- 不需要模型 API Key，不发送遥测，不上传学习数据。
- 数据是普通 JSON，可用 `knowledge-forest-mcp export` 随时导出。

## Open Core 边界

单人构建、查询、验证、备份和迁移知识森林所需的全部能力均以 Apache-2.0 开源。未来可能收费的服务包括加密多端同步、托管远程 MCP、托管备份、组织权限和高级连接器；这些服务不是本地核心的必需条件。

当前版本为 `0.1.1` 公开 Alpha。数据结构已有版本号，但工具协议在 `1.0` 前仍可能演进。
