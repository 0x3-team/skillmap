# Security Notes

SkillMap treats third-party skills as untrusted metadata until reviewed.

Slice 1 flags risk indicators:

- executable scripts
- malformed frontmatter
- broad invocation language
- duplicate names
- oversized skill bodies

SkillMap does not run skill scripts, install hooks, or delete skills in Slice 1.
