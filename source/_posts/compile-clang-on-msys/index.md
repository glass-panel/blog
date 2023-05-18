---
title: 在 MSYS2(Mingw) 环境下折腾 Clang
date: 2023-05-18 15:22:03
tags: ["C++", "Clang", "MSYS2"]
excerpt: <img src="/post/compile-clang-on-msys/mem.jpg"><p>喘不过气了兄弟</p>
---

Clang 或者说它那一整个大的 llvm-project CMakeFiles 写的很好，也没有极其恶心人的找依赖库环节，基本上按照 [它给的教程](https://llvm.org/docs/GettingStarted.html#compiling-the-llvm-suite-source-code) 就能很愉快编译出能用的版本出来，除了你想搞快点需要巨多核心跟内存外没什么难的

问题是难的就是这个搞快点，俺一开始给它搁一个4核4G的云服务器上 `make -j4` 直接给服务器整痴呆了，任何东西都失去了响应，一查发现这逼给其他进程都给挤 swap 里去了，自己甚至还吃了不少，减到 j2 勉强能过，但是编了巨久。想到俺之后还得对着这玩意折腾，那每次构建都得花个老半天，忍不了。最后只能拖回硬件条件还算比较好的本地折腾，因为害怕再被 Windows 原生的工具链折磨于是选择了 MSYS2 环境

然后设置了 `CMAKE_BUILD_TYPE` 为 Debug，成功在编译某个库时遇到 `file too big: string table overflow` 的报错，经查发现是调试符号过多超过了 Windows PE 结构的限制，操了，都绕着微软走了还能被坑，于是添加 `CMAKE_CXX_FLAGS=-Og` 作简单优化减少调试符号（`-Og` 仅限 gcc，clang 只能 `-O1` 了），然后又在成功中走向成功，最终链接时 ld 以肉眼可见的速度蚕食干净了我的 32G 内存，然后 OOM

![喘不过气了兄弟](./mem.jpg)

原因自然是静态链接时 ld 会把所有库里包含的巨量调试符号给塞到一起。还好，LLVM 提供了编译为分立的动态库的选项 `BUILD_SHARED_LIBS=On` ，这同时能避免每做一次小修改构建就得从头再来的问题，不过文档里说这选项不适合正规 Release

折腾到这开个8线程基本上就能正常编译了，多了怕又给俺 OOM 了，LLVM 也给了个选项 `LLVM_OPTIMIZED_TABLEGEN=On` 说是能提高 Debug Build 的速度，Windows 上好像没什么卵用

但是编译时长还是属于完全不能忍的范围，整体构建一次得花一个多小时，一点点小修改增量构建也得10分钟。万幸的是 [别人给出了方法](https://mort.coffee/home/clang-compiler-hacking/)，具体为：

- 更改链接器为 lld，据说能提高最多10倍的链接速度
- 改 `BUILD_TYPE` 为 Release，没了调试符号方便链接
- 亲手折腾时发现**一定**得给默认的 make script 从 `GNU make` 换成 `ninja` 之类的玩意，make 在增量构建时大半时间在磨洋工，依赖也分析不清楚

最后终于给全新构建时间缩短至了 39 分 28.512 秒（Ryzen7 5800H -j8），稍微改改增量构建几乎立马完成。本着不信邪就多了几个调试符号咋比开 O2 优化还慢的精神，俺还试了全新 Debug 构建，花了 55 分 19.071 秒（条件同上），俺认输，但是有了符号方便调试，不亏

最终配置命令如下，如果 gcc 不支持指定 lld 作为链接器就换 clang，不会比用 ld 的 gcc 慢

```shell
Debug:
cmake -G "Ninja" \
	-DCMAKE_C_COMPILER=gcc \
	-DCMAKE_CXX_COMPILER="g++" \
	-DCMAKE_BUILD_TYPE=Debug \
	-DCMAKE_CXX_FLAGS=-Og \
	-DLLVM_USE_LINKER=lld \
	-DLLVM_TARGETS_TO_BUILD=host \
	-DLLVM_ENABLE_PROJECTS=clang \
	-DLLVM_OPTIMIZED_TABLEGEN=ON \
	-DBUILD_SHARED_LIBS=ON \
	./llvm

Release:
cmake -G "Ninja" \
	-DCMAKE_C_COMPILER=gcc \
	-DCMAKE_CXX_COMPILER="g++" \
	-DCMAKE_BUILD_TYPE=Release \
	-DLLVM_USE_LINKER=lld \
	-DLLVM_TARGETS_TO_BUILD=host \
	-DLLVM_ENABLE_PROJECTS=clang \
	-DLLVM_OPTIMIZED_TABLEGEN=ON \
	-DBUILD_SHARED_LIBS=ON \
	./llvm 
```

另外 vscode 的 clangd 在这种体量的代码下工作依然良好，牛的
