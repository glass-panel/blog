---
title: 解决 Windows 下编译 NodeJS 链接冲突问题
date: 2023-07-18 22:02:45
tags: ["C++", "NodeJS", "MSBuild", "vcpkg"]
---

上来就是给俺一个链接冲突的大比兜子嗷：
``` text
openssl.lib(cmp_msg.obj) : error LNK2005: OSSL_CMP_MSG_free 已经在 libcrypto.lib(libcrypto-3-x64.dll) 中定义
openssl.lib(cmp_msg.obj) : error LNK2005: OSSL_CMP_MSG_get0_header 已经在 libcrypto.lib(libcrypto-3-x64.dll) 中定义
openssl.lib(cmp_msg.obj) : error LNK2005: OSSL_CMP_MSG_get_bodytype 已经在 libcrypto.lib(libcrypto-3-x64.dll) 中定义
openssl.lib(cmp_msg.obj) : error LNK2005: OSSL_CMP_MSG_read 已经在 libcrypto.lib(libcrypto-3-x64.dll) 中定义 
...
```

由于 NodeJS 在 Windows 上采用 MSBuild，想着之前折腾过 vcpkg，怀疑 vcpkg 与 VisualStudio 集成后会让链接库的搜索路径包含 vcpkg 里的库。实践证明猜测正确，类似问题可以搜搜 VisualStudio 是不是引入了什么奇奇怪怪的包管理，导致出现了同名库文件

解决方案：
1. 给 vcpkg/installed/平台目录(如 x64-windows)/ 里的东西暂时扬掉

2. 在执行 vcbuild.bat 至 `Project files generated.` 时中断，给 `node/node.sln` 和 `node/deps/openssl/openssl.sln` 内开 VisualStudio  手动给这几个项目属性内的使用 vcpkg 给关咯，`node/node.sln` 内的项目仅需关闭 nodelib 和 node 几项，然后注释掉 vcbuild.bat 里 `Project files generated.` 的涉及产生配置项目文件的几行，然后再运行

俺第一时间选择了第二项，然后折腾完才反应过来其实可以直接扬掉问题产生的根源，故可证俺还是个傻逼