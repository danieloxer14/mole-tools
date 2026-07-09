# Subagents: high-level guide

This repo is not the full `pi-subagents` README. It is the short version: what the package is for, the default role patterns, and how to author/update custom subagents without drowning in options.

## What `pi-subagents` does

It lets the parent session delegate work to focused child agents.

Use it for:
- fast code scouting
- planning
- implementation
- review
- Jira/context distillation
- chained workflows
- parallel analysis
- background work
- decision escalation back to the parent

## The simple mental model

- **Scout**: collect facts quickly
- **Planner**: turn facts into a plan
- **Worker**: make the change
- **Reviewer**: challenge the change
- **Grill**: challenge the plan and ask for missing decisions
- **Context builder**: produce handoff material

## Recommended role defaults

| Role | Model | Context | Tools | Output |
|---|---|---|---|---|
| scout | fast local | fresh | read-only | `context.md` |
| jira scout | fast local | fresh | Jira read + read-only | `jira-context.md` |
| chain scout+jira | fast local | fresh | read-only + Jira | `brief.md` |
| grill | strong | fork or fresh | read + ask-back channel (e.g. `rpiv-ask-user-question`) | `questions.md` |
| planner | strong | fork or fresh | read-only | `plan.md` |

## Good defaults

### 1) Fast local scout

Use this when you need codebase recon, file paths, entry points, and risks.

Prompt shape:
- map the relevant files
- identify entry points and flow
- note risks and unknowns
- do not edit
- return a short handoff

### 2) Jira distiller

Use this when the source of truth is Jira, a story, or linked Confluence.

Prompt shape:
- fetch the issue
- summarize acceptance criteria
- extract constraints, dependencies, and unresolved questions
- do not over-explain

### 3) Scout + Jira chain

Use this when you need both local code context and ticket context.

Typical flow:
- scout the repo
- fetch/distill Jira
- synthesize one concise brief for the parent

### 4) Grill / challenge agent

Use this for hard decisions, architecture tension, or ambiguous scope.

Prompt shape:
- challenge assumptions
- identify missing decisions
- ask questions back to the parent instead of guessing
- use a stronger model

### 5) Planner

Use this once the scope is clear enough to design the work.

Prompt shape:
- propose phases
- define acceptance checks
- call out risks and non-goals
- stay out of implementation

## How to author a custom subagent

When you create or update a custom agent, decide these first:

1. **Role**: scout, planner, grill, worker, reviewer, etc.
2. **Model**: fast local vs stronger reasoning
3. **Context mode**: `fresh` for unbiased inspection, `fork` for inherited discussion
4. **Tooling**: read-only vs write-capable
5. **Output shape**: short brief, plan, handoff, or structured JSON
6. **Stop rule**: when to stop, and when to ask the parent
7. **Where it lives**: project `.pi/` files or user-global `~/.pi/agent/` files

### File layout

- Agent prompt + frontmatter: `.pi/agents/<name>.md`
- Chain workflow: `.pi/chains/<name>.chain.md` or `.pi/chains/<name>.chain.json`
- Model override only: `.pi/settings.json`

If you want a new subagent, the prompt file is the agent file itself.
If you only want to change the model, put that in settings instead of copying the whole prompt.

### Editing rule of thumb

- change **model/thinking** with settings overrides when possible
- change **prompt/persona** in the agent file
- change **workflow shape** with a chain file
- keep one writer, many readers

## Minimal prompt template

```md
You are <role>.

Goal:
- ...

Context:
- ...

Constraints:
- ...

Output:
- ...

Stop when:
- ...
```

That template becomes the body of the agent markdown file.

## Best practice

Keep specialist prompts short.

If the prompt is trying to do the job of a human manager, it is probably too big.
