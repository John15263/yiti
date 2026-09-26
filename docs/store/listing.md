# Edge 加载项商店上架资料

照着 Partner Center 的页面顺序排列，每一栏直接复制。图片都在这个文件夹里。

## 1. 上传包（Packages）

上传 `dist/yiti-extension-0.3.1.zip`（在仓库里运行 `node edge/build.mjs` 生成，也可以从 [Releases](https://github.com/John15263/yiti/releases) 下载）。

包里的 `edge/_locales/<语言>/messages.json` 决定了商店里**不能再改**的两项，每种语言一份：

| 语言 | 名称 | 简短描述 |
|---|---|---|
| zh_CN（默认） | `一题 · 数学课中文陪练` | `配合 Math Academy 的中文学习陪练：翻译、例题拆块先看懂再默写、做完题说一句关键步骤、语音补前置知识。用你自己的 API key，不经过第三方服务器。` |
| en_US | `Yiti 一题 · Chinese companion for math lessons` | `A Chinese study companion for Math Academy: translation, worked examples in small blocks, a one-sentence review and a voice tutor.` |

商店只给包里 `_locales` 有的语言开商店页：清单里名称和描述写死的话，只会出现一个 English (United States)。简短描述最多 132 个字符（构建时会检查）。

名称里没有用 “Math Academy”：商店不允许让人误以为是官方产品。描述里说“配合 Math Academy”是说明用途，并在详细描述里写明非官方。

## 2. 可用性（Availability）

- Visibility：Public
- Markets：所有市场（默认）

## 3. 属性（Properties）

- Category：**Productivity**（Edge 的分类里没有 Education）
- Website：`https://github.com/John15263/yiti`
- Support contact detail：`https://github.com/John15263/yiti/issues`
- Mature content：不勾

## 4. 隐私（Privacy）

### Single Purpose Description

```
Helps Chinese-speaking students study on Math Academy: in a side panel, it follows the lesson step the student has open, translates it into Chinese, splits worked examples into small blocks to understand and then write from memory, reviews a one-sentence summary after a question is answered, and offers a voice tutor for prerequisite knowledge. It never helps solve a practice question before the student has answered it.
```

### Permission justification

| 权限 | 理由（英文，直接复制） |
|---|---|
| sidePanel | `The whole extension is shown in the browser side panel, next to the Math Academy lesson.` |
| storage | `Stores the user's settings (chosen AI provider and their own API key), learning records and usage counts locally in the browser. Nothing is sent to the developer.` |
| unlimitedStorage | `Learning records keep each lesson step with its formulas (MathML) and the student's work; over many lessons this can exceed the default 10 MB local storage quota.` |
| Host: mathacademy.com（内容脚本） | `A content script reads only the lesson step currently open on mathacademy.com (text, formulas, the chosen answer and, after answering, the explanation) so the side panel can follow along. On quizzes, reviews and other non-lesson pages it reads only the page type.` |
| Host: generativelanguage.googleapis.com | `Calls the Google Gemini API with the user's own API key, when the user chooses Gemini for translation/checking or for the voice tutor.` |
| Host: api.deepseek.com | `Calls the DeepSeek API with the user's own API key, when the user chooses DeepSeek for translation and checking.` |
| Host: dashscope.aliyuncs.com, dashscope-intl.aliyuncs.com | `Calls Alibaba Cloud Model Studio (Qwen) with the user's own API key, when the user chooses Qwen for translation and checking.` |
| Host: *.maas.aliyuncs.com | `Opens the Qwen voice tutor over WebRTC at the user's own Model Studio workspace address (https://<workspace>.<region>.maas.aliyuncs.com), when the user chooses Qwen for voice. The subdomain is the user's workspace ID, so it cannot be listed in advance.` |

Partner Center 里所有网站（Host）权限只有**一个**框，实际填的是合在一起的这段：

```
mathacademy.com (content script): reads only the lesson step currently open (text, formulas, the chosen answer and, after answering, the explanation) so the side panel can follow along; on quizzes, reviews and other non-lesson pages it reads only the page type. The other hosts are AI providers, contacted directly with the user's own API key and only when the user chooses them in Settings: generativelanguage.googleapis.com (Google Gemini, text and voice); api.deepseek.com (DeepSeek, text); dashscope.aliyuncs.com and dashscope-intl.aliyuncs.com (Alibaba Cloud Model Studio / Qwen, text); *.maas.aliyuncs.com (Qwen voice over WebRTC at the user's own workspace address https://<workspace>.<region>.maas.aliyuncs.com, so the subdomain cannot be listed in advance). No developer server is contacted.
```

### Are you using remote code?

**No, I am not using remote code.**（所有代码都在包里；插件只和 AI 服务商交换数据，不下载代码。）

### Data usage

“What user data do you plan to collect” 建议勾选：

- **Website content**：当前这一步的题目和讲解会发给用户选的 AI 服务商。
- **Authentication information**：用户的 API key 存在本机，并作为凭证发给对应的服务商。
- **Personal communications**（可选，保守做法）：语音陪练时麦克风的声音会发给服务商。不勾也说得通（它不是人与人之间的通信），勾上更保守，但商店页会显示“收集个人通信”。由你决定；隐私政策里已经写明了语音。

下面三条声明都可以如实勾选：不出售给第三方；不用于和核心功能无关的目的；不用于判断信用或放贷。

### Privacy Policy URL

```
https://github.com/John15263/yiti/blob/main/PRIVACY.md
```

## 5. 商店页面（Store listings）

包里有两种语言，商店页各填一份：**English (United States)** 和 **Chinese (Simplified)**。两种语言都用下面的图；一种语言传好之后，可以用图下面的 “Duplicate … for all languages” 复制到另一种语言。

### 图片

| 栏位 | 文件 |
|---|---|
| Extension logo（必填） | `logo-300.png` |
| Small promotional tile | `tile-440x280.png` |
| Large promotional tile | `tile-1400x560.png` |
| Screenshots（按顺序） | `screenshot-1.png` 例题拆开讲 · `screenshot-2.png` 遮住自己写 · `screenshot-3.png` 语音问 · `screenshot-4.png` 一句话点评 · `screenshot-5.png` 设置 |

截图里用的是一题自带的示例题（我们自己写的），不含 Math Academy 的内容。

### Description（中文）

```
一题是给用中文思考的学生准备的 Math Academy 学习陪练。它开在浏览器侧边栏里，跟着你在 Math Academy 上正在看的那一步走。

【它能做什么】
· 中文翻译：把这一步的题目、选项和讲解翻成中文，公式原样保留；随时切回英文原文对照。
· 例题拆开讲：把讲解和例题拆成几小块，每一块先用中文说清在做什么、为什么这样做；看懂了就遮住，凭理解自己写出来，马上检查——写错了告诉你错在哪、为什么。
· 做完题说一句：交了答案之后（对错都行），用一句话说出这道题的关键一步，中文英文都行，马上得到分数、点评和改好的写法。
· 语音陪练：卡住时开口问，陪练用中文讲道理，英文说法原样念给你听。

【它守的一条线】
练习题交答案之前，一题不帮你解这道题。Math Academy 会根据你自己交的答案安排练习和复习；先被讲会了再交，它就会以为你已经掌握了。所以交答案之前，一题只翻译题目，最多用别的例子帮你补前置知识；交了之后再陪你弄懂。测验、复习等页面，一题不读取内容。

【怎么用】
1. 点工具栏上的一题图标，侧边栏打开。
2. 在「设置」里选服务商并填你自己的 API key：在中国大陆，一个阿里云百炼的 key 就够了（文字用千问、语音用 Qwen-Omni，需要填业务空间 ID）；也可以用 Google Gemini 或 DeepSeek。
3. 打开 Math Academy 的一节课，侧边栏会跟上。还没有账号的话，点「先看一个示例」试试一题自带的例题。

【隐私】
没有开发者服务器，没有统计和广告。key 和学习记录只存在你的浏览器里，内容只发给你选的 AI 服务商。一题是开源软件（AGPL-3.0）：https://github.com/John15263/yiti

一题是非官方的个人学习工具，和 Math Academy 没有关联。
```

### Description（English）

```
Yiti (一题) is a study companion for Math Academy, made for students who think in Chinese. It lives in the browser side panel and follows the lesson step you have open on Math Academy. The interface is in Chinese.

What it does
• Chinese translation: the step's question, choices and explanation in Chinese, with every formula kept as it is; switch back to the English original at any time.
• Worked examples in small blocks: each block is explained in Chinese — what it does and why; then you hide it and write the step yourself from understanding, and get an immediate check that says what is wrong and why.
• One sentence after each question: once you have answered (right or wrong), say the key step in one sentence, in Chinese or English, and get a score, feedback and a better wording.
• Voice tutor: when stuck, just ask. It explains in Chinese and says the English terms as they are.

The line it keeps
Before you answer a practice question, Yiti does not help you solve it. Math Academy plans your practice and reviews from the answers you give on your own; being walked through first would make it think you have mastered the topic. So before you answer, Yiti only translates the question and, at most, fills in prerequisite knowledge with other examples. Quizzes and reviews are never read.

How to use
1. Click the Yiti icon in the toolbar to open the side panel.
2. In Settings, choose providers and enter your own API key: Alibaba Cloud Model Studio (Qwen; one key covers text and voice, a workspace ID is needed for voice), Google Gemini, or DeepSeek.
3. Open a Math Academy lesson and the side panel follows. No account yet? Click “先看一个示例” (try an example) to use Yiti's own built-in example.

Privacy
There is no developer server, no analytics and no ads. Your key and learning records stay in your browser; content is sent only to the AI provider you choose. Yiti is open source (AGPL-3.0): https://github.com/John15263/yiti

Yiti is an unofficial study tool and is not affiliated with Math Academy.
```

### Search terms（最多 7 个，每个 ≤30 字）

- 中文：`数学学习` `Math Academy` `中文翻译` `数学辅导` `语音陪练` `概率统计` `学生`
- English：`math` `Math Academy` `Chinese translation` `math tutor` `study` `students` `voice tutor`

## 6. 审核备注（Notes for certification）

提交前，专门给审核员建一个 **Google Gemini 的 API key**（https://aistudio.google.com/apikey ），审核通过后删掉。用量上限只能按项目设，所以把它建在单独的项目里，再给这个项目设月上限（比如 $2）。把 key 填到下面的 `PASTE_KEY_HERE` 处（用尖括号 `<KEY>` 时，Partner Center 的输入框吞掉过它后面的换行）。审核员多半在海外，用 Gemini 最方便；他们大概率没有 Math Academy 账号，所以用内置示例测试。

```
How to test without a Math Academy account (it is a paid service):

1. Click the Yiti icon in the toolbar. The side panel opens and shows Settings.
2. Under 文字 (text) choose "Gemini"; under 语音陪练 (voice) choose "Gemini Live". Paste this test key into "Gemini API key": PASTE_KEY_HERE
   Click "保存并测试" (save and test); both lines should show "✓ 可用" (available). Close the dialog.
3. Click "先看一个示例" (try an example). A built-in worked example (written for this extension, not Math Academy content) opens, is translated into Chinese and split into blocks.
4. Press the dark button "遮住，自己写" (hide and write), type anything, press the button again to have it checked. "下一块" goes to the next block.
5. Click "语音 ⌘]" in the header to start the voice tutor; it starts explaining the current block. If the side panel cannot ask for the microphone, the extension opens a small tab to grant it once. Click the red timer to stop.
6. "EN" in the header switches between Chinese and the English original.

On mathacademy.com, the content script reads only the lesson step currently open and sends it to the side panel; nothing is read on quizzes or reviews. All model calls go directly from the extension to the provider chosen in Settings, with the user's own key; there is no developer server.

DeepSeek and Alibaba Cloud Model Studio (Qwen) are alternative providers for the same features, chosen in the same Settings dialog and run through the same code; the Gemini test key above covers both text and voice, so no other key is needed. The key exists only for this review and will be deleted afterwards.
```
