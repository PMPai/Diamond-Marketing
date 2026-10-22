# Data Contracts v1 — 数据契约

所有阶段的结构化 JSON 输出必须符合本契约。后台 Importer（backend/importer.js）按此解析入库。

**通用规则：**
- 所有文件 UTF-8，顶层必含 `project_id`、`run_id`、`stage`。
- ID 体系（跨阶段稳定引用）：`source_id`（SRC-###）、`claim_id`（CLM-###）、`metric_id`（MET-###）、`initiative_id`（INI-#）、`task_id`（WBS-###）、`checkpoint_id`（CKP-###）。
- 时间一律 ISO8601；金额必须带 `currency`；`confidence` 取值 `high|medium|low`；`status` 取值 `fact|assumption|to_verify`。

## data/information.json

```json
{
  "project_id": "", "run_id": "", "stage": "information",
  "company_overview": {"name":"","website":"","products":[""],"business_model":"","markets":[""]},
  "positioning_initial": {"statement":"","value_proposition":"","evidence":["CLM-001"]},
  "customer_needs": [{"segment":"","needs":[""],"barriers":[""],"evidence":["SRC-001"]}],
  "competitors": [{"name":"","offering":"","strengths":[""],"weaknesses":[""],"evidence":["SRC-002"]}],
  "swot": {"S":[""],"W":[""],"O":[""],"T":[""],"paired_opportunities":[{"pair":"S+O","desc":""}]},
  "sources": [{"source_id":"SRC-001","title":"","provider":"","url":"","published":"","fetched":"","scope":"","cited_in":[""],"verification":"verified|unverified"}],
  "claims": [{"claim_id":"CLM-001","text":"","evidence":["SRC-001"],"confidence":"high","status":"fact","section":""}],
  "data_gaps": [{"field":"","reason":"","impact":[""],"resolution":"user|public|estimate"}],
  "metrics": [{"metric_id":"MET-001","name":"","definition":"","formula":"","unit":"","window":""}]
}
```

## data/insights.json

```json
{
  "project_id": "", "run_id": "", "stage": "insights",
  "market_stage": {"name":"","segment":"","evidence":["CLM-001"],"confidence":"medium","alternatives":[{"name":"","why_rejected":""}]},
  "adopter_segment": {"class":"","rationale":""},
  "four_p": {"product":"","price":"","place":"","promotion":"","consistency_check":""},
  "four_c_check": {"customer_need":"","total_cost":"","convenience":"","communication":""},
  "qbq": [{"phenomenon":"","evidence":[""],"root_question":"","controllable":[""],"hypotheses":[""],"validation":"","criteria":"","relation_type":"descriptive|correlation|causal_hypothesis|verified"}],
  "imc": {"one_voice":{"audience":"","core_need":"","comm_goal":"","core_message":"","support":[""],"tone":"","cta":""},"matrix":[{"audience":"","message":"","channel":"","timing":"","action":"","measure":""}],"content_rules":""},
  "arc": {"overview":"","subtasks":[{"id":"A1","name":"","applicable":true,"actions":[""],"inputs":[""],"outputs":[""],"owner_role":"","systems":[""],"kpi":"","acceptance":""}],"data_foundation":{"identity_rule":"","metric_rule":"","time_rule":""}},
  "metrics": [{"metric_id":"MET-002","name":"","definition":"","formula":"","unit":"","window":""}]
}
```

## data/goal.json

```json
{
  "project_id": "", "run_id": "", "stage": "goal",
  "finance_definitions": {"roi_formula":"","margin_boundary":"","cost_boundary":"","ltv_rule":""},
  "selected": [{
    "initiative_id":"INI-1","title":"","arc_focus":"A|R|C","segment":"","problem":"",
    "actions":[""],"core_message":"",
    "cost_abc":{"media":0,"content":0,"labor":0,"tools":0,"other":0,"total":0,"currency":"CNY"},
    "expected":{"reach":0,"leads":0,"deals":0},
    "benefit":{"incremental_margin":0,"currency":"CNY","attribution_window":""},
    "scenarios":[{"name":"pessimistic|base|optimistic","cost":0,"benefit":0,"roi":0,"payback_months":0,"assumptions":[""]}],
    "breakeven":{"condition":"","sensitivity":[""]},
    "risks":[""],"validation":"",
    "smart_goal":{"specific":"","measurable":"","achievable":"","relevant":"","time_bound":""},
    "kpis":{"process":[{"metric_id":"","formula":"","source":"","window":""}],"outcome":[{"metric_id":"","formula":"","source":"","window":""}]},
    "priority_status":"confirmed|provisional","provisional_note":""
  }],
  "minto":{"top":"","middle":[""],"bottom":[{"initiative_id":"","evidence":[""],"value_hypothesis":"","actions":[""],"measures":[""]}]}
}
```

## data/roi-scenarios.json

```json
{
  "project_id":"","run_id":"","stage":"goal",
  "scenarios_by_initiative":[{"initiative_id":"INI-1","rows":[{"name":"","cost":0,"attributable_margin":0,"roi":0,"payback_months":0,"assumptions":[""]}]}],
  "shared_customer_dedup":[{"customer_scope":"","initiatives":["INI-1"],"attribution_rule":""}]
}
```

## data/initiative.json

```json
{
  "project_id":"","run_id":"","stage":"initiative",
  "initiatives":[{"initiative_id":"INI-1","goal_chain":{"goal":"","key_actions":[{"action_id":"ACT-#","title":"","value_hypothesis":{"if":"","then":"","measure":""}}]}}],
  "tool_research":[{"need_action":"","candidates":[{"system":"","capability_evidence":"","integration":"","cost_limits":"","simple_alternative":"","verified":true}]}]
}
```

## data/wbs.json

```json
{
  "project_id":"","run_id":"","stage":"initiative",
  "tasks":[{"task_id":"WBS-001","parent_id":null,"initiative_id":"INI-1","arc_stage":"A|R|C",
    "title":"","action":"","target":"","message":"","cta":"",
    "inputs":[""],"deliverables":[""],"owner_role":"待指定","collaborators":[""],
    "resources":{"people":"","budget":0,"currency":"CNY","tools":[""],"time_days":0},
    "depends_on":[],"duration_days":0,"done_criteria":"","kpi":"",
    "risks":[{"risk":"","mitigation":"","permission_needed":""}],"status":"planned"}]
}
```

## data/implementation.json

```json
{
  "project_id":"","run_id":"","stage":"implementation",
  "consistency_check":{"wbs_aligned":true,"budget_aligned":true,"deviations":[]},
  "risks_top":[{"risk":"","impact":"","response":""}]
}
```

## data/schedule.json

```json
{
  "project_id":"","run_id":"","stage":"implementation",
  "tasks":[{"task_id":"WBS-001","start":"第 1 周","end":"","duration_days":0,"depends_on":[],"parallel_group":""}],
  "milestones":[{"name":"","at":"","criteria":""}]
}
```

## data/checkpoints.json

```json
{
  "project_id":"","run_id":"","stage":"implementation",
  "checkpoints":[{"checkpoint_id":"CKP-001","task_ref":"WBS-001","due":"","criteria":"","owner_role":"","status":"pending"}]
}
```

## data/dashboard.json（Master agent 产出，仪表板资料层）

```json
{
  "project_id":"","run_id":"","stage":"master",
  "diamond":{"nodes":{"positioning":"","value_proposition":"","four_p":"","imc":"","arc":"","roi_feedback":""},"links":[{"from":"positioning","to":"four_p","label":""}]},
  "stages":[{"stage":"information","report":"information.html","summary":"","status":"done"}],
  "kpis":[{"metric_id":"","name":"","planned":0,"actual":null,"actual_note":"暂无数据","unit":"","formula":""}],
  "initiatives_summary":[{"initiative_id":"","title":"","roi_base":0,"payback_months":0,"priority":1}],
  "roi_summary":{"formula":"","total_cost":0,"total_attributable_margin":0,"roi":0,"currency":"CNY","scenarios":{"pessimistic":0,"base":0,"optimistic":0}},
  "filters":{"segments":[""],"arc_stages":["A","R","C"],"time_windows":[""]}
}
```

## data/artifact-manifest.json

```json
{"project_id":"","run_id":"","generated_at":"","artifacts":[{"stage":"","kind":"html|md|json","path":"Output/<run_id>/...","title":"","version":1}]}
```