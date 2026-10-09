# Edge 加载项商店上架资料

照着 Partner Center 的页面顺序排列，每一栏直接复制。图片都在这个文件夹里。

## 1. 上传包（Packages）

上传 `dist/yiti-extension-0.5.1.zip`（在仓库里运行 `node edge/build.mjs` 生成，也可以从 [Releases](https://github.com/John15263/yiti/releases) 下载）。0.3.1 已通过审核（2026-10-02 确认）；0.5.1 是在它基础上的一次大更新（权限和主机权限和 0.3.1 完全一样，没有新增），用「更新」提交，不是新建加载项。

包里的 `edge/_locales/<语言>/messages.json` 决定了商店里**不能再改**的两项，每种语言一份：

| 语言 | 名称 | 简短描述 |
|---|---|---|
| zh_CN（默认） | `一题 · 数学课中文陪练` | `配合 Math Academy 的中文学习陪练：翻译、每一步背后的前置知识（可展开）、随时问一问、语音陪练。用你自己的 API key，不经过第三方服务器。` |
| en_US | `Yiti 一题 · Chinese companion for math lessons` | `Chinese study companion for Math Academy: translation, the prerequisites behind each step, ask-anytime Q&A and a voice tutor.` |

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
Helps Chinese-speaking students study on Math Academy: in a side panel, it follows the lesson step the student has open, translates it into Chinese, lists the more basic prerequisite knowledge behind the step (each item can be opened up for a fuller explanation, and retold more simply), can retell the step's explanation for someone with less background, lets the student ask questions about the step at any time, and offers a voice tutor. It never helps solve a practice question before the student has answered it: until then the assistant is not even shown the question.
```

### Permission justification

| 权限 | 理由（英文，直接复制） |
|---|---|
| sidePanel | `The whole extension is shown in the browser side panel, next to the Math Academy lesson.` |
| storage | `Stores the user's settings (chosen AI provider and their own API key), learning records and usage counts locally in the browser. Nothing is sent to the developer.` |
| unlimitedStorage | `Learning records keep each lesson step with its formulas (MathML) and the student's work; over many lessons this can exceed the default 10 MB local storage quota.` |
| Host: mathacademy.com（内容脚本） | `A content script reads only the lesson step, or the review question, currently open on mathacademy.com (text, formulas, the chosen answer and, after answering, the explanation) so the side panel can follow along. On quizzes, diagnostics, assessments and other pages it reads only the page type.` |
| Host: generativelanguage.googleapis.com | `Calls the Google Gemini API with the user's own API key, when the user chooses Gemini for translation and questions or for the voice tutor.` |
| Host: api.deepseek.com | `Calls the DeepSeek API with the user's own API key, when the user chooses DeepSeek for translation and questions.` |
| Host: dashscope.aliyuncs.com, dashscope-intl.aliyuncs.com | `Calls Alibaba Cloud Model Studio (Qwen) with the user's own API key, when the user chooses Qwen for translation and questions.` |
| Host: *.maas.aliyuncs.com | `Opens the Qwen voice tutor over WebRTC at the user's own Model Studio workspace address (https://<workspace>.<region>.maas.aliyuncs.com), when the user chooses Qwen for voice. The subdomain is the user's workspace ID, so it cannot be listed in advance.` |

Partner Center 里所有网站（Host）权限只有**一个**框，实际填的是合在一起的这段：

```
mathacademy.com (content script): reads only the lesson step, or the review question, currently open (text, formulas, the chosen answer and, after answering, the explanation) so the side panel can follow along; on quizzes, diagnostics, assessments and other pages it reads only the page type. The other hosts are AI providers, contacted directly with the user's own API key and only when the user chooses them in Settings: generativelanguage.googleapis.com (Google Gemini, text and voice); api.deepseek.com (DeepSeek, text); dashscope.aliyuncs.com and dashscope-intl.aliyuncs.com (Alibaba Cloud Model Studio / Qwen, text); *.maas.aliyuncs.com (Qwen voice over WebRTC at the user's own workspace address https://<workspace>.<region>.maas.aliyuncs.com, so the subdomain cannot be listed in advance). No developer server is contacted.
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
| Screenshots（按顺序，都是 1280×800） | `screenshot-1.png` 例题的中文翻译，角落里收起的「问一问」 · `screenshot-2.png` 前置知识，展开一项、再要一个更简单的讲法 · `screenshot-3.png` 问一问展开：左边是前置知识，右边是对话 · `screenshot-4.png` 划线提问 · `screenshot-5.png` 例题的「更简单的解释」 |

这五张是 0.5.1 的界面，用真实的模型回复拍的（Gemini，一题自带的示例题，不含 Math Academy 的内容，不含任何 key）。

截图里用的是一题自带的示例题（我们自己写的），不含 Math Academy 的内容。

### Description（中文）

```
一题是给用中文思考的学生准备的 Math Academy 学习陪练。它开在浏览器侧边栏里，跟着你在 Math Academy 上正在看的那一步走。

【它能做什么】
· 中文翻译：把这一步的题目、选项和讲解翻成中文，公式原样保留；随时切回英文原文对照。
· 前置知识：讲解、例题、练习题，每一步都能看到它背后更基础的概念、方法和公式；每一项可以「进一步展开」：讲清楚，给一个例子，说常见的误区；还觉得难，再点「更简单的解释」，换成基础更少的人也能懂的讲法，最多三种，可以来回翻。
· 更简单的解释：讲解、例题，以及交了答案之后的官方讲解，也可以让它重新讲一遍，讲给基础更少的人听；官方原文留在上面，模型写的另放一块。
· 随时问一问：平时收起、只在角落留一小粒，点开才出现（页面下面，宽屏在右边），一边看前置知识一边问，可以问很多轮，不打分。看到不懂的话，划线点一下就问。交了答案之后，什么都可以问，包括这道题怎么做；答错了想问，点一下「讲讲我错在哪」。
· 语音陪练：卡住时开口问，陪练用中文讲道理，英文说法原样念给你听；说的话和打的字在同一条对话里。
· 字号：顶栏的 A− A+（或 ⌘＋ ⌘－）把整个页面的字放大缩小；矩阵、分式等公式按原样画出来。

【它守的一条线】
练习题交答案之前，一题不帮你解这道题。Math Academy 会根据你自己交的答案安排练习和复习；先被讲会了再交，它就会以为你已经掌握了。所以交答案之前，一题只翻译题目，并帮你补前置知识：这时的「问一问」看不到你在做的题，只能讲基础知识；交了之后再陪你把这道题弄懂。复习页面当作练习题；测验、诊断、测评等考核页面，一题不读取内容。

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
• Prerequisites: for every step — tutorial, worked example or practice question — the more basic concepts, methods and formulas it rests on; each item can be opened up for an explanation, an example of its own and a common pitfall, and, if that is still too hard, told again more simply (up to three times, and you can go back and forth).
• Simpler explanations: for a tutorial, a worked example, or the official explanation once you have answered a practice question, ask for it to be retold for someone with less background. Math Academy's own text stays as it is; what the model writes goes in a separate box.
• Ask any time: tucked away in a corner until you open it; keep asking about the step, as many turns as you like, nothing is scored. Select any words on the page and one click sends them as a question. Once you have answered a practice question you can ask anything, including how it is solved.
• Voice tutor: when stuck, just ask. It explains in Chinese and says the English terms as they are; what you say and what you type are one conversation.
• Text size: A− A+ in the header (or Cmd +/−) enlarges or shrinks the whole page; matrices, fractions and other formulas are drawn as they are.

The line it keeps
Before you answer a practice question, Yiti does not help you solve it. Math Academy plans your practice and reviews from the answers you give on your own; being walked through first would make it think you have mastered the topic. So before you answer, Yiti only translates the question and fills in prerequisite knowledge: the assistant you ask at that point is not shown the question at all. Once you have answered, it walks you through it. A review is treated like a practice question; quizzes, diagnostics and assessments are never read.

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

提交前，专门给审核员建一个 **Google Gemini 的 API key**（https://aistudio.google.com/apikey ），审核通过后删掉。（0.3.1 那一次用的 key，如果还没删，可以接着用到这一次通过；删不删由你定，通过之后记得删，并删掉 Google 项目 `yiti-review`。）**这个 key 只能由你自己粘贴到备注里，不要发到聊天里。** Partner Center 的备注框限 2000 个字符，下面这份是压缩过的（约 1876 个字符，含 key 的位置）。用量上限只能按项目设，所以把它建在单独的项目里，再给这个项目设月上限（比如 $2）。把 key 填到下面的 `PASTE_KEY_HERE` 处（用尖括号 `<KEY>` 时，Partner Center 的输入框吞掉过它后面的换行）。审核员多半在海外，用 Gemini 最方便；他们大概率没有 Math Academy 账号，所以用内置示例测试。

```
Version 0.5.1 is a larger update of the approved 0.3.1; permissions are exactly the same.

How to test without a Math Academy account (a paid service):
1. Click the Yiti toolbar icon: the side panel opens, showing Settings.
2. Under 文字 (text) choose Gemini; under 语音陪练 (voice) choose Gemini Live. Paste this test key into "Gemini API key": PASTE_KEY_HERE
   Click "保存并测试" (save and test); both lines show "✓ 可用". Close the dialog.
3. Click "先看一个示例" (try an example): a built-in example (written for this extension, not Math Academy content) opens, translated into Chinese.
4. Click "前置知识" (prerequisites): a list of basic concepts, methods and formulas appears. "进一步展开" opens an item up; under it "更简单的解释" (simpler explanation) retells it, and "上一种讲法" goes back. "更简单的解释" under the example's text retells the example.
5. Click "问一问" (ask) in the bottom-right corner: the ask pane opens. Type a question, e.g. "为什么这样算？", press 发送 (send) or Cmd+Enter; the tutor answers in Chinese. "收起" (or Cmd+/) puts it back in the corner.
6. Select some words in the example: a bar with 解释 / 举例 / 为什么 / 引用 appears; the first three send the words as a question.
7. "语音 ⌘]" (voice), in the corner or the pane, starts the voice tutor. If the panel cannot get the microphone, a small tab asks once. The red timer stops it.
8. "EN" switches between Chinese and the English original; "A−"/"A+" change the text size.

On mathacademy.com the content script reads only the lesson step (or review question) that is open and sends it to the side panel; nothing is read on quizzes, diagnostics or assessments. Model calls go directly from the extension to the provider chosen in Settings, with the user's own key; there is no developer server. DeepSeek and Alibaba Qwen are alternatives through the same code; the Gemini key covers every feature. The key exists only for this review and will be deleted.
```
