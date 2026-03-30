export type { FsAgentPlugin } from "./plugin";
export { extractXmlPlugin } from "./extract-xml-plugin";
export {
  createSkillsPlugin,
  type AgentSkill,
} from "./skills-plugin";
export {
  createFilesystemAgentHarness,
  runFilesystemAgent,
} from "./harness";