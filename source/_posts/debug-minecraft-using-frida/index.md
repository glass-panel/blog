---
title: 使用 Frida 黑盒调试 Minecraft
date: 2026-4-19 23:12:31
tags: ["Frida", "Java", "Minecraft"]
excerpt: <img src="/post/debug-minecraft-using-frida/logs.jpg">
---

### 问题
某 297 个 Mod 的 Minecraft 1.20.1 大型整合包，在进入地狱后频繁出现以下报错

```log
[10:52:15] [Worker-Main-68/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
[10:52:15] [Worker-Main-68/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
[10:52:15] [Worker-Main-68/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
[10:52:15] [Worker-Main-68/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
...
```

由于模组数量众多且依赖复杂，常规逐个或二分扬掉看看是谁的锅的方法已不现实，且 log 严重缺乏上下文和有效信息，无法定位问题

### 解决方案
有 log 输出就是好事，可以顺着输出 log 的函数向上爬堆栈找到问题根源。可以确定 Minecraft 使用 Log4j 为日志库，即从 Log4j 内的函数下手

从头编译一个用于调试的 Log4j 库并注入进 Minecraft 理论是可行的，但考虑到 Minecraft 自身混淆与 Modloader 之间缠缠绵绵所带来的各种重载问题及即时修改的便利性，不准备使用此方法

在这种情况下 [Frida](https://frida.re/) 是一个很 Promising 的方案，其能将自定义的 JavaScript 脚本注入目标进程并提供了从 native 到 Java 等平台的 hook 方法，非常强大

非常遗憾的是 Frida 对 Java 的支持很明显是以 Android ART 运行时为优先的，桌面端的 JVM 可以说是顺带的产物，功能较为有限但足够用。令笔者头疼的是其对 JVM 实现的挑食，首先使用的 JVM 必须带有调试符号，其次 Frida 对 Java 方法的 hook 实现非常简单粗暴：可以简化为解析 JVM 内部数据结构，将实现对象方法的 native 函数指针替换为自己的 gadget 并最终导向用户的 JS 脚本，另外辅以必要的 JVM 缓存清理等内部函数。这无疑要求 JVM 实现完全得跟着它的假设走，甚至某指令中放置 this 指针的寄存器不同都能导致模式匹配失败。经笔者测试，Windows 端上基本上是没戏了，能较新较好运行起来的是 x86_64 Linux 下 [Temurin 的 JDK 17](https://adoptium.net/temurin/releases?version=17&os=any&arch=any)，再高的 JDK 版本 Frida 支持也不行了

解决环境问题后的事情并没有变得简单，正如笔者之前所料，Forge 会让本来就很混乱的现场变得更糟：
1. Minecraft 在这种旧版本仍然使用了混淆，在加载之初混淆没解开前是没法定位到任何有意义的类或对象的，所以需要延迟执行 hook 脚本
2. Forge 等模组加载器为了高效加载模组，会存在多个 ClassLoader，一般只有在主 ClassLoader 内才能定位所需类
3. 由于以上原因加上很多 Mod 还要去 mixin 现有类，若 hook 时机姿势不当很容易当场坠机

需要注意的是 2. 中所述在主 ClassLoader 中定位类并非指默认的 `java.lang.ClassLoader`，而是 Forge 的 `cpw.mods.modlauncher.TransformingClassLoader`，其他模组加载器可能存在不同。这在 Frida 需要 hook Java 方法时更是必要的，从默认的 Java ClassLoader 出发 hook 所找到的类时可以成功，但无法见效，也有可能整个卡死或崩溃，这大概是 Forge 需要避免默认 ClassLoader 使用的反射性能开销，也高强度 override 了绝大多数的类以实现正确的加载顺序

当一切都准备就绪后，剩下的内容就非常愉快了，笔者首先替换 log4j 的 log，在输出特定内容时打印当前堆栈。由于 `org.apache.logging.log4j.Logger` 的 Log 方法重载令人发指的多，不方便一个个 hook，这里选择追到头上的 `org.apache.logging.log4j.core.Logger`

```javascript
function getLoader(patten, nothrow = false) {
    const loader = Java.enumerateClassLoadersSync().filter(i => i.toString().includes(patten))[0];
    if (!loader)
        throw Error(`No loader found for ${patten}`)
    return Java.ClassFactory.get(loader);
}

function getJavaStacktrace() {
    const sw = Java.use("java.io.StringWriter").$new();
    const pw = Java.use("java.io.PrintWriter").$new(sw);
    const err = Java.use("java.lang.Throwable").$new();
    err.printStackTrace(pw);
    return sw.toString();
}

const Loader = getLoader("TransformingClassLoader");
const Logger = Loader.use("org.apache.logging.log4j.core.Logger");
let once = true;
Logger.log.implementation = function (...args) {
    // log(Level level, Marker marker, String fqcn, StackTraceElement location, Message message, Throwable throwable)
    if (args[0].toString() == "WARN") {
        const msg = args[4].getFormattedMessage();
        if (once && msg.includes("Empty height range: biased")) {
            once = false;
            console.log(`[!] TARGET: ${msg} \n  ${getJavaStacktrace()}`);
        }
    }
    this.log(...args);
};
```

效果拔群

```log
stdout> [13:36:02] [Server thread/INFO]: glass_panel加入了游戏
stdout> [13:36:02] [Render thread/INFO]: Loaded 32 advancements
[!] TARGET: Empty height range: biased[0 above bottom-194 below top inner: 8]
  java.lang.Throwable
        at MC-BOOTSTRAP/org.apache.logging.log4j.core@2.19.0/org.apache.logging.log4j.core.Logger.log(Native Method)
        ...
        at MC-BOOTSTRAP/org.apache.logging.log4j.slf4j@2.19.0/org.apache.logging.slf4j.Log4jLogger.warn(Log4jLogger.java:240)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.levelgen.heightproviders.VeryBiasedToBottomHeight.m_213859_(VeryBiasedToBottomHeight.java:40)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.levelgen.placement.HeightRangePlacement.m_213676_(HeightRangePlacement.java:42)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.levelgen.placement.PlacedFeature.m_226372_(PlacedFeature.java:48)
        at java.base/java.util.stream.ReferencePipeline$7$1.accept(ReferencePipeline.java:273)
        ...
        at java.base/java.util.stream.ReferencePipeline.forEach(ReferencePipeline.java:596)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.levelgen.placement.PlacedFeature.m_226368_(PlacedFeature.java:53)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.levelgen.placement.PlacedFeature.redirect$zzi000$onPlaceWithBiome(PlacedFeature.java:554)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.levelgen.placement.PlacedFeature.m_226377_(PlacedFeature.java:42)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.chunk.ChunkGenerator.m_213609_(ChunkGenerator.java:357)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.chunk.ChunkStatus.m_279978_(ChunkStatus.java:108)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.chunk.ChunkStatus$SimpleGenerationTask.m_214024_(ChunkStatus.java:309)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.world.level.chunk.ChunkStatus.m_280308_(ChunkStatus.java:252)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.server.level.ChunkMap.lambda$scheduleChunkGeneration$27(ChunkMap.java:643)
        at MC-BOOTSTRAP/datafixerupper@6.0.8/com.mojang.datafixers.util.Either$Left.map(Either.java:38)
        at TRANSFORMER/minecraft@1.20.1/net.minecraft.server.level.ChunkMap.lambda$scheduleChunkGeneration$29(ChunkMap.java:634)
        ...
stdout> [13:36:05] [Worker-Main-13/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
stdout> [13:36:05] [Worker-Main-13/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
```

观察整个 stacktrace，可以推断出错误发生在区块生成中放置 `Feature` 这么个过程中。定位到 `net.minecraft.world.level.levelgen.placement.PlacedFeature` 这个关键类，根据 [Minecraft Wiki](https://minecraft.wiki/w/Placed_feature) 所述，这是需要生成 Minecraft 结构的描述，从沙漠神殿等大型建筑到小的某些地形特征都算，里面也指定了生成所需的高度范围等分布数据，跟报错描述一致，对上了对上了

考虑到问题函数调用后立马报错，简单模拟一个栈来记录问题函数调用时的数据，这里直接在 `PlacedFeature.m_226368_` 中对着该对象 `toString()`，并在检测到报错时立刻输出栈顶内容

```javascript
    const METHOD = 'm_226368_';
    const Loader = getLoader("TransformingClassLoader");
    const PF = Loader.use("net.minecraft.world.level.levelgen.placement.PlacedFeature");
    const Logger = Loader.use("org.apache.logging.log4j.core.Logger");
    const records = [];
    PF[METHOD].implementation = function (...args) {
        // args[0] PlacementContext
        records.push("" + this.toString());
        return this[METHOD](...args);
    }
    Logger.log.implementation = function (...args) {
        // log(Level level, Marker marker, String fqcn, StackTraceElement location, Message message, Throwable throwable)
        if (args[0].toString() == "WARN"
        && args[4].getFormattedMessage().includes("Empty height range: biased")
        && records.length) {
            console.log(`[!] FOUND ${records.at(-1)}`);
            records.length = 0;
            return;
        }
        this.log(...args);
    };
    setInterval(() => { records.length = 0 }, 1000);
```

```log
stdout> [13:50:24] [Server thread/INFO]: glass_panel加入了游戏
stdout> [13:50:24] [Render thread/INFO]: Loaded 32 advancements
stdout> [13:50:27] [Worker-Main-1/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
[!] FOUND Placed Reference{ResourceKey[minecraft:worldgen/configured_feature / minecraft:spring_lava_overworld]=Configured: net.minecraft.world.level.levelgen.feature.SpringFeature@5f23d4fa: net.minecraft.world.level.levelgen.feature.configurations.SpringConfiguration@11be329}
stdout> [13:50:27] [Worker-Main-1/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
stdout> [13:50:27] [Worker-Main-1/WARN]: Empty height range: biased[0 above bottom-194 below top inner: 8]
```

如上，问题已经接近尾声，可以确定是在生成 `spring_lava_overworld` 时报的错，结合上文中百科所提供的信息可以得知这些数据以 JSON 形式定义于数据包中，遂直接对着 mods 文件夹暴力 grep，并没有发现完全符合条件的内容，但可以得知 `spring_lava_overworld` 由 `spring_lava` 细分而来，继续暴力 grep，所剩结果并不多，可以逐个排查。较为优雅的亦可 find -exec 逐个解压 grep，可以完全找到符合 `spring_lava_overworld` 的内容

```bash
grep spring_lava -r -a mods/
```

```log
mods/Hearths v1.0.5.mod.jar:                    "minecraft:spring_lava",
...
mods/Incendium_1.20.x_v5.3.5.jar: xxxxxx data/minecraft/worldgen/configured_feature/spring_lava.json xxxx
...
mods/WWOO-FABRIC+FORGE+QUILT-2.0.0.jar: xxxxxx data/wythers/worldgen/placed_feature/terrain/feature/spring_lava.json xxxx
...
```

发现模组 `WWOO-FABRIC+FORGE+QUILT-2.0.0.jar` 中 `spring_lava.json` 的定义存在与报错完全一致的数据

```json
{
    "feature": "minecraft:spring_lava_overworld",
    ...
    {
        "type": "minecraft:height_range",
        "height": {
            "type": "minecraft:very_biased_to_bottom",
            "min_inclusive": {
                "above_bottom": 0
            },
            "max_inclusive": {
                "below_top": 194
            },
            "inner": 8
        }
    }
}
```

该定义声明了岩浆瀑布应该在顶向下 194 格后、底向上 0 格中生成，应该是试图解决主世界中高悬的岩浆瀑布问题(?)，但是这个声明同时也限制了全部高度内应该出现岩浆瀑布且本就高度不足的下界，导致了报错产生。且由于为数据包，由 Minecraft 本体处理并直接在非常底层的地形生成中应用，故输出 log 严重缺乏信息

随便改改其中数值或整个 Mod 扬掉即可解决问题

### 还有一件事
在 hook 时可能出现进程卡死，推测是由于 Java 中某些神秘的锁被占用后由于 hook 的操作没有释放，可以简单 `Java.use` 调用一下没什么副作用的函数解开

### 还还有一件事
算上解决环境问题感觉不如用 recaf 直接爆干字节码