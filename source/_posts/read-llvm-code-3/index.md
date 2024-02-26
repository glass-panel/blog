---
title: 看看 LLVM 的码（三）Pass 及其周围的配套
date: 2024-02-26 23:45:51
tags: [ "C++", "LLVM", "Compiler" ]
excerpt: "<blockquote>
<p>LLVM passes are where most of the interesting parts of the compiler exist<br>– LLVM document</p>
<p>it causes too many template instantiations, causing terrible compile times.<br>– LLVM code's comment </p>
</blockquote>
"
---

### Pass

```shell
LLVM-PROJECT/llvm/include/llvm/
LLVM-PROJECT/llvm/lib/IR/
LLVM-PROJECT/llvm/include/llvm/Passes
LLVM-PROJECT/llvm/lib/Passes
```

一个 LLVM Pass 是一个对象，由实现了具体某一类 Pass 约定的接口的类实例化而来，实例化出的对象由一个 PassManager 对象组织和调度

在一般情况下，一个 PassManager 会接下所有的分析、优化(这个看情况)、机器代码生成的 Pass，然后把某个对应的 Module 交给这个 PassManager 去处理，就成功完成了 LLVM 后端主要干的活。LLVM 还把这部分逻辑拆分做成了 `/llvm/tools/opt`, `/llvm/tools/llc` 两个小工具，可以参考里面的代码了解具体实现(然后就会发现一个大坑)

经常抢银行的朋友都知道，做大事一般都要从入口点考虑，对程序进行分析与修改也是如此。Pass 就是从程序中的下手点进行分类的，分别有：区域(Region)、循环(Loop)、函数(Function)、最末调用节点逆向(CallGraphSCC)、模块(Module) 等几种入口点。经常抢银行的朋友还知道，踩点和真正动手干是不一样的，前者不会影响环境，而后者会，Pass 也是如此，又分成 分析型或不变型 Pass (AnalysisPass/ImmutablePass) 和 会改变 IR 的(Transform)或一般的 Pass。在 Pass 修改了 IR 后，往往需要重新运行分析 Pass 来刷新分析结果，PassManager 会自动安排这一切，但怎么更新、更新哪些来提高效率成了 PassManager 的难题，然后就引出了上文说的大坑

为了解决上述问题，LLVM 当前版本(v17)有着新的 PassManager，而机器代码生成部分因为太多琐碎的工作并未能迁移成功，还使用着传统 PassManager，所以目前 LLVM 上两个 PassManager 并存，挖出了一个巨大的坑

#### LegacyPassManager :

#### class `Pass`

旧 PassManager 下所有 Pass 都得虚继承这个基类，相当于定义了 Pass 的接口。一个 Pass 类还应该包含一个 `static char ID` 来标识自己这个类，但这里并不是试图使用 `char` 的小身板去存储表示自己的 ID，LLVM 是以这个静态变量的**地址**来区分的

在实现不同类型 Pass 接口的基础上，如要表明自己依赖什么 Pass 和会修改什么 Pass 的结果，需要实现 `getAnalysisUsage(AnalysisUsage &AU)` 这一接口，并在里面使用 `AU.addRequired<PassClass>()` 表示依赖，`AU.setPreserveXXX()` 表示自己不会修改什么结果

#### class `PassInfo` / `PassRegistry`

有了自定义好的 Pass 类，如何通知 LLVM 有这么一回事并实例化出对象呢？`PassInfo` 类提供了存储一个 Pass 类信息的方式，其中包括 Pass 的名字，和 Pass 类默认构造函数的指针，这样便可使用该函数指针在不清楚具体类的情况下构造出对应对象，并返回指向这个对象的 `Pass*` 指针。`PassRegistry` 则是一个单例类，实现好的 Pass 类在此注册它的 `PassInfo` 后 LLVM 即可通过查找这个注册表得知对应 `PassInfo`

#### class `legacy::PassManager`

旧的 `PassManager` 即管理和存储所有加入其中的 Pass 实例的对象，它接受所有类型传统的 Pass。在加入完毕 Passes 后，即可处理某个对应的 `Module`.传统 Pass 还分了 `initialization` 和 `finalization` 两个阶段，需要手动调用 `PassManager` 中的两个对应的方法


#### New PassManager :

#### class `PreservedAnalyses`

如上述 LegacyPassManager 的 Pass 在表示自己不会修改什么 Pass 结果时，使用的是 hard coded 的方法，新 PassManager 为了再进行解耦，特别写了这个 `PreserverdAnalyses` 来为 Transform Passes 表明自己运行后会修改哪些分析 Pass 的结果。简单来说就是一个对 Analysis Passes 的集合，这个类提供了获取全集、空集的静态函数，也定义了取交集等运算方法

#### class `PassInfoMixin`

新 PassManager 下所有的 Pass 都得 CRTP 继承 `PassInfoMixin`，相当于 LegacyPassManager 下的 `class Pass`，但好像这玩意也没 mixin 太多东西进去。不同于 `class Pass` 使用继承不同类别来分类 Pass，`PassInfoMixin` 的子类只需要实现 `PreserveAnalyses run(TYPE&, TYPEAnalysisManager&)` 这一接口，以 `TYPE` 类型不同如 `Function` / `Module` 等来区分类型。同时，新增了可选的 `bool invalidate(TYPE&, const PreserveAnalyses&, TYPEAnalysisManager::Invalidator&)` 这一接口，用于表明某部分被其他 Pass 修改后是否要更新自己的处理结果

新 Pass 对象构造、存储、调用的方法及 Pass 注册、Pass 之间的顺序安排均被解耦成下面的模块内容

#### class `PassConcept` / `PassModel`

无论上面再怎么 CRTP，该类型擦除时还是得上虚函数。或许是 LLVM 团队看 [继承是罪恶之源](https://sean-parent.stlab.cc/papers-and-presentations/#inheritance-is-the-base-class-of-evil) 看昏了眼，竟给新 Pass 用上了，`PassConcept` 定义了新 Pass 所有的虚接口，`PassModel<Pass>` 继承于上，里面存储原本的 Pass，这样才实现了类似 `Pass*` 指针的效果，实现摆脱了低级继承的多态。我就他妈搞不懂了，人家继承是罪恶之源是真有一套极其复杂的继承关系还要有多态才罪恶，你 Pass 顶多单个继承个几层就零星几个多态方法就绷不住了要上[这套设计模式](https://sean-parent.stlab.cc/presentations/2013-03-06-value_semantics/value-semantics.cpp)，用的模板还贼多，写 C++ 的大约确实是受虐狂

#### class `PassManager`

新 PassManager 直接按 `Module`, `CallGraphSCC`,  `Function`, `Loop` 等单元**按层级**分成了对应 IR 单元 `UNIT` 的 `UNITPassManager`，最终一个 `Module` 应该在一个 `ModulePassManager` 中被处理。一个 IR 单元的 `UNITPassManager` 也是一个该单元的 Pass，子单元的 `ChildPassManager` 即按一个当前单元 Pass 的方式通过其提供的各种 Wrapper class 插入父单元的 `ParentPassManager` 中。一个 PassManager 中 Pass 运行的顺序按插入先后排序，这意味着一般情况下要**手动**实现自定义 Pass 顺序执行需要多写几个 PassManager，然后将它们插入到更高层级的 PassManager 中

一个组合好的高层级 PassManager 因为可能会出现其中各层级 Pass 相互影响结果的情况，要互相注册 `ProxyPass` 来通知 `invalidate` 等信息

#### class `PassBuilder`

考虑到上述 PassManager 复杂的层级嵌套非常反人类，特别是互相注册 `ProxyPass` 真的容易乱，LLVM 贴心地提供了 `PassBuilder` 来帮助构建完整的 PassManager，提供包括从启用的 Pass 字符串参数中构造等的功能。`PassBuilder` 另外一个重要功能是提供了插入各阶段/各 IR 单元 Pass 时的回调函数，每个 Pass 类注册时即要实现对应的回调函数，返回构造好的自己的对象，这样在调用 `PassBuilder` 时这些 Pass 便可**自动**插入到指定的位置，回调函数的实现也比之前调用默认构造函数的实现给了更多自由度

#### file `PassRegistry.def`

与之前直接在 C++ 代码使用全局变量的默认构造函数在单例对象内注册 Pass 不同，新的 PassManger 使用一个大的 `PassRegistry.def` 文件统一记录所有 Pass，之后直接在 `PassBuilder.h` 中引入。挺佛的，之前声明全局变量式注册带的挺好的，写到哪定义到哪，你给它直接换了，那只能说你 LLVM 开发者确实牛逼

#### 吐槽

鄙人写这系列文档的前后时间 LLVM 的官方文档正好把默认的 Pass 介绍从 [LegacyPassManager](https://llvm.org/docs/WritingAnLLVMPass.html) 换成 [NewPassManager](https://llvm.org/docs/WritingAnLLVMNewPMPass.html)，裂开来，且新版文档配套很差

另，观这般重构和折腾模板有感：

![image-20240226233126585](./skippy.png)