import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/**
 * Everything this plugin carries, declared for the plugin library. Data only: the class has no
 * body and the package no entry point; `build` writes this literal into `ifaces.json`.
 */
@Component({
  contributes: {
    "PluginLibraryModule.cards": [
      {
        id: "memsearch.card",
        title: "MemSearch",
        titleZh: "MemSearch 记忆",
        descriptionZh:
          "MemSearch：给 Agent 加上长期记忆——stop hook 在每个任务结束时让后台子 Agent 把过程浓缩成每日 markdown 日记并用 memsearch CLI 建索引，user_prompt hook 提示可召回，memory-recall 技能语义搜索过往会话。需要本机安装 memsearch CLI。",
        shortDescription: "Long-term memory: journal every task, recall past sessions semantically.",
        shortDescriptionZh: "长期记忆：每个任务写成日记，语义召回过往会话。",
        category: "office-productivity",
        icon: "icon.svg",
        quickStart: {
          prompt:
            "Search my memory for past decisions and debugging notes about this project, and summarize what you find.",
          promptZh: "搜索记忆，找出这个项目过去做过的决定和调试笔记，并总结给我。",
          skills: ["memory-recall"],
        },
        references: ["https://github.com/zilliztech/memsearch"],
      },
    ],
    "PluginLibraryModule.skills": [
      { id: "memsearch.skill.memory-recall", name: "memory-recall", path: "skills/memory-recall" },
    ],
    "PluginLibraryModule.hooks": [
      {
        id: "memsearch.hooks",
        version: "2026.11.20.1",
        path: "hooks",
        user_prompt: [{ command: "user-prompt.mjs", timeout: 30 }],
        stop: [{ command: "stop.mjs", timeout: 60 }],
      },
    ],
  },
})
export class MemsearchPlugin {}

export default { modules: [MemsearchPlugin] } satisfies Plugin;