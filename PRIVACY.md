# 一题 隐私政策 · Privacy Policy

生效日期 / Effective date: 2026-09-26

一题是一个开源的学习工具（浏览器插件和本机服务），源代码在 https://github.com/John15263/yiti 。一题**没有开发者服务器**：不收集、不上传、不出售你的任何数据，没有统计、没有广告、没有追踪。下面写清楚它读取什么、存在哪里、会发给谁。

## 一题读取的内容

- **Math Academy 页面**：只在 mathacademy.com 上，只读你当前打开的这一步——题目和讲解的文字与公式、你选的答案、对错结果、交答案后显示的讲解。测验、复习、诊断等不是课程的页面，只读取页面类型（例如"测验"），不读内容。
- **你在一题里输入的内容**：默写的步骤、"一句话"的回答。
- **语音**：只在你打开语音陪练时（点「语音」或按 ⌘ ]）使用麦克风，关掉即停止。
- **API key**：你在「设置」里填写的服务商密钥。

## 存在哪里

全部只存在你自己的电脑上：插件版存在浏览器的插件存储里，本机服务版存在程序的 `data/` 文件夹里。包括 API key、设置、学习记录（每一步的内容、你的作答、点评、语音对话的文字记录）和模型用量。开发者看不到这些数据。卸载插件（或删除 `data/` 文件夹）即全部删除。

## 会发给谁

为了提供功能，一题用**你自己的 API key**，把必要的内容直接发给**你在设置里选择的**人工智能服务商，不经过任何其他服务器：

| 功能 | 发送的内容 |
|---|---|
| 翻译、例题拆块 | 当前这一步的文字和公式 |
| 默写检查 | 这一块的讲解和你写的内容 |
| 一句话点评 | 题目、你的答案和对错、讲解、你写的那一句 |
| 语音陪练 | 你的麦克风声音，以及当前这一步的相关内容 |

可选的服务商及其隐私政策：

- Google（Gemini API）：https://policies.google.com/privacy
- DeepSeek：https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html
- 阿里云百炼（通义千问 / Qwen）：https://terms.aliyun.com/legal-agreement/terms/suit_bu1_ali_cloud/suit_bu1_ali_cloud201902141711_54837.html

这些内容如何被服务商处理，适用该服务商的条款。一题不会把你的数据用于提供上述功能以外的任何目的，也不会转交给任何其他人。

## 未成年人

一题面向学生。如果你未满 14 周岁，请在监护人的同意和指导下使用，并遵守你所选服务商对使用者年龄的要求。

## 变更与联系

本政策如有变更，会更新在这个页面并修改生效日期。有问题请在 https://github.com/John15263/yiti/issues 提出。

---

## English

一题 (Yiti) is an open-source study companion for Math Academy (a browser extension and a local server). **It has no developer server**: it does not collect, upload or sell any of your data, and has no analytics, ads or tracking.

**What it reads.** On mathacademy.com only, the lesson step you have open: the text and formulas of the question and explanation, the answer you picked, whether it was correct, and the explanation shown after you answer. On quizzes, reviews, diagnostics and other non-lesson pages it reads only the kind of page, not its content. It also uses what you type into 一题, your microphone only while you have a voice call open, and the API keys you enter in Settings.

**Where it is kept.** Only on your own computer: in the browser's extension storage (extension) or the app's `data/` folder (local server) — API keys, settings, learning records including voice transcripts, and model usage. The developer cannot see any of it. Uninstalling the extension (or deleting `data/`) deletes it all.

**Who receives it.** To provide its features, 一题 sends the necessary content, with **your own API key**, directly to **the AI provider you choose** in Settings — Google (Gemini API), DeepSeek, or Alibaba Cloud Model Studio (Qwen) — and to no one else: the current step's text for translation and splitting into blocks; the block and what you wrote for checking; the question, your answer, the explanation and your sentence for the one-sentence review; your microphone audio and the current step's context during a voice call. Each provider's own terms and privacy policy apply to what it receives. Your data is not used for any other purpose and is not transferred to anyone else.

**Children.** 一题 is meant for students. If you are under 14, use it with your parent's or guardian's consent and guidance, and follow the age requirements of the provider you choose.

**Changes and contact.** Changes will be posted on this page with a new effective date. Questions: https://github.com/John15263/yiti/issues
