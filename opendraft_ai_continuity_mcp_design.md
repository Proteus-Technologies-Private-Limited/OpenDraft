# OpenDraft Fork: AI Continuity + MCP Story Bible 설계 명세서

**작성일:** 2026-06-02  
**대상:** Codex / AI coding agent / OpenDraft fork 개발자  
**기준 저장소:** `Proteus-Technologies-Private-Limited/OpenDraft` main branch, 확인일 2026-06-02  
**목표:** OpenDraft를 포크한 뒤, 기존 시나리오 편집 기능 위에 AI 특화 Story Bible, JSON 기반 인물/세계관/관계 관리, 설정 충돌 검수, MCP 내장 기능을 확장 가능한 구조로 추가한다.

---

## 0. Codex 실행 지침

Codex는 이 문서를 구현 지시서로 사용한다. 구현 중 저장소 실제 구조가 이 문서와 다를 경우, **저장소를 먼저 검사한 뒤 기존 패턴을 우선한다.** 단, 아래 원칙은 유지한다.

1. **OpenDraft core를 최소한으로 수정한다.**
   - 기존 plugin architecture와 backend extension point를 우선 사용한다.
   - core 수정이 필요하면 “범용 확장 포인트”만 추가한다.
   - AI continuity 기능 자체는 별도 feature/plugin 모듈에 둔다.

2. **AI는 자동으로 원고나 설정을 덮어쓰지 않는다.**
   - AI는 `issue`, `claim`, `patch_candidate`를 생성할 수 있다.
   - 실제 적용은 사용자의 명시적 승인 후에만 수행한다.

3. **Story Bible의 source of truth는 구조화된 JSON이다.**
   - SQLite는 검색/인덱스/캐시/성능용으로 사용한다.
   - Canon 데이터는 프로젝트 폴더 안의 JSON 파일로 보존한다.

4. **MCP는 read-only 기본값으로 시작한다.**
   - 모든 write/patch/tool 실행은 권한 스코프와 사용자 승인 UI를 거쳐야 한다.

5. **기능은 나중에 다른 프로그램에도 붙일 수 있게 만든다.**
   - OpenDraft adapter와 story core를 분리한다.
   - 시나리오 파서, Story Bible schema, consistency engine, MCP server는 UI에 종속되지 않게 작성한다.

6. **테스트를 함께 작성한다.**
   - JSON Schema validation test
   - deterministic consistency rule test
   - API smoke test
   - MCP resources/tools contract test
   - patch approval flow test

---

## 1. 확인된 OpenDraft 기반 정보

아래 사실은 2026-06-02에 웹에서 확인했다.

### 1.1 OpenDraft 현재 특성

OpenDraft는 무료 오픈소스 시나리오 작성 앱이며, Final Draft 대체재를 표방한다. 현재 README는 다음 기능을 명시한다.

- 전문 시나리오 포맷팅
- Beat Board
- 실시간 협업
- 버전 히스토리와 diff/restore
- Character Profiles
- Final Draft `.fdx`, Fountain, PDF import/export
- macOS / Windows / Linux desktop, browser, mobile 지원
- 로컬/오프라인 중심, MIT license

### 1.2 OpenDraft 개발 스택

README 기준 기술 스택은 다음과 같다.

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, TipTap editor |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Desktop | Tauri 2, Rust, bundled Python backend |
| Collaboration | Hocuspocus WebSocket server, Yjs CRDT |
| State | Zustand |
| Version Control | Git per project, built-in |

현재 주요 폴더는 다음과 같다.

```text
OpenDraft/
  frontend/          # React + TypeScript UI
  backend/           # FastAPI Python API server
  collab-server/     # Real-time collaboration server
  src-tauri/         # Tauri 2 desktop shell
  docs/
  user-manual/
```

### 1.3 OpenDraft plugin architecture

`CLAUDE.md`와 plugin files 기준으로, OpenDraft core에는 이미 plugin architecture가 있다.

Frontend extension points:

```text
frontend/src/plugins/registry.ts
  - menuItems
  - sidebar panels
  - routes
  - editorExtensions
  - grammarProviders
```

Backend extension points:

```text
backend/app/plugins.py
  - register_router(name, router, prefix, tags)
  - register_hook(event, callback)
  - run_hooks(event, **kwargs)
  - run_gate_hooks(event, **kwargs)
```

Built-in backend hook examples:

```text
app:startup
app:shutdown
script:before_save
script:after_save
project:created
project:deleted
```

이 설계에서는 이 plugin architecture를 적극 활용한다.

---

## 2. 제품 방향성

이 프로젝트는 단순한 “AI 시나리오 생성기”가 아니다. 핵심 포지션은 다음이다.

> **AI Continuity Supervisor for OpenDraft**  
> 작가가 승인한 Story Bible과 실제 대본에서 추출한 사실 claim을 비교해, 인물·관계·타임라인·세계관 설정 붕괴를 찾아내고 수정안을 제안하는 MCP 기반 창작 운영체제.

### 2.1 핵심 가치

| 기능 | 가치 | 우선순위 |
|---|---|---:|
| JSON 기반 Story Bible | 인물/세계관/관계를 AI가 정확히 읽을 수 있음 | 1 |
| 장면별 claim extraction | 대본 내용을 구조화된 사실로 변환 | 1 |
| Consistency engine | 설정 충돌/붕괴 탐지 | 1 |
| MCP Project Server | 외부 AI/agent가 프로젝트 컨텍스트에 표준 접근 | 1 |
| 관계도 그래프 | 인물 관계와 정보 공개 상태 시각화 | 2 |
| Timeline engine | 시간/나이/위치 충돌 탐지 | 2 |
| Character voice checker | 인물별 말투/성격 유지 검토 | 3 |
| Patch proposal | 사용자가 승인 가능한 diff 제안 | 2 |
| 외부 앱 포팅 | Obsidian/VS Code/standalone CLI 확장 | 4 |

### 2.2 하지 말아야 할 것

- Final Draft의 모든 production 기능을 처음부터 복제하지 않는다.
- AI 자동 집필을 제품의 중심으로 두지 않는다.
- 원고 전체를 기본으로 외부 LLM API에 전송하지 않는다.
- AI가 canon bible을 자동 수정하게 하지 않는다.
- MCP server가 shell command나 unrestricted file access를 기본 제공하지 않는다.

---

## 3. 전체 아키텍처

```text
OpenDraft Fork

[Existing Screenplay Editor]
  ├─ TipTap editor
  ├─ screenplay formatting
  ├─ Final Draft / Fountain / PDF import-export
  ├─ version history
  └─ collaboration via Yjs/Hocuspocus

[AI Continuity Plugin / Feature]
  ├─ Frontend panels
  │   ├─ Story Bible Manager
  │   ├─ Relationship Graph
  │   ├─ Timeline View
  │   ├─ AI Review Panel
  │   ├─ MCP Permission Console
  │   └─ Patch Review UI
  │
  ├─ Backend extension router
  │   ├─ Bible CRUD API
  │   ├─ Schema validation API
  │   ├─ Screenplay index API
  │   ├─ Claim extraction API
  │   ├─ Consistency review API
  │   ├─ Patch proposal/apply API
  │   └─ MCP server mount / launch manager
  │
  ├─ Story Core
  │   ├─ JSON Schema definitions
  │   ├─ data model
  │   ├─ parser adapters
  │   ├─ deterministic rule engine
  │   ├─ claim model
  │   ├─ issue model
  │   └─ patch model
  │
  ├─ AI Layer
  │   ├─ provider adapters
  │   ├─ prompt templates
  │   ├─ structured output validators
  │   ├─ evidence span extraction
  │   └─ safety filters
  │
  └─ MCP Layer
      ├─ resources
      ├─ tools
      ├─ prompts
      ├─ scope/permission model
      └─ audit log
```

### 3.1 핵심 데이터 흐름

```text
1. User edits screenplay in OpenDraft
2. script:after_save hook fires
3. Screenplay indexer parses scenes/dialogue/action
4. Claim extractor proposes structured claims
5. Claims are stored as hypothesis, not canon
6. Consistency engine compares:
     screenplay claims
     + canon Story Bible
     + timeline
     + relationship graph
     + world rules
7. Issues are generated with evidence spans
8. AI may propose patches
9. User reviews and approves/rejects
10. Approved changes update screenplay or Story Bible
11. MCP resources expose current project context to approved AI clients
```

---

## 4. Fork 전략

### 4.1 권장 전략

OpenDraft를 fork하되, AI 기능은 다음처럼 self-contained extension으로 구현한다.

```text
backend/app/ext/ai_continuity/
frontend/src/features/ai-continuity/
frontend/src/plugins/aiContinuityPlugin.tsx
```

core 수정은 다음에만 허용한다.

1. plugin registry가 필요한 slot을 제공하지 않을 때
2. editor selection/evidence span highlighting hook이 없을 때
3. project storage path를 plugin이 안전하게 resolve할 방법이 없을 때
4. script save/version lifecycle hook이 부족할 때

### 4.2 upstream mergeability 원칙

- OpenDraft upstream 변경을 pull하기 쉽게 유지한다.
- 기존 파일 수정은 작은 PR 단위로 제한한다.
- AI 기능 파일은 별도 namespace에 둔다.
- `ai-continuity`와 관련 없는 refactor는 하지 않는다.
- OpenDraft-Pro private repo나 commercial plugin 구조에 의존하지 않는다.

### 4.3 portable core 원칙

아래 모듈은 OpenDraft에 종속되지 않도록 만든다.

```text
story_core/
  schemas/
  models/
  validators/
  rules/
  claim_extraction/
  patching/
  mcp/
```

OpenDraft와 연결되는 부분은 adapter로 격리한다.

```text
opendraft_adapter/
  project_paths.py
  screenplay_loader.py
  script_save_hooks.py
  editor_span_mapper.py
  versioning_adapter.py
```

---

## 5. 데이터 저장 구조

### 5.1 프로젝트 내 파일 구조

OpenDraft의 실제 project storage 방식은 Codex가 repo에서 확인해야 한다. 아래 구조는 프로젝트 루트 아래에 추가할 권장 구조다.

```text
<project-root>/
  ai_continuity/
    manifest.json

    schemas/
      character.schema.json
      relationship.schema.json
      location.schema.json
      faction.schema.json
      object.schema.json
      world_rule.schema.json
      timeline_event.schema.json
      claim.schema.json
      issue.schema.json
      patch.schema.json

    bible/
      characters/
        char_<slug>.json
      relationships/
        rel_<slug>.json
      locations/
        loc_<slug>.json
      factions/
        faction_<slug>.json
      objects/
        obj_<slug>.json
      world_rules/
        rule_<slug>.json
      timeline/
        event_<slug>.json

    claims/
      scene_claims.jsonl
      dialogue_claims.jsonl
      character_state_claims.jsonl

    reviews/
      review_<timestamp>.json
      issues.jsonl

    patches/
      patch_<issue_id>_<timestamp>.json

    indexes/
      story_index.sqlite
      embeddings.sqlite

    prompts/
      continuity_review.md
      character_voice_review.md
      claim_extraction.md
      patch_generation.md

    audit/
      ai_actions.jsonl
      mcp_access.jsonl
```

### 5.2 JSON source of truth와 SQLite index 분리

- Canon Bible: JSON files
- Hypothesis claims: JSONL files
- Review issue history: JSONL files
- Cache/search/index: SQLite
- Embeddings: SQLite extension, local vector DB, or provider-specific cache

SQLite는 삭제되어도 재생성 가능해야 한다. JSON/JSONL은 사용자의 창작 데이터이므로 version control 대상이다.

---

## 6. Canon 상태 모델

모든 엔티티와 claim은 상태를 가진다.

| Status | 의미 |
|---|---|
| `canon` | 작가가 승인한 확정 설정 |
| `draft` | 사용자가 작성 중이나 아직 확정하지 않은 설정 |
| `hypothesis` | AI가 원고에서 추정한 설정 |
| `deprecated` | 폐기된 설정 |
| `conflicted` | canon과 충돌하는 설정 |

AI가 생성한 내용의 기본 상태는 항상 `hypothesis`다. 사용자가 승인해야 `canon`이 된다.

---

## 7. ID와 참조 규칙

### 7.1 ID prefix

```text
char_       character
rel_        relationship
loc_        location
faction_    faction
obj_        object/item/artifact
rule_       world rule
event_      timeline event
claim_      extracted claim
issue_      detected issue
patch_      proposed patch
scene_      screenplay scene
line_       line/span reference
```

### 7.2 source_refs

모든 중요한 설정은 근거를 가져야 한다.

```json
{
  "source_refs": [
    {
      "type": "bible",
      "path": "ai_continuity/bible/characters/char_jiwoo.json",
      "json_pointer": "/traits/0"
    },
    {
      "type": "screenplay",
      "script_id": "main",
      "scene_id": "scene_001",
      "line_start": 88,
      "line_end": 102,
      "text_preview": "지우는 거짓말을 하려다 숨이 막힌다."
    }
  ]
}
```

---

## 8. JSON Schema 설계

JSON Schema는 Draft 2020-12를 사용한다.

### 8.1 공통 메타 필드

모든 엔티티는 다음 필드를 공유한다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opendraft.local/schemas/common.entity.schema.json",
  "type": "object",
  "required": ["schema_version", "id", "type", "status", "created_at", "updated_at"],
  "properties": {
    "schema_version": { "type": "string" },
    "id": { "type": "string" },
    "type": { "type": "string" },
    "status": {
      "type": "string",
      "enum": ["canon", "draft", "hypothesis", "deprecated", "conflicted"]
    },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" },
    "source_refs": {
      "type": "array",
      "items": { "$ref": "#/$defs/sourceRef" }
    },
    "tags": {
      "type": "array",
      "items": { "type": "string" }
    },
    "notes": { "type": "string" }
  },
  "$defs": {
    "sourceRef": {
      "type": "object",
      "required": ["type"],
      "properties": {
        "type": { "type": "string", "enum": ["bible", "screenplay", "asset", "user_note", "ai_inference"] },
        "path": { "type": "string" },
        "json_pointer": { "type": "string" },
        "script_id": { "type": "string" },
        "scene_id": { "type": "string" },
        "line_start": { "type": "integer" },
        "line_end": { "type": "integer" },
        "text_preview": { "type": "string" }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": true
}
```

### 8.2 Character schema 예시

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opendraft.local/schemas/character.schema.json",
  "title": "Character",
  "type": "object",
  "required": ["schema_version", "id", "type", "status", "canonical_name"],
  "properties": {
    "schema_version": { "type": "string" },
    "id": { "type": "string", "pattern": "^char_[a-zA-Z0-9_-]+$" },
    "type": { "const": "character" },
    "status": { "enum": ["canon", "draft", "hypothesis", "deprecated", "conflicted"] },
    "canonical_name": { "type": "string" },
    "aliases": { "type": "array", "items": { "type": "string" } },
    "display_color": { "type": "string" },
    "logline": { "type": "string" },
    "role": {
      "type": "string",
      "enum": ["protagonist", "deuteragonist", "antagonist", "supporting", "minor", "unknown"]
    },
    "biography": { "type": "string" },
    "traits": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "label", "description"],
        "properties": {
          "id": { "type": "string" },
          "label": { "type": "string" },
          "description": { "type": "string" },
          "strength": { "type": "number", "minimum": 0, "maximum": 1 },
          "locked": { "type": "boolean", "default": false },
          "valid_from": { "type": ["string", "null"] },
          "valid_until": { "type": ["string", "null"] },
          "source_refs": { "type": "array" }
        },
        "additionalProperties": false
      }
    },
    "knowledge": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["fact_id", "description", "known_from"],
        "properties": {
          "fact_id": { "type": "string" },
          "description": { "type": "string" },
          "known_from": { "type": "string" },
          "public": { "type": "boolean", "default": false }
        }
      }
    },
    "timeline_state": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["at"],
        "properties": {
          "at": { "type": "string" },
          "age": { "type": ["integer", "null"] },
          "occupation": { "type": ["string", "null"] },
          "location_id": { "type": ["string", "null"], "pattern": "^loc_[a-zA-Z0-9_-]+$" },
          "emotional_state": { "type": ["string", "null"] },
          "physical_state": { "type": ["string", "null"] }
        }
      }
    },
    "relationships": {
      "type": "array",
      "items": { "type": "string", "pattern": "^rel_[a-zA-Z0-9_-]+$" }
    },
    "locked_fields": {
      "type": "array",
      "items": { "type": "string" }
    },
    "source_refs": { "type": "array" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 8.3 Relationship schema 예시

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opendraft.local/schemas/relationship.schema.json",
  "title": "Relationship",
  "type": "object",
  "required": ["schema_version", "id", "type", "status", "from", "to", "relationship_type"],
  "properties": {
    "schema_version": { "type": "string" },
    "id": { "type": "string", "pattern": "^rel_[a-zA-Z0-9_-]+$" },
    "type": { "const": "relationship" },
    "status": { "enum": ["canon", "draft", "hypothesis", "deprecated", "conflicted"] },
    "from": { "type": "string", "pattern": "^char_[a-zA-Z0-9_-]+$" },
    "to": { "type": "string", "pattern": "^char_[a-zA-Z0-9_-]+$" },
    "relationship_type": {
      "type": "string",
      "examples": ["family", "friends", "rivals", "former_lovers", "mentor", "enemy", "unknown"]
    },
    "directional": { "type": "boolean", "default": true },
    "strength": { "type": "number", "minimum": 0, "maximum": 1 },
    "trust": { "type": "number", "minimum": -1, "maximum": 1 },
    "public_knowledge": { "type": "boolean", "default": true },
    "valid_from": { "type": ["string", "null"] },
    "valid_until": { "type": ["string", "null"] },
    "description": { "type": "string" },
    "source_refs": { "type": "array" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 8.4 World rule schema 예시

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opendraft.local/schemas/world_rule.schema.json",
  "title": "WorldRule",
  "type": "object",
  "required": ["schema_version", "id", "type", "status", "title", "rule_text"],
  "properties": {
    "schema_version": { "type": "string" },
    "id": { "type": "string", "pattern": "^rule_[a-zA-Z0-9_-]+$" },
    "type": { "const": "world_rule" },
    "status": { "enum": ["canon", "draft", "hypothesis", "deprecated", "conflicted"] },
    "title": { "type": "string" },
    "rule_text": { "type": "string" },
    "scope": {
      "type": "string",
      "enum": ["physics", "magic", "technology", "law", "social", "religion", "economy", "geography", "other"]
    },
    "exceptions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["description"],
        "properties": {
          "description": { "type": "string" },
          "valid_from": { "type": ["string", "null"] },
          "valid_until": { "type": ["string", "null"] },
          "source_refs": { "type": "array" }
        }
      }
    },
    "locked": { "type": "boolean", "default": false },
    "source_refs": { "type": "array" },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 8.5 Claim schema 예시

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opendraft.local/schemas/claim.schema.json",
  "title": "ExtractedClaim",
  "type": "object",
  "required": ["id", "type", "claim_type", "status", "subject", "predicate", "evidence"],
  "properties": {
    "id": { "type": "string", "pattern": "^claim_[a-zA-Z0-9_-]+$" },
    "type": { "const": "claim" },
    "claim_type": {
      "type": "string",
      "enum": [
        "character_state",
        "relationship_state",
        "location_presence",
        "timeline_event",
        "knowledge_state",
        "world_rule_assertion",
        "object_ownership",
        "dialogue_fact",
        "plot_causality"
      ]
    },
    "status": { "enum": ["hypothesis", "canon", "rejected", "conflicted"] },
    "subject": { "type": "string" },
    "predicate": { "type": "string" },
    "object": { "type": ["string", "number", "boolean", "null"] },
    "qualifiers": { "type": "object" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "evidence": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["script_id", "scene_id"],
        "properties": {
          "script_id": { "type": "string" },
          "scene_id": { "type": "string" },
          "line_start": { "type": "integer" },
          "line_end": { "type": "integer" },
          "text_preview": { "type": "string" }
        }
      }
    },
    "created_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

### 8.6 Issue schema 예시

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://opendraft.local/schemas/issue.schema.json",
  "title": "ContinuityIssue",
  "type": "object",
  "required": ["issue_id", "severity", "category", "summary", "evidence", "status"],
  "properties": {
    "issue_id": { "type": "string", "pattern": "^issue_[a-zA-Z0-9_-]+$" },
    "severity": { "type": "string", "enum": ["info", "low", "medium", "high", "critical"] },
    "category": {
      "type": "string",
      "enum": [
        "schema_error",
        "missing_reference",
        "timeline_conflict",
        "location_conflict",
        "age_conflict",
        "relationship_conflict",
        "knowledge_conflict",
        "world_rule_violation",
        "characterization_conflict",
        "voice_drift",
        "unresolved_setup",
        "ai_uncertain"
      ]
    },
    "summary": { "type": "string" },
    "details": { "type": "string" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "evidence": { "type": "array" },
    "possible_resolutions": { "type": "array" },
    "status": { "type": "string", "enum": ["open", "ignored", "fixed", "needs_user_decision"] },
    "created_at": { "type": "string", "format": "date-time" },
    "resolved_at": { "type": ["string", "null"], "format": "date-time" }
  },
  "additionalProperties": false
}
```

---

## 9. Backend 설계

### 9.1 권장 파일 구조

```text
backend/app/ext/ai_continuity/
  __init__.py
  router.py
  config.py

  models/
    __init__.py
    common.py
    character.py
    relationship.py
    location.py
    world_rule.py
    timeline.py
    claim.py
    issue.py
    patch.py

  schemas/
    character.schema.json
    relationship.schema.json
    location.schema.json
    faction.schema.json
    object.schema.json
    world_rule.schema.json
    timeline_event.schema.json
    claim.schema.json
    issue.schema.json
    patch.schema.json

  services/
    project_paths.py
    bible_store.py
    schema_validator.py
    screenplay_indexer.py
    entity_resolver.py
    claim_extractor.py
    consistency_engine.py
    rule_engine.py
    patch_service.py
    audit_log.py
    llm_service.py
    mcp_service.py

  rules/
    base.py
    schema_rules.py
    reference_rules.py
    timeline_rules.py
    location_rules.py
    relationship_rules.py
    knowledge_rules.py
    world_rule_rules.py
    locked_field_rules.py

  prompts/
    claim_extraction.md
    continuity_review.md
    character_voice_review.md
    patch_generation.md

  tests/
    test_schema_validator.py
    test_bible_store.py
    test_claim_extractor.py
    test_rule_engine.py
    test_mcp_contract.py
```

### 9.2 Backend plugin registration

Codex는 OpenDraft의 기존 plugin system을 사용한다.

```python
# backend/app/ext/ai_continuity/__init__.py
from app.plugins import register_router, register_hook
from .router import router
from .services.index_hooks import after_script_save


def register() -> None:
    register_router(
        name="ai-continuity",
        router=router,
        prefix="/api/ext/ai-continuity",
        tags=["ai-continuity"],
    )
    register_hook("script:after_save", after_script_save)
```

만약 OpenDraft가 외부 plugin auto-discovery를 아직 제공하지 않으면, 최소 core change로 plugin import/registration hook을 추가한다.

### 9.3 API endpoints

Base prefix:

```text
/api/ext/ai-continuity
```

#### Health

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "feature": "ai-continuity",
  "version": "0.1.0"
}
```

#### Project manifest

```http
GET /projects/{project_id}/manifest
POST /projects/{project_id}/initialize
```

`initialize`는 `ai_continuity/` 폴더와 기본 schemas/prompts를 생성한다. 이미 존재하면 idempotent하게 동작한다.

#### Bible CRUD

```http
GET    /projects/{project_id}/bible/entities?type=character&status=canon
POST   /projects/{project_id}/bible/entities/{entity_type}
GET    /projects/{project_id}/bible/entities/{entity_type}/{entity_id}
PATCH  /projects/{project_id}/bible/entities/{entity_type}/{entity_id}
DELETE /projects/{project_id}/bible/entities/{entity_type}/{entity_id}
POST   /projects/{project_id}/bible/validate
```

모든 write 요청은 다음을 수행한다.

1. JSON Schema validation
2. ID collision check
3. reference integrity check
4. audit log append
5. OpenDraft project version/checkpoint 생성 여부 확인

#### Relationship graph

```http
GET /projects/{project_id}/graph
POST /projects/{project_id}/graph/rebuild
```

Response:

```json
{
  "nodes": [
    { "id": "char_jiwoo", "label": "한지우", "type": "character" }
  ],
  "edges": [
    {
      "id": "rel_jiwoo_minseok_001",
      "source": "char_jiwoo",
      "target": "char_minseok",
      "label": "former_lovers",
      "public_knowledge": false,
      "valid_from": "scene_001",
      "valid_until": null
    }
  ]
}
```

#### Screenplay index

```http
POST /projects/{project_id}/screenplay/index
GET  /projects/{project_id}/screenplay/scenes
GET  /projects/{project_id}/screenplay/scenes/{scene_id}
```

Scene index object:

```json
{
  "scene_id": "scene_001",
  "script_id": "main",
  "heading": "INT. 경찰서 취조실 - 밤",
  "location_text": "경찰서 취조실",
  "time_of_day": "밤",
  "line_start": 1,
  "line_end": 67,
  "characters_present": ["char_jiwoo", "char_minseok"],
  "dialogue_blocks": [
    {
      "character_id": "char_jiwoo",
      "character_name_raw": "지우",
      "line_start": 22,
      "line_end": 25,
      "text": "..."
    }
  ]
}
```

#### Claim extraction

```http
POST /projects/{project_id}/claims/extract
GET  /projects/{project_id}/claims?scene_id=scene_001&status=hypothesis
POST /projects/{project_id}/claims/{claim_id}/approve
POST /projects/{project_id}/claims/{claim_id}/reject
```

Request:

```json
{
  "scope": {
    "script_id": "main",
    "scene_ids": ["scene_001", "scene_002"]
  },
  "mode": "deterministic_first",
  "use_llm": true,
  "provider": "default"
}
```

#### Consistency review

```http
POST /projects/{project_id}/review/consistency
GET  /projects/{project_id}/review/issues?status=open
POST /projects/{project_id}/review/issues/{issue_id}/ignore
POST /projects/{project_id}/review/issues/{issue_id}/mark-fixed
```

Request:

```json
{
  "scope": {
    "script_id": "main",
    "scene_ids": ["scene_001"]
  },
  "checks": [
    "schema",
    "references",
    "timeline",
    "location",
    "relationships",
    "knowledge",
    "world_rules",
    "character_voice"
  ],
  "use_llm": true
}
```

#### Patch proposal and application

```http
POST /projects/{project_id}/patches/propose
GET  /projects/{project_id}/patches/{patch_id}
POST /projects/{project_id}/patches/{patch_id}/apply
POST /projects/{project_id}/patches/{patch_id}/reject
```

Patch object:

```json
{
  "patch_id": "patch_issue_00042_20260602_120000",
  "issue_id": "issue_00042",
  "target_type": "screenplay",
  "target_ref": {
    "script_id": "main",
    "scene_id": "scene_007",
    "line_start": 102,
    "line_end": 118
  },
  "diff_format": "unified",
  "diff": "--- before\n+++ after\n@@ ...",
  "rationale": "지우는 canon상 직접 거짓말할 수 없으므로 침묵으로 대체합니다.",
  "requires_user_approval": true,
  "created_by": "ai",
  "created_at": "2026-06-02T12:00:00Z"
}
```

---

## 10. Frontend 설계

### 10.1 권장 파일 구조

```text
frontend/src/features/ai-continuity/
  index.ts
  plugin.tsx

  api/
    client.ts
    types.ts

  components/
    StoryBiblePanel.tsx
    CharacterEditor.tsx
    RelationshipEditor.tsx
    RelationshipGraph.tsx
    TimelineView.tsx
    ContinuityReviewPanel.tsx
    IssueList.tsx
    IssueDetail.tsx
    PatchReviewDialog.tsx
    McpPermissionPanel.tsx
    ClaimInbox.tsx

  editor/
    continuityHighlightExtension.ts
    entityMentionExtension.ts

  state/
    aiContinuityStore.ts

  styles/
    ai-continuity.css
```

### 10.2 Plugin registration

```tsx
// frontend/src/features/ai-continuity/plugin.tsx
import { pluginRegistry } from '../../plugins/registry';
import StoryBiblePanel from './components/StoryBiblePanel';
import ContinuityReviewPanel from './components/ContinuityReviewPanel';
import RelationshipGraph from './components/RelationshipGraph';
import { continuityHighlightExtension } from './editor/continuityHighlightExtension';

export function registerAiContinuityPlugin() {
  pluginRegistry.register({
    id: 'ai-continuity',
    name: 'AI Continuity',
    version: '0.1.0',
    menuItems: [
      {
        id: 'ai-continuity-review-current-scene',
        section: 'Tools',
        label: 'AI Continuity: Review Current Scene',
        order: 50,
        action: async () => {
          // open review panel and call API
        }
      },
      {
        id: 'ai-continuity-open-bible',
        section: 'Tools',
        label: 'Open Story Bible',
        order: 51,
        action: async () => {
          // navigate to /ai-continuity/bible or open panel
        }
      }
    ],
    panels: [
      {
        id: 'ai-continuity-bible-panel',
        slot: 'right-sidebar',
        component: StoryBiblePanel,
        label: 'Story Bible',
        order: 20
      },
      {
        id: 'ai-continuity-review-panel',
        slot: 'right-sidebar',
        component: ContinuityReviewPanel,
        label: 'AI Review',
        order: 21
      }
    ],
    routes: [
      { path: '/ai-continuity/graph', component: RelationshipGraph }
    ],
    editorExtensions: [continuityHighlightExtension]
  });
}
```

Codex는 실제 OpenDraft entry point를 확인하여 이 plugin registration을 앱 시작 시 실행되게 연결한다.

### 10.3 UI 모드

#### Writer Mode

- 원고 작성 화면 유지
- 우측 패널에서 현재 장면 이슈 표시
- 설정 충돌 span highlight
- “검수하기” 버튼

#### Bible Mode

- 인물, 장소, 세계관 규칙, 물건, 파벌 관리
- JSON raw editor와 form editor 둘 다 제공
- schema validation error 즉시 표시

#### Review Mode

- issue list
- severity filter
- evidence 비교
- possible resolutions
- patch proposal 생성/승인

#### Graph Mode

- 인물 관계 그래프
- 관계 유형, 비밀/공개 여부, 시점별 필터
- 그래프 노드 클릭 시 CharacterEditor 열기

#### MCP Mode

- MCP server enable/disable
- connected clients
- granted scopes
- last accessed resources/tools
- revoke button

---

## 11. Relationship Graph 설계

### 11.1 그래프 데이터 모델

Nodes:

```json
{
  "id": "char_jiwoo",
  "type": "character",
  "label": "한지우",
  "status": "canon",
  "role": "protagonist",
  "display_color": "#7C3AED"
}
```

Edges:

```json
{
  "id": "rel_jiwoo_minseok_001",
  "source": "char_jiwoo",
  "target": "char_minseok",
  "type": "former_lovers",
  "label": "former lovers",
  "directional": true,
  "strength": 0.8,
  "trust": -0.3,
  "public_knowledge": false,
  "valid_from": "scene_001",
  "valid_until": null,
  "source_refs": []
}
```

### 11.2 UI library

권장: `cytoscape` 또는 `react-cytoscapejs`.  
이미 frontend에 `recharts`가 있으나, 관계 그래프에는 node-edge graph library가 더 적합하다.

### 11.3 필터

- episode / scene range
- public only / include secrets
- canon only / include hypothesis
- relationship type
- character role

---

## 12. Screenplay indexing

### 12.1 목표

OpenDraft 원고를 장면 단위로 분해하고, AI 검수와 evidence span에 필요한 구조를 만든다.

### 12.2 Scene index 필드

```python
class SceneIndex(BaseModel):
    scene_id: str
    script_id: str
    heading: str | None
    location_text: str | None
    normalized_location_id: str | None
    time_of_day: str | None
    line_start: int
    line_end: int
    synopsis: str | None = None
    characters_present: list[str] = []
    mentioned_entities: list[str] = []
    dialogue_blocks: list[DialogueBlock] = []
    action_blocks: list[ActionBlock] = []
```

### 12.3 Entity resolution

대본 속 `지우`, `한지우`, `JIWOO`, `HAN JIWOO` 등을 `char_jiwoo`로 매핑해야 한다.

우선순위:

1. exact alias match
2. normalized alias match
3. character name autocomplete dictionary from OpenDraft
4. LLM-assisted disambiguation, user confirmation required

모호한 경우 claim confidence를 낮추고 `needs_user_decision` issue를 생성한다.

---

## 13. Claim extraction 설계

### 13.1 Claim taxonomy

| claim_type | 예시 |
|---|---|
| `character_state` | “지우는 3화 2장에서 왼팔을 다쳤다.” |
| `relationship_state` | “민석은 지우를 배신자로 생각한다.” |
| `location_presence` | “민석은 같은 시각 부산에 있다.” |
| `timeline_event` | “살인은 2026-05-01 밤에 발생했다.” |
| `knowledge_state` | “지우는 아직 범인의 정체를 모른다.” |
| `world_rule_assertion` | “이 세계에서는 기억 조작이 불가능하다.” |
| `object_ownership` | “USB는 서연이 갖고 있다.” |
| `dialogue_fact` | “민석은 알리바이를 고백한다.” |
| `plot_causality` | “A 사건 때문에 B가 발생한다.” |

### 13.2 Claim extraction modes

#### deterministic mode

- scene heading parse
- character dialogue blocks
- explicit aliases
- location/time extraction
- simple regex/rule extraction

#### LLM mode

- scene chunk를 제한된 context로 제공
- canon bible relevant subset만 제공
- JSON output schema 강제
- output을 JSON Schema로 validate
- evidence span이 없는 claim은 reject 또는 low confidence

### 13.3 Claim prompt 기본 원칙

LLM prompt는 다음을 강제한다.

```text
- Extract only facts supported by the provided scene text.
- Do not invent backstory.
- Every claim must include evidence line range.
- Use known entity IDs when possible.
- If uncertain, set confidence below 0.6 and explain ambiguity.
- Output valid JSON only.
```

---

## 14. Consistency engine 설계

### 14.1 Deterministic rule engine

기계적으로 잡을 수 있는 문제는 LLM을 쓰지 않는다.

Rules:

| Rule | 설명 |
|---|---|
| `SchemaValidationRule` | 모든 Bible JSON이 schema를 통과하는지 확인 |
| `MissingReferenceRule` | 존재하지 않는 `char_`, `loc_`, `rel_` 참조 탐지 |
| `DuplicateAliasRule` | 여러 인물이 같은 alias를 공유하는지 탐지 |
| `LockedFieldRule` | AI/hypothesis가 locked field 변경을 제안하는지 탐지 |
| `TimelineOrderRule` | valid_from/valid_until 순서 오류 탐지 |
| `AgeRule` | 출생연도/나이/시점 불일치 탐지 |
| `LocationConflictRule` | 같은 시각 같은 인물이 두 장소에 존재하는지 탐지 |
| `KnowledgeRule` | 인물이 알 수 없는 정보를 대사로 말하는지 탐지 |
| `RelationshipValidityRule` | 관계가 valid_until 이후에도 지속되는 것처럼 쓰이는지 탐지 |
| `WorldRuleHardViolationRule` | 예외 없는 locked world rule 위반 탐지 |

### 14.2 LLM semantic review

LLM은 다음처럼 “의미 판단”이 필요한 부분만 담당한다.

| Review | 설명 |
|---|---|
| character voice drift | 특정 인물의 말투/가치관이 붕괴되는지 |
| emotional continuity | 직전 장면 감정선과 다음 장면 감정선이 과도하게 비약하는지 |
| world rule soft violation | 세계관 규칙을 직접 위반하진 않지만 어색한 부분 |
| unresolved setup | 앞에서 제시한 떡밥이 장기간 방치되는지 |
| scene motivation | 인물의 행동 동기가 canon 설정과 맞는지 |

### 14.3 Issue 생성 규칙

모든 issue는 다음을 포함해야 한다.

- severity
- category
- summary
- evidence 최소 2개 이상 권장
- confidence
- possible_resolutions
- auto_fixable 여부
- patch_candidate 여부

AI가 evidence 없이 만든 issue는 `severity=info`, `category=ai_uncertain`으로 낮춘다.

---

## 15. Patch proposal 설계

### 15.1 Patch 종류

| target_type | 설명 |
|---|---|
| `screenplay` | 원고 일부 수정 diff |
| `bible_entity` | character/world_rule/relationship JSON 수정 |
| `claim_status` | hypothesis claim 승인/거절 |
| `timeline` | timeline event 추가/수정 |

### 15.2 Patch 안전 규칙

- AI는 직접 파일을 수정하지 않는다.
- patch는 diff와 rationale만 생성한다.
- UI는 before/after를 보여준다.
- 적용 전 OpenDraft version checkpoint를 만든다.
- 적용 후 consistency review를 다시 실행한다.

### 15.3 Conflict resolution UX

이슈 하나에 대해 사용자는 다음 중 선택한다.

```text
1. 원고를 수정한다.
2. Story Bible을 수정한다.
3. 예외 규칙을 추가한다.
4. AI 추론이 틀렸으므로 issue를 무시한다.
5. 나중에 결정한다.
```

---

## 16. MCP 설계

### 16.1 MCP 사용 방향

이 프로젝트에서 MCP는 두 가지 역할을 가진다.

1. **Project MCP Server**
   - 현재 OpenDraft 프로젝트의 Story Bible, scenes, claims, issues를 AI client에 표준 방식으로 노출한다.

2. **MCP Client Manager**
   - 사용자가 허용한 외부 MCP server를 연결한다.
   - 예: local file search, research tools, image tools, Git tools.
   - 초기 MVP에서는 Project MCP Server부터 구현한다.

### 16.2 SDK 선택

OpenDraft backend가 Python/FastAPI 기반이므로, 초기 구현은 **Python MCP SDK / FastMCP**를 우선한다.

주의:

- TypeScript SDK main branch는 2026-06-02 기준 v2 pre-alpha 안내가 있으므로, production에서 TypeScript SDK를 쓸 경우 v1.x branch 또는 stable release를 pin한다.
- Python SDK README는 v1.x stable을 문서화하며 resources/tools/prompts 구현 예시를 제공한다.

### 16.3 MCP transport

MVP:

```text
local streamable HTTP or stdio
localhost only
read-only default
```

권장:

```text
/api/ext/ai-continuity/mcp
```

또는 desktop app에서는 별도 local port를 열되, 다음을 지킨다.

- localhost bind only
- random session token
- project-scoped access token
- explicit enable/disable switch
- per-client consent
- audit log

### 16.4 MCP Resources

```text
opendraft://project/{project_id}/summary
opendraft://project/{project_id}/screenplay/scenes
opendraft://project/{project_id}/screenplay/scene/{scene_id}
opendraft://project/{project_id}/bible/characters
opendraft://project/{project_id}/bible/character/{character_id}
opendraft://project/{project_id}/bible/relationships
opendraft://project/{project_id}/bible/world-rules
opendraft://project/{project_id}/timeline
opendraft://project/{project_id}/claims?scene_id={scene_id}
opendraft://project/{project_id}/issues?status=open
opendraft://project/{project_id}/graph
```

### 16.5 MCP Tools

Tools는 권한 등급을 가진다.

#### Read/basic tools

```text
story.search_entities(query, entity_types?, status?)
story.get_character(character_id)
story.get_scene(scene_id)
story.query_graph(query)
story.find_character_state(character_id, at_scene_or_event)
story.list_open_issues(severity?)
```

#### Analysis tools

```text
story.extract_claims(scope)
story.check_consistency(scope, checks?)
story.check_character_voice(character_id, scope)
story.check_world_rule(rule_id, scope)
story.trace_setup_and_payoff(entity_or_claim_id)
```

#### Proposal tools

```text
story.propose_screenplay_patch(issue_id)
story.propose_bible_patch(issue_id)
story.propose_timeline_event(claim_id)
```

#### Mutating tools

MVP에서는 MCP mutating tools를 제공하지 않는다. 나중에 제공하더라도 기본 비활성화한다.

```text
story.apply_patch(patch_id)  # disabled by default; UI approval required
story.approve_claim(claim_id) # disabled by default; UI approval required
```

### 16.6 MCP Prompts

```text
continuity_review
character_voice_review
relationship_dynamics_review
world_rule_violation_review
scene_rewrite_with_constraints
episode_recap
extract_claims_from_scene
```

Prompt example:

```text
You are the continuity supervisor for this OpenDraft project.
Use only the provided resources and tool results.
Do not invent canon.
If the script contradicts canon, cite both evidence spans.
Return issues in the project's ContinuityIssue JSON format.
```

### 16.7 MCP scopes

```text
story:read:summary
story:read:screenplay-selected
story:read:screenplay-all
story:read:bible
story:read:claims
story:read:issues
story:analyze:claims
story:analyze:consistency
story:propose:patch
story:write:bible
story:write:screenplay
```

Default grant:

```text
story:read:summary
story:read:bible
story:read:screenplay-selected
story:analyze:consistency
story:propose:patch
```

No default write scopes.

### 16.8 MCP audit log

Every MCP access writes JSONL:

```json
{
  "timestamp": "2026-06-02T12:00:00Z",
  "project_id": "project_123",
  "client_id": "claude_desktop_local",
  "action_type": "tool_call",
  "name": "story.check_consistency",
  "scope": "story:analyze:consistency",
  "resource_refs": ["scene_001", "char_jiwoo"],
  "allowed": true,
  "user_approved": true
}
```

---

## 17. AI provider layer

### 17.1 Provider interface

```python
class LLMProvider(Protocol):
    name: str

    async def complete_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        response_schema: dict,
        temperature: float = 0.1,
        max_tokens: int | None = None,
        signal: Any | None = None,
    ) -> dict:
        ...
```

### 17.2 Provider registry

```text
providers/
  openai_provider.py
  anthropic_provider.py
  gemini_provider.py
  ollama_provider.py
  mock_provider.py
```

초기 구현은 `mock_provider.py`와 provider interface만 만들어도 된다. 실제 외부 API는 feature flag 뒤에 둔다.

### 17.3 API key 저장

- API key는 프로젝트 파일에 저장하지 않는다.
- 가능하면 OS keychain/Tauri secure storage를 사용한다.
- fallback은 환경 변수다.
- 로그에 prompt 전문이나 API key를 남기지 않는다.

### 17.4 Context minimization

LLM에 보내는 정보는 최소화한다.

- 현재 scene
- 관련 characters
- 관련 relationships
- 관련 world_rules
- 관련 timeline events
- 필요한 evidence snippets

원고 전체 전송은 사용자가 명시적으로 선택한 경우에만 허용한다.

---

## 18. Prompt templates

### 18.1 Claim extraction prompt

```md
# Task
Extract structured story claims from the selected screenplay scene.

# Rules
- Use only the scene text and provided known entity list.
- Do not invent backstory or canon.
- Every claim must include evidence line range.
- Prefer existing entity IDs over raw names.
- If an entity is ambiguous, use raw text and set confidence <= 0.6.
- Output valid JSON matching ExtractedClaim[].

# Known entities
{{known_entities_json}}

# Scene
{{scene_text_with_line_numbers}}

# Output schema
{{claim_schema_json}}
```

### 18.2 Continuity review prompt

```md
# Role
You are a continuity supervisor for a screenplay project.

# Task
Find contradictions between the selected screenplay content and the canon Story Bible.

# Hard rules
- Do not rewrite the scene unless asked.
- Do not invent canon.
- Every issue must cite at least one screenplay evidence span and one canon/claim evidence span when possible.
- If uncertain, return category `ai_uncertain` with low confidence.
- Output valid JSON matching ContinuityIssue[].

# Canon Bible subset
{{canon_bible_subset_json}}

# Existing claims
{{claims_json}}

# Scene text
{{scene_text_with_line_numbers}}

# Output schema
{{issue_schema_json}}
```

### 18.3 Patch generation prompt

```md
# Role
You propose safe, reviewable patches for a screenplay continuity issue.

# Rules
- Never apply the patch directly.
- Return a patch candidate only.
- Preserve the writer's style as much as possible.
- Prefer minimal edits.
- Explain whether the script or the Story Bible should change.
- Output valid JSON matching PatchCandidate.

# Issue
{{issue_json}}

# Relevant text or JSON
{{target_content}}
```

---

## 19. Security and privacy requirements

### 19.1 Local-first defaults

- AI Continuity folder lives inside the project directory.
- No cloud sync unless user already uses OpenDraft collaboration/cloud features.
- No external LLM call by default.
- User must opt into provider and see what context is sent.

### 19.2 MCP security

Mandatory:

- explicit user consent before enabling MCP server
- per-client approval
- scope minimization
- read-only default
- no broad file system access
- no shell execution tools in this feature
- audit logs
- revoke access UI
- localhost-only for local server
- require auth token for local HTTP transport
- display exact command before launching external MCP server
- warn for dangerous commands if MCP Client Manager is implemented

### 19.3 Prompt injection mitigation

Treat screenplay text, imported PDFs, notes, and external research as untrusted data.

- Separate system instructions from scene content.
- Never let scene text redefine tool policy.
- Tool calls require schema validation and policy check.
- AI output is data, not command.
- Patch application requires user approval.
- External MCP tool descriptions are untrusted unless server is trusted.

### 19.4 Data redaction

For logs:

- store issue summaries and metadata
- do not store full prompt by default
- allow debug prompt logging only behind explicit developer flag
- redact API keys and auth tokens

---

## 20. Testing strategy

### 20.1 Backend unit tests

```text
test_schema_validator.py
  - valid character passes
  - missing required fields fail
  - invalid relationship references fail

test_bible_store.py
  - create/read/update/delete entity
  - ID collision handling
  - status transitions
  - source_refs persistence

test_rule_engine.py
  - missing char reference issue
  - duplicate alias issue
  - timeline order issue
  - locked world rule violation
  - location conflict issue

test_claim_extractor.py
  - deterministic scene heading extraction
  - dialogue speaker extraction
  - claim JSON validation

test_patch_service.py
  - patch candidate creation
  - patch cannot apply without approval
  - checkpoint before apply

test_mcp_contract.py
  - list resources
  - read character resource
  - check_consistency tool returns issue schema
  - write tool disabled by default
```

### 20.2 Frontend tests

Use the repo's existing test setup if present. If absent, add minimal component tests only after checking project conventions.

Test targets:

- StoryBiblePanel renders entity list
- CharacterEditor displays schema validation errors
- IssueList filters by severity/status
- PatchReviewDialog shows before/after
- McpPermissionPanel revokes scope

### 20.3 Fixture project

Create a test fixture with intentional contradictions.

```text
fixtures/ai_continuity/minimal_project/
  screenplay/main.fountain
  ai_continuity/bible/characters/char_jiwoo.json
  ai_continuity/bible/locations/loc_seoul.json
  ai_continuity/bible/world_rules/rule_no_lie.json
```

Example contradiction:

- Canon: Jiwoo cannot consciously lie.
- Scene: Jiwoo calmly fabricates an alibi.
- Expected issue: `characterization_conflict` or `world_rule_violation`, severity high.

---

## 21. Implementation roadmap

### Phase 1: Repository audit and extension scaffold

Goal: AI Continuity plugin skeleton loads without breaking OpenDraft.

Tasks:

1. Inspect actual OpenDraft startup flow.
2. Find how plugin modules are imported/registered.
3. Add backend extension router under `backend/app/ext/ai_continuity`.
4. Register `/api/ext/ai-continuity/health`.
5. Add frontend plugin registration.
6. Add “AI Continuity” menu item and right sidebar placeholder panel.
7. Add smoke tests.

Acceptance criteria:

- `GET /api/ext/ai-continuity/health` returns ok.
- OpenDraft editor still loads.
- AI Continuity panel appears.
- No existing OpenDraft tests fail.

### Phase 2: Story Bible storage and schema validation

Goal: project-scoped JSON Bible CRUD.

Tasks:

1. Add `ai_continuity/manifest.json` initializer.
2. Add schema files.
3. Implement `BibleStore`.
4. Implement `SchemaValidator`.
5. Add CRUD endpoints.
6. Add frontend CharacterEditor minimal form.
7. Add raw JSON editor fallback.
8. Add validation UI.

Acceptance criteria:

- User can create a character JSON.
- Invalid JSON shows validation errors.
- Valid JSON is persisted in project folder.
- Store is project-scoped.

### Phase 3: Screenplay indexing

Goal: parse existing OpenDraft screenplay into scene index.

Tasks:

1. Implement adapter to load current script content.
2. Extract scene headings, line ranges, dialogue blocks.
3. Resolve character aliases.
4. Store index in SQLite and JSON cache.
5. Add `/screenplay/scenes` endpoints.
6. Add tests with fixture script.

Acceptance criteria:

- Scene list matches script.
- Dialogue speakers are extracted.
- Evidence line ranges are stable.

### Phase 4: Deterministic consistency engine v0

Goal: useful non-LLM checks.

Tasks:

1. Implement rule engine interface.
2. Add schema/reference/duplicate alias/locked field rules.
3. Add timeline/location basic rules.
4. Add issue schema and issue store.
5. Add review endpoint.
6. Add IssueList UI.

Acceptance criteria:

- A fixture contradiction produces expected issue.
- Issues include evidence refs.
- Issue can be ignored/marked fixed.

### Phase 5: Relationship graph

Goal: user-visible relationship graph.

Tasks:

1. Implement graph builder from characters + relationships.
2. Add graph endpoint.
3. Add frontend graph view.
4. Add filters for status/public_knowledge/type.

Acceptance criteria:

- Character nodes and relationship edges render.
- Clicking a node opens CharacterEditor.
- Secret relationships can be hidden.

### Phase 6: LLM provider and claim extraction

Goal: extract claims with structured output.

Tasks:

1. Add provider interface and mock provider.
2. Add prompt templates.
3. Add claim schema validation.
4. Implement deterministic claim extraction.
5. Implement LLM claim extraction behind feature flag.
6. Add ClaimInbox UI for approve/reject.

Acceptance criteria:

- Mock provider tests pass.
- Claims are hypothesis by default.
- User can approve claim into canon or reject it.

### Phase 7: LLM continuity review

Goal: semantic AI review with evidence.

Tasks:

1. Build context selector.
2. Add continuity review prompt.
3. Validate LLM output against issue schema.
4. Add confidence thresholding.
5. Add UI to compare canon evidence and screenplay evidence.

Acceptance criteria:

- Review produces JSON issues only.
- Evidence spans are visible in UI.
- Unsupported AI claims are downgraded or rejected.

### Phase 8: Patch proposal flow

Goal: AI suggests safe diffs; user applies.

Tasks:

1. Add patch schema.
2. Add patch generation prompt.
3. Add patch proposal API.
4. Add PatchReviewDialog.
5. Add user approval endpoint.
6. Create OpenDraft version checkpoint before patch apply.

Acceptance criteria:

- Patch cannot apply without approval.
- Before/after diff is shown.
- Applying patch creates a checkpoint.
- User can reject patch.

### Phase 9: MCP Project Server

Goal: expose project context to MCP clients safely.

Tasks:

1. Add MCP service using Python MCP SDK / FastMCP.
2. Expose read-only resources.
3. Expose analysis tools.
4. Add permissions/scopes.
5. Add audit log.
6. Add MCP enable/disable UI.
7. Test with MCP Inspector or a simple client.

Acceptance criteria:

- MCP server disabled by default.
- User can enable it for current project.
- Resources return project-scoped data.
- Mutating tools are unavailable by default.
- Audit log records resource/tool access.

### Phase 10: Portability extraction

Goal: story core can be reused outside OpenDraft.

Tasks:

1. Move schema/model/rule logic into a package-like module.
2. Create CLI wrapper.
3. Keep OpenDraft adapter thin.
4. Document integration points for VS Code/Obsidian/standalone.

Acceptance criteria:

- Core rule engine can run from CLI against fixture folder.
- OpenDraft UI still uses same core.
- No UI imports inside story core.

---

## 22. Proposed CLI for portability

Add optional CLI later:

```bash
python -m ai_continuity init ./my-project
python -m ai_continuity validate ./my-project
python -m ai_continuity index ./my-project
python -m ai_continuity extract-claims ./my-project --scene scene_001
python -m ai_continuity review ./my-project --all
python -m ai_continuity mcp ./my-project --readonly
```

This makes the feature usable from other editors later.

---

## 23. Migration and versioning

### 23.1 Manifest

```json
{
  "schema_version": "1.0.0",
  "feature_version": "0.1.0",
  "created_at": "2026-06-02T12:00:00Z",
  "updated_at": "2026-06-02T12:00:00Z",
  "project_id": "...",
  "settings": {
    "local_first": true,
    "llm_enabled": false,
    "mcp_enabled": false,
    "default_claim_status": "hypothesis"
  }
}
```

### 23.2 Schema migrations

Create migration scripts:

```text
backend/app/ext/ai_continuity/migrations/
  0001_initial.py
  0002_add_knowledge_state.py
```

Migrations must:

- never delete user data without backup
- write backup before migration
- preserve unknown fields if possible
- record migration in manifest

---

## 24. Configuration

Project-level config:

```json
{
  "ai": {
    "enabled": false,
    "default_provider": "mock",
    "send_full_script_allowed": false,
    "log_prompts": false
  },
  "mcp": {
    "enabled": false,
    "transport": "streamable_http",
    "host": "127.0.0.1",
    "port": 0,
    "default_scopes": [
      "story:read:summary",
      "story:read:bible",
      "story:read:screenplay-selected",
      "story:analyze:consistency",
      "story:propose:patch"
    ]
  },
  "review": {
    "auto_index_on_save": true,
    "auto_review_on_save": false,
    "minimum_issue_confidence": 0.55
  }
}
```

---

## 25. UI copy examples

### MCP enable warning

```text
MCP lets external AI clients read selected project data and call approved analysis tools.
Enable only clients you trust. Write actions are disabled by default.
You can review and revoke access at any time.
```

### Patch approval warning

```text
AI has proposed a change. It has not been applied yet.
Review the before/after diff carefully. OpenDraft will create a version checkpoint before applying.
```

### Claim approval warning

```text
This claim was inferred from the screenplay. Approving it will add it to your canon Story Bible.
```

---

## 26. Coding standards

Follow existing OpenDraft style.

Backend:

- Python type hints
- Pydantic models
- FastAPI APIRouter
- small service classes
- async where existing APIs are async
- no broad exception swallowing except plugin hook isolation

Frontend:

- React + TypeScript
- Zustand if state is needed
- existing CSS conventions first
- no large global state unless necessary
- components should be reusable and small

Tests:

- prefer fixtures
- deterministic tests for rules
- mock LLM provider for AI tests
- no external API calls in tests

---

## 27. Codex task prompt

Use the following prompt when sending this file to Codex.

```text
You are working in a fork of Proteus-Technologies-Private-Limited/OpenDraft.
Read this entire Markdown design file first.

Goal:
Implement the AI Continuity + MCP Story Bible feature incrementally, starting with Phase 1.

Rules:
- Keep OpenDraft upstream-mergeable.
- Use existing plugin architecture before modifying core.
- Do not implement automatic AI writes.
- Story Bible JSON is source of truth; SQLite is index/cache only.
- MCP is disabled by default and read-only by default.
- Add tests for every backend service and API you introduce.
- If repository structure differs from this spec, inspect the repo and adapt while preserving the architecture.

Start with Phase 1 only:
1. Inspect existing frontend/backend plugin registration flow.
2. Add backend ai_continuity extension with /api/ext/ai-continuity/health.
3. Add frontend AI Continuity placeholder panel and Tools menu item.
4. Add smoke tests.
5. Document exactly which files were changed.
6. Do not proceed to Phase 2 until Phase 1 passes.
```

---

## 28. Reference URLs

Use these references to validate architecture assumptions and implementation choices.

- OpenDraft GitHub repository: https://github.com/Proteus-Technologies-Private-Limited/OpenDraft
- OpenDraft CLAUDE.md plugin architecture note: https://raw.githubusercontent.com/Proteus-Technologies-Private-Limited/OpenDraft/main/CLAUDE.md
- OpenDraft frontend plugin registry: https://raw.githubusercontent.com/Proteus-Technologies-Private-Limited/OpenDraft/main/frontend/src/plugins/registry.ts
- OpenDraft backend plugin system: https://raw.githubusercontent.com/Proteus-Technologies-Private-Limited/OpenDraft/main/backend/app/plugins.py
- MCP specification 2025-11-25: https://modelcontextprotocol.io/specification/2025-11-25
- MCP security best practices: https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices
- MCP Python SDK: https://github.com/modelcontextprotocol/python-sdk
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
- JSON Schema specification: https://json-schema.org/specification
- JSON Schema Draft 2020-12: https://json-schema.org/draft/2020-12
- Tauri architecture: https://v2.tauri.app/concept/architecture/
- Yjs docs: https://docs.yjs.dev/
- Cytoscape.js package: https://www.npmjs.com/package/cytoscape
```
