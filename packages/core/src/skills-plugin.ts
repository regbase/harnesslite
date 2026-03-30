import { tool } from "ai";
import { z } from "zod";
import type { PluginAgentPlugin } from "./plugin";

export interface AgentSkill {
  name: string;
  description: string;
  content: string;
}

function skillsSystemPromptSection(skills: AgentSkill[]): string {
  const lines = [
    "## Agent skills",
    "You have access to optional skills. Each skill's name and description are listed below. The full body of a skill is not in this message — use the read_skill tool with the exact skill name when you need it.",
    "",
  ];
  if (skills.length === 0) {
    lines.push("(No skills are configured.)");
  } else {
    for (const s of skills) {
      lines.push(`- **${s.name}**: ${s.description}`);
    }
  }
  return lines.join("\n");
}

/**
 * Supplies in-memory skills: names and descriptions go into the system prompt;
 * full content is loaded on demand via the `read_skill` tool.
 */
export function createSkillsPlugin(options: {
  skills: AgentSkill[];
}): PluginAgentPlugin {
  const { skills } = options;
  const byName = new Map<string, AgentSkill>();
  for (const s of skills) {
    if (byName.has(s.name)) {
      throw new Error(`createSkillsPlugin: duplicate skill name "${s.name}"`);
    }
    byName.set(s.name, s);
  }

  const readSkill = tool({
    description: "Load the full text of an agent skill by name. Call this when you need to follow skill-specific instructions.",
    inputSchema: z.object({
      name: z
        .string()
        .describe("Exact skill name as shown in the system prompt."),
    }),
    execute: async ({ name }) => {
      const skill = byName.get(name);
      if (!skill) {
        const available = [...byName.keys()].join(", ") || "none";
        return {
          error: `Unknown skill "${name}". Available: ${available}`,
        };
      }
      return { name: skill.name, content: skill.content };
    },
  });

  return {
    name: "skills",
    systemPrompt: () => skillsSystemPromptSection(skills),
    tools: () => ({ read_skill: readSkill }),
  };
}
