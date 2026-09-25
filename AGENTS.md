# 给 AI Agent 的安装说明

一题是本地运行的 Math Academy 中文陪练：一个 Node 服务（127.0.0.1:4318）加一个 Chrome 扩展。帮用户装好只需要下面几步，不要改代码。

## 1. 检查环境

- `node --version` 要 ≥ 24（用到内置的 `node:sqlite`，会打印一条 ExperimentalWarning，正常）。没有就请用户安装 Node 24。
- 不需要 `npm install`，没有第三方依赖。

## 2. 配置 `.env`

```sh
cp .env.example .env
```

**最简单的做法是不碰 `.env`**：启动后让用户打开 http://127.0.0.1:4318 ，页面会自动弹出「设置」，用户在那里选服务、粘贴 key、点「保存并测试」。key 不经过对话，也不会出现在终端里。

要用 `.env` 的话，请用户**自己**把 key 填进去（打开文件让他们粘贴），不要让用户把 key 发到对话里，也不要把 key 打印出来：

- `GEMINI_API_KEY`：默认配置下文字部分和语音陪练都用它，在 https://aistudio.google.com/apikey 申请。用不了 Google 的话可以不填，按下面两条换成国内服务。
- 只有 DeepSeek key 的话：填 `DEEPSEEK_API_KEY`，把 `TEXT_PROVIDER` 改成 `deepseek`。翻译、拆块、检查、点评都能用。
- 语音陪练：默认 Gemini Live（用 `GEMINI_API_KEY`）。在中国大陆，改用阿里云百炼：`VOICE_PROVIDER=qwen`，填 `DASHSCOPE_API_KEY`，`DASHSCOPE_REGION` 选 `cn-beijing`（中国大陆的 key）或 `ap-southeast-1`（国际的 key），有工作空间 ID 就填 `DASHSCOPE_WORKSPACE_ID`。语音没配好时语音按钮不会出现，其余功能照常。
- 在中国大陆，**一个百炼 key 就够了**：文字选「阿里云百炼（千问）」（`TEXT_PROVIDER=qwen`），语音选「阿里云百炼」（`VOICE_PROVIDER=qwen`），不需要 Google 账号。

检查是否填好时只看变量名，例如 `cut -d= -f1 .env`，不要输出值。

## 3. 验证并启动

```sh
npm test      # 应该全部通过
npm start     # 日志里的 Text: … 和 Voice: … 写着用的是哪个服务商、key 有没有配上
```

`curl -s http://127.0.0.1:4318/api/health` 返回 `{"service":"yiti",…}` 就是起来了。让用户在浏览器打开 http://127.0.0.1:4318。

## 4. 装扩展（要用户自己点）

浏览器设置只能由用户操作。告诉用户：

1. Chrome 打开 `chrome://extensions`，右上角打开「开发者模式」。
2. 点「加载已解压的扩展程序」，选本仓库的 `extension` 文件夹（给出绝对路径）。
3. 打开或刷新 Math Academy 的一节课。

一题页面从"打开 Math Academy 的一节课……"变成当前这一步的内容，就装好了。也可以用 `curl -s http://127.0.0.1:4318/api/state -H "Authorization: Bearer $(cat data/.local-token)"` 看 `current` 字段。

## 常见问题

- **端口被占用**：在 `.env` 里改 `YITI_PORT`，同时把 `extension/manifest.json` 和 `extension/background.js` 里的 `4318` 改成同一个端口，再到 `chrome://extensions` 里重新加载扩展。
- **一题页面不跟着走**：确认扩展已启用、Math Academy 页面已刷新；一题服务没开的时候扩展会静默失败，服务起来后 20 秒内会补发。
- **"Gemini 未接受请求"**：key 错了，或账号没有 `.env` 里那个模型的权限；可以在 `.env` 里换 `GEMINI_MODEL`、`GEMINI_LIVE_MODEL`。
- **数据在哪**：`data/yiti.sqlite`（学习记录和用量），`data/.local-token`（本机页面的登录 token）。都在 `.gitignore` 里。
