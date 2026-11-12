# 发布到 GitHub + DSH 插件生态（操作清单）

本仓库已经是「可发布」状态。剩下 4 步需要你自己操作（涉及你的 GitHub / npm 账号）。

## 0\. 占位符（已完成）

原占位符 `YOUR_GITHUB_USER` / `YOUR_NAME` 已统一替换为 **`LEAFCHINA`**，涉及 `package.json`、`LICENSE`、`README.md`、`docs/catalog-entry.yml` 和本文件。

如果用户名/署名不是 `LEAFCHINA`，推送前先改掉（注意：替换的是**当前值** `LEAFCHINA`，不是占位符）：

```powershell
$old = "LEAFCHINA"
$new = "你的用户名"
Get-ChildItem -Recurse -File -Include *.json,*.md,*.yml,LICENSE | ForEach-Object {
  (Get-Content $_.FullName -Raw) -replace $old, $new | Set-Content $_.FullName -NoNewline
}
```

## 1\. 建仓库并推送

```powershell
cd "C:\path\to\dsh-creation-workbench-github"
git init
git add -A
git commit -m "feat: DSH AI image workbench v1.2.2 (API + local ComfyUI workflows)"
git branch -M main
git remote add origin https://github.com/LEAFCHINA/dsh-creation-workbench.git
git push -u origin main
```

然后在 GitHub 仓库页 **About → Topics** 添加 `dsh-plugin`（收录硬性要求）。
仓库需**创建满 1 天**才能提交收录（CI 自动检查）。

## 2\. 发布方式（二选一或都做）

### A. 只发 GitHub（最快，不需要 npm 账号）

别人可以直接装：

```sh
dsh plugin --profile web add github:LEAFCHINA/dsh-creation-workbench
```

收录时市场会按 `github:owner/repo` 生成安装命令。

### B. 同时发 npm（推荐，安装更快、可版本更新）

`dsh-creation-workbench` 这个包名当前**未被占用**（已查 npm registry 返回 404）。

```powershell
npm login
npm publish --access public
```

发布前会自动执行 `prepack`（重建 `client.js` 并跑检查）。\
之后别人可以：

```sh
dsh plugin --profile web add dsh-creation-workbench
```

> 注意：`package.json` 的 `files` 已包含构建产物 `client.js`、源码 `client-src/`、`host/`、`cordis.patch.yml` 等，安装不需要在目标机编译。

## 3\. 提交到 DSH 插件市场（awesome-dsh-plugin）

市场是仓库 `awesome-dsh-plugin/awesome-dsh-plugin` 的精选列表，**一个插件一个 YAML 文件**。

1. Fork 该仓库；
2. 新建文件 `data/plugins/LEAFCHINA__dsh-creation-workbench.yml`，内容用 [docs/catalog-entry.yml](catalog-entry.yml)；
3. 提 PR（不要改 README，README 由脚本生成）。

收录要求核对（本仓库已满足）：

- [x] `package.json` 声明 `dsh.bundle`（`{ patch: "./cordis.patch.yml" }`）—— 这是可安装的前提

- [x] 仓库根有 `cordis.patch.yml`，其中 `name:` 与包名一致

- [x] 有真实可用代码（不是占位/纯 README）

- [x] 有 `dsh-plugin` topic（推送后去仓库设置里加）

- [x] 描述只写功能、不夸大

- [x] 分类选 `ui`（同类 ComfyUI / 生图插件都在 `ui`）

- [ ] 仓库创建满 1 天（时间到了即可）

- [ ] icon 用 `assets/icon-180.png`（已生成，180×180 PNG，GitHub 托管）

CI 通过后由维护者人工阅读代码再合并，通常几天内。合并后市场/站点会自动收录。

## 4\. 后续发版

```powershell
# 改代码后
npm run build:client   # 如果改了 client-src/
npm run check
git commit -am "fix: ..."
# 升版本
npm version patch      # 或 minor/major
npm publish
git push --follow-tags
```

