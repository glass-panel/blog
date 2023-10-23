---
title: 为非项目文件设置 Clangd Fallback Flags
date: 2023-10-23 19：18:40
tags: ["C", "C++", "Clangd"]
excerpt: <p>解决开了-std=c++xx 后在C文件里乱叫的方法</p>
---

### 问题
直接用 vscode clangd 插件的 fallback flag 设置，会让所有没 `complie_commands.json` 的文件都用这个 flag，然后 clangd 就会在打开 C 文件时哀嚎不支持这么玩

[StackOverflow 的解决方案](https://stackoverflow.com/questions/71472340/clangd-use-different-compiler-flags-depending-on-file-extension)提到使用 clangd 的用户配置文件使用 `If` 判断文件名来   `ComplieFlags Add`，又会覆盖 `complie_commands.json` 里指定的，然后遇到标准不符的 C++ 文件又会乱叫，麻了

### 解决方案
直接 fallback flag 里设置 C++ 的 std 标准，然后在用户配置文件里用 `If` 判断文件名是否是 `\*.c` 然后 Remove CompileFlags 里的 `-std=c++*` 就行

clangd fallback flags: 
```shell
-std=c++20
```

clangd config.yaml:
```yaml
CompileFlags:
  Add: 
    - -SOME_MACRO_TO_DEFINE
--- 

If:
  PathMatch: [.*\.c]
CompileFlags:
  Remove: 
    - -std=c++*
    - -std=cxx*
```