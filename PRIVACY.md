# 一题 隐私政策 · Privacy Policy

生效日期 / Effective date: 2026-09-30

一题是一个开源的学习工具（浏览器插件和本机服务），源代码在 https://github.com/John15263/yiti 。一题**没有开发者服务器**：不收集、不上传、不出售你的任何数据，没有统计、没有广告、没有追踪。下面写清楚它读取什么、存在哪里、会发给谁。

## 一题读取的内容

- **Math Academy 页面**：只在 mathacademy.com 上，只读你当前打开的这一步——题目和讲解的文字与公式、你选的答案、对错结果、交答案后显示的讲解。**复习页面**像练习题一样，读当前正在做的这一道题；测验、诊断、测评等考核页面，只读取页面类型（例如"测验"），不读内容。
- **你在一题里输入的内容**：你在「问一问」里写的问题。
- **语音**：只在你打开语音陪练时（点「语音」或按 ⌘ ]）使用麦克风，关掉即停止。
- **API key**：你在「设置」里填写的服务商密钥。

## 存在哪里

全部只存在你自己的电脑上：插件版存在浏览器的插件存储里，本机服务版存在程序的 `data/` 文件夹里。包括 API key、设置、学习记录（每一步的内容、翻译、前置知识清单、学这个有什么用、你和陪练的对话、语音对话的文字记录）和模型用量。开发者看不到这些数据。卸载插件（或删除 `data/` 文件夹）即全部删除。

## 会发给谁

为了提供功能，一题用**你自己的 API key**，把必要的内容直接发给**你在设置里选择的**人工智能服务商，不经过任何其他服务器：

| 功能 | 发送的内容 |
|---|---|
| 翻译 | 当前这一步的文字和公式 |
| 前置知识清单 | 讲解和例题：这一步的文字和公式；练习题：题目和选项（不含答案和官方讲解） |
| 展开前置知识 | 这个知识点的名称和说明（不含题目和这一步的文字） |
| 前置知识的更简单的解释 | 同上，加上你刚看过的那一版讲法（也是模型写的，不含题目） |
| 讲解和例题的更简单的解释 | 这一步的文字和公式，以及上一版讲法；练习题交答案之后：题目、选项、你选的、对错和官方讲解（交答案之前没有这个功能） |
| Math Academy 官方前置知识点的中文名 | 这些知识点的英文名称（只有名称）。这些名称也会随前置知识清单、定位、学这个有什么用一起发给模型（复习题交答案之前不发） |
| 这节课的定位 | 这节课里讲解和例题的英文标题，以及每一段开头的一小段原文（不含题目）；复习页没有标题时，是那道已经交了答案的题目和官方讲解（交答案之前不生成） |
| 学这个有什么用 | 这节课里讲解和例题的英文标题和开头的一小段原文（不含题目）、这节课的定位、这节课已经列过的前置知识的名称；复习页没有标题时，是那道已经交了答案的题目和官方讲解。练习题交答案之前没有这个功能 |
| 展开「学这个有什么用」的一项 | 同上，加上这一项的内容 |
| 那一层有什么用 | 同上，加上这一条高级数学衔接的内容 |
| 「学这个有什么用」里的更简单的解释 | 这一条的内容、这节课的定位，以及你刚看过的那一版讲法（不含题目） |
| 问一问 | 讲解和例题：这一步的文字和公式；练习题交答案之前：前置知识清单（不含题目）；交答案之后：题目、选项、你选的、对错和官方讲解；以及你和它聊过的最近几条、你这次问的话 |
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

**What it reads.** On mathacademy.com only, the lesson step you have open: the text and formulas of the question and explanation, the answer you picked, whether it was correct, and the explanation shown after you answer. On a review page it reads the practice question being asked, as in a lesson; on quizzes, diagnostics, assessments and other pages it reads only the kind of page, not its content. It also uses what you ask in 一题, your microphone only while you have a voice call open, and the API keys you enter in Settings.

**Where it is kept.** Only on your own computer: in the browser's extension storage (extension) or the app's `data/` folder (local server) — API keys, settings, learning records including voice transcripts, and model usage. The developer cannot see any of it. Uninstalling the extension (or deleting `data/`) deletes it all.

**Who receives it.** To provide its features, 一题 sends the necessary content, with **your own API key**, directly to **the AI provider you choose** in Settings — Google (Gemini API), DeepSeek, or Alibaba Cloud Model Studio (Qwen) — and to no one else: the current step's text for translation and for the list of prerequisites; the name and note of one prerequisite when you open it up, and the telling you just read when you ask for a simpler one (never the question); on a tutorial or example, its text, or for a practice question already answered, its question, choices, result and explanation, when you ask for a simpler telling of it (there is none before the answer); your questions and the last few turns of the conversation, together with the step's text, or, for a practice question, its question, choices, result and explanation once answered (before it is answered, the tutor is not sent the question at all); your microphone audio and the current step's context during a voice call. Each provider's own terms and privacy policy apply to what it receives. Your data is not used for any other purpose and is not transferred to anyone else.

**Children.** 一题 is meant for students. If you are under 14, use it with your parent's or guardian's consent and guidance, and follow the age requirements of the provider you choose.

**Changes and contact.** Changes will be posted on this page with a new effective date. Questions: https://github.com/John15263/yiti/issues
