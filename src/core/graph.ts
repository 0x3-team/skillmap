import type { EffectiveSkill, GraphEdge, Inventory, Policy, SkillGraph } from '../schemas/types.js';

export function buildGraph(inventory: Inventory, mode: 'raw' | 'effective', policy?: Policy, effectiveSkills?: EffectiveSkill[]): SkillGraph {
  const nodes = new Map<string, { id: string; type: string; label: string }>();
  const edges: GraphEdge[] = [];
  const skills = mode === 'effective' && effectiveSkills ? effectiveSkills.filter((skill) => skill.routeEligible) : inventory.skills;
  const addNode = (id: string, type: string, label: string) => nodes.set(id, { id, type, label });
  const addEdge = (from: string, to: string, type: string, source: GraphEdge['source'], confidence = 1) => edges.push({ from, to, type, source, confidence });

  for (const skill of skills) {
    const skillId = `skill:${skill.name}`;
    addNode(skillId, 'skill', skill.name);
    addNode(`root:${skill.root}`, 'root', skill.root);
    addEdge(skillId, `root:${skill.root}`, 'installed_at', 'scan');
    if (skill.hasScripts) {
      addNode('risk:has_scripts', 'risk', 'has scripts');
      addEdge(skillId, 'risk:has_scripts', 'risk_flag', 'scan');
    }
    if (skill.referenceCount > 0) {
      addNode('resource:references', 'resource', 'references');
      addEdge(skillId, 'resource:references', 'has_reference', 'scan');
    }
    const family = 'family' in skill && typeof skill.family === 'string' ? skill.family : undefined;
    if (family) {
      addNode(`family:${family}`, 'family', family);
      addEdge(skillId, `family:${family}`, 'belongs_to', 'policy');
    }
  }

  if (policy) {
    for (const [name, entry] of Object.entries(policy.skills)) {
      const skillId = `skill:${name}`;
      if (!nodes.has(skillId) && mode === 'raw') addNode(skillId, 'policy-skill', name);
      if (entry.supersedes) for (const target of entry.supersedes) addEdge(skillId, `skill:${target}`, 'supersedes', 'policy');
      if (entry.overlaps) for (const target of entry.overlaps) addEdge(skillId, `skill:${target}`, 'overlaps', 'policy', 0.8);
      if (entry.preferred_for) for (const intent of entry.preferred_for) {
        addNode(`intent:${intent}`, 'intent', intent);
        addEdge(skillId, `intent:${intent}`, 'preferred_for', 'policy');
      }
      if (entry.avoid_for) for (const intent of entry.avoid_for) {
        addNode(`intent:${intent}`, 'intent', intent);
        addEdge(skillId, `intent:${intent}`, 'avoid_for', 'policy');
      }
    }
  }

  return { version: 1, generatedAt: new Date().toISOString(), mode, nodes: [...nodes.values()], edges };
}

export function renderMermaid(graph: SkillGraph): string {
  const lines = ['flowchart TD'];
  const safe = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_');
  for (const node of graph.nodes.slice(0, 80)) lines.push(`  ${safe(node.id)}["${node.label.replace(/"/g, '\\"')}"]`);
  for (const edge of graph.edges.slice(0, 120)) lines.push(`  ${safe(edge.from)} -->|${edge.type}| ${safe(edge.to)}`);
  return `${lines.join('\n')}\n`;
}
