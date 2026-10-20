# 沙盒、机器、云电脑统一在一个 Sys 能力接口后面

- **Date:** 2026-10-20
- **Type:** feature
- **Scope:** `core`

[English](2026-10-20-unified-sys-interface.md)

活儿发生的地方——本机、沙盒、机器、云电脑——各自带一套自己的抽象：文件工具走自己的端口，沙盒改写一次 exec 的 argv，机器带着自己的传输与命令集。新增的能力接口把一套词汇放到它们全部后面：`Sys`，一个能力逐项可选的世界——文件（`fs`）、命令执行（`exec`）、网络端点（`listen`）——经 `@prismshadow/penguin-core/sys` 子路径取用，提供方按插件契约同样的方式对着契约编译。

## 细节

- `fs` 能力就是文件工具已经在走的那一个面，原样收编——`HostSys` 发的就是工具的本机端口，所以经宿主 Sys 读文件与今天不受限会话的行为逐字节相同；告诉错误措辞一次拒绝是不是一次围堵的 `sandboxed` 标记一并随行。
- `HostSys` 是宿主的默认世界（`createSys()`），是默认而非基类：沙盒、机器或云电脑在它旁边提供自己的 Sys，不在它下面。宿主的 `exec` 把精确的 argv 作为子进程运行；宿主的 `listen` 默认绑定 loopback，开端点、连端点。
- 每个衍生功能点名自己需要的能力，Sys 不带就拒绝（`SYS_CAPABILITY_ABSENT`，错误里点名缺哪个）——缺失从不跳过、也从不安静改道另一个世界。接口靠增加可选成员生长，对着早一版写的提供方保持有效。
- `createReadFileTool(sys)` 把内建 `read_file` 绑到一个 Sys 的 `fs` 上；`createAgent(sys, opts?)` 在宿主默认上返回 SDK 自己的 agent，在其它 Sys 上一句点名去处的拒绝；`forwardPort(sysX, sysY, portX, portY?)` 让一个 Sys 上的连接由另一个 Sys loopback 上的端口应答，每条连接是独立的一对流，目的地拒绝只关掉那条连接、转发继续服务。服务端启动的衍生（`runServer(sys, port)`）由接口文档记为机器侧那一步的落点。
- 新增测试钉住可选性与 fail-closed 规则、宿主的三项能力、每个衍生在宿主默认与 stub 世界两边的表现、以及两个 Sys 之间一次端到端的转发。
