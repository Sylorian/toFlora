# 发布到 Cloudflare Pages

这个站是**纯静态**的：没有后端、没有数据库、没有表单、没有环境变量要配。
Hugo 把 `index.html` + 一个 CSS + 一个 JS + 两个字体生成出来，传到 Cloudflare 就完事。

照着做，每步都写了「你该看到什么」。看到的不对就别往下走，先翻第 7 节。

---

## 0. 需要什么

| 需要 | 说明 |
| --- | --- |
| Hugo | 本机装了就行（`hugo version`）。**不需要 Extended**，也不需要设 `HUGO_VERSION` |
| 一个 GitHub 账号 | 用来放代码，Pages 从它拉取 |
| 一个 Cloudflare 账号 | 免费版足够（这个站一共 6 个文件） |

```
第 1 步  本地跑起来看一眼
第 2 步  推到 GitHub
第 3 步  在 Cloudflare 建一个 Pages 项目，连上仓库
第 4 步  按第 6 节做 5 项确认
```

---

## 1. 本地先跑 30 秒

```bash
cd ForFlora
hugo server --bind 127.0.0.1 --port 1313
```

打开 <http://127.0.0.1:1313>。

**该看到：**

- 一片夜空，中间一颗会慢慢转的球，「to Flora」浮在球心；
- 1.7 秒后落款浮现：`Sylorian` / 一条细金线 / `献给 Flora`（2.8 秒后自己淡出，点一下可以提前收）；
- 拖一下球，它会转；点任意一颗星，旁边展开那句话；
- 按页面下方「抽一颗流星」→ 一场平行的流星雨从屏幕边缘越下越密 → 有一颗亮星飞到你眼前。

关掉服务：`Ctrl+C`。

---

## 2. 推到 GitHub

**推荐把 `ForFlora/` 本身作为仓库根目录**（这样第 4 步的 Root directory 留空即可）：

```bash
cd ForFlora
git init
git add .
git commit -m "to Flora"
git remote add origin https://github.com/<你的用户名>/<仓库名>.git
git push -u origin main
```

> 如果你是从**上一层目录**（包含 `ForFlora/`、`sf/`、`_build/` 的那个）推上去的，
> 那也没关系 —— 第 4 步把 **Root directory 填成 `ForFlora`** 就行。
> 别把 `_build/`、`public/`、`resources/` 推上去（`.gitignore` 已经排除了后两个）。

**该看到：** GitHub 仓库首页上有 `hugo.yaml`、`layouts/`、`assets/`、`data/`、`static/`。

推之前顺手确认一下：仓库根目录**不应该**有 `wrangler.toml`。这个站没有 Worker，
带了它反而会让部署步骤去找 `src/index.ts` 然后报错。

---

## 3. 建 Pages 项目

1. 打开 <https://dash.cloudflare.com/> 并登录；
2. 左侧 **Workers & Pages**（新版在 **Compute (Workers)**）→ 右上 **Create**；
3. **一定要选 `Pages` 标签**，然后 **Connect to Git**；
4. 授权 GitHub（可以只授这一个仓库）；
5. 选中刚才那个仓库 → **Begin setup**。

> ⚠️ **这一步选错是目前最常见的失败。**
> 新版界面把 Workers 放在前面，很容易点进去。区别只有一个：
>
> | 设置页里有 | 你建的是 | 结果 |
> | --- | --- | --- |
> | Build command + **Build output directory** | ✅ Pages | 正确 |
> | Build command + **Deploy command**（`npx wrangler deploy`） | ❌ Workers | 会报 `The entry-point file at "src/index.ts" was not found` |
>
> 静态站点没有 Worker 脚本可部署。选错了就删掉重来（Settings → 拉到底 → Delete）。

---

## 4. 构建设置：三个格子

| 格子 | 填什么 |
| --- | --- |
| **Framework preset** | `None`（或者 `Hugo`，都可以） |
| **Build command** | `hugo --gc --minify` |
| **Build output directory** | `public` |
| **Root directory** | 仓库根目录就是本站 → 留空；`ForFlora/` 在子目录 → 填 `ForFlora` |

**环境变量：不用加任何一条。**

> Cloudflare 的构建镜像自带 **Hugo 0.147.7**，这个站已经在**同一个版本**上实测构建通过
> （`exit 0`，无 error 无 warning），并且和用 0.169.0 构建出来的页面完全一致
> （HTML 只差资源哈希、CSS 去空白后逐字节相同）。
>
> 想固定版本再加 `HUGO_VERSION = 0.169.0`（加在 **Production** 栏、值不带引号、
> 保存后要触发一次**新构建**才会生效）。

---

## 5. 点 Save and Deploy

大约 1–2 分钟。日志里应该出现：

```
Executing user build command: hugo --gc --minify
hugo v0.147.7-... linux/amd64
                  │ EN
 Pages            │  1
 Static files     │  3
Total in 39 ms
Success: Build command completed
...
Success: Deployment complete
```

**该看到：** 顶部绿色 ✅，以及一个网址 `https://<项目名>.pages.dev`。

> 日志里**不应该**出现 `Executing user deploy command`。
> 出现了就是建成了 Workers 项目，回第 3 节。

---

## 6. 发布确认清单（5 项）

| # | 做什么 | 看到什么才算过 |
| --- | --- | --- |
| 1 | 打开 `https://<项目名>.pages.dev` | 夜空 + 会转的球 + 极细的「to Flora」 |
| 2 | 等 1.7 秒 | 落款浮现：`Sylorian` 一行 + 细金线 + `献给 Flora`，2.8 秒后自己与名字一起淡换回来 |
| 3 | 拖一下球 | 球跟着手转，松手还自己慢慢转，前后星星有遮挡 |
| 4 | 点一颗星 | 旁边展开那张卡，一条金线连到那颗星 |
| 5 | 按「抽一颗流星」 | 一场**平行**流星雨从屏幕边缘越下越密，然后一颗亮星飞到正中，卡片居中 |

第 5 项过了，说明 JS 和 CSS 都完整部署上去了。全过就是发布完成。

---

## 7. 出问题查这张表

| 现象 | 原因 | 怎么修 |
| --- | --- | --- |
| `The entry-point file at "src/index.ts" was not found` | 建成了 **Workers** 项目 | 删掉，重建为 **Pages**（见第 3 节判断表） |
| `can't evaluate field Locale in type *langs.Language` | 模板里用了 `site.Language.Locale`（Hugo 0.158 才有的字段） | 本仓库已改成 `params.lang`，换回仓库里的 `layouts/index.html` |
| `TOCSS-DART: ... not available in your current Hugo version` | 模板在调 `toCSS`，而 0.147 的 extended 没有内置 Dart Sass | 本仓库已不走 Sass 编译器（直接把 `main.scss` 当 CSS 发布），换回仓库里的模板 |
| 构建成功但线上 404 | 输出目录填错了 | **Build output directory 必须是 `public`** |
| 构建报找不到 `hugo.yaml` | Root directory 错了 | 仓库根就是本站 → 留空；`ForFlora/` 在子目录 → 填 `ForFlora` |
| 页面能开但没样式 | CSS 没上传 | 看构建日志里有没有 `css/main.min.*.css`；有的话强刷一次 |
| 名字不是极细字 | 字体没跟着部署 | 确认 `static/fonts/raleway-100-latin.woff2` 在仓库里（`.gitignore` 没排除它） |
| `*.pages.dev` 打不开 | 网络问题（见下） | 见下面的说明 |

### 关于域名可达性（国内）

实测（同一台机器）：

| 域名 | 结果 |
| --- | --- |
| `*.pages.dev` | **通**（TLS 握手正常，边缘响应正常） |
| `*.workers.dev` | **不通**（DNS 被解析到无关 IP + TLS 握手被重置） |

所以用 Pages 是对的。如果以后 `pages.dev` 也访问不了，唯一的解法是**绑一个自己的域名**：
Pages 项目 → **Custom domains** → Add a domain（域名要托管在同一个 Cloudflare 账号下）。

---

## 8. 之后改内容

改文字**不用碰任何代码**：

| 想改什么 | 改哪儿 |
| --- | --- |
| 天上的暗星句子（85 条） | `data/presets.txt`，一行一条 |
| 亮星句子 / 抽签池（24 条） | `data/featured.txt`，一行一条 |
| 球心的名字、页面标题 | `hugo.yaml` → `title` |
| 开场落款 | `hugo.yaml` → `params.dedication` |
| 生日星是哪天 | `hugo.yaml` → `params.birthday`（`MM-DD`，留空则没有这颗星） |
| 生日星说的那句话 | `data/birthday.txt` |
| 开场小窗的说明文字 | `layouts/index.html` → `intro__text` |
| 颜色 / 尺寸 | `assets/scss/main.scss` 顶部的变量 |

改完推上去，Pages 会自动重新构建（1 分钟左右）。

> 一句一句改的话，两个 txt 都能直接编辑：空行忽略、`#` 开头的行跳过、不用引号不用逗号。
> 句子里的 `"`、`'`、`<` 都不会出问题 —— 前端只用 `textContent` 写文本，没有 `innerHTML`。

---

## 附：全部命令，一屏看完

```bash
# 本地
cd ForFlora
hugo server --bind 127.0.0.1 --port 1313

# 发布（首次）
git init && git add . && git commit -m "to Flora"
git remote add origin https://github.com/<你>/<仓库>.git
git push -u origin main
#   → Cloudflare：Create → Pages 标签 → Connect to Git → 选仓库
#     Build command: hugo --gc --minify
#     Build output directory: public
#     Root directory: 空（或 ForFlora）

# 之后每次改完
git add -A && git commit -m "改了几句" && git push

# 不想用 Git 的话（本地构建 + 直传）
hugo --gc --minify
npx wrangler pages deploy public --project-name <项目名>
```
