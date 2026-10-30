"""Relational schema. UUID primary keys, UTC timestamps, FK relationships, indexes."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import GUID, Base, Embedding, JSONType, utcnow


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(GUID(), primary_key=True, default=uuid.uuid4)


def ts() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


def fk(target: str, nullable: bool = False, ondelete: str = "CASCADE") -> Mapped:
    return mapped_column(GUID(), ForeignKey(target, ondelete=ondelete), nullable=nullable, index=True)


class Organisation(Base):
    __tablename__ = "organisations"
    id: Mapped[uuid.UUID] = pk()
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = ts()


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    full_name: Mapped[str] = mapped_column(String(200), default="")
    role: Mapped[str] = mapped_column(String(20), default="researcher")  # admin | researcher | viewer
    organisation_id: Mapped[uuid.UUID | None] = fk("organisations.id", nullable=True, ondelete="SET NULL")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    preferences: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = ts()
    organisation: Mapped[Organisation | None] = relationship()


class ApiKey(Base):
    __tablename__ = "api_keys"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    provider: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(String(100), default="")
    encrypted_key: Mapped[str] = mapped_column(Text)
    last4: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[datetime] = ts()
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_api_key_user_provider"),)


class Investigation(Base):
    __tablename__ = "investigations"
    id: Mapped[uuid.UUID] = pk()
    owner_id: Mapped[uuid.UUID] = fk("users.id")
    organisation_id: Mapped[uuid.UUID | None] = fk("organisations.id", nullable=True, ondelete="SET NULL")
    title: Mapped[str] = mapped_column(String(300))
    category: Mapped[str] = mapped_column(String(80), default="urban_afforestation")
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True)
    # draft | analysing | analysed | running | completed | failed
    stage: Mapped[str] = mapped_column(String(60), default="created")
    location_name: Mapped[str] = mapped_column(String(200), default="")
    country: Mapped[str] = mapped_column(String(100), default="")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    seed: Mapped[int] = mapped_column(Integer, default=42)
    settings: Mapped[dict] = mapped_column(JSONType, default=dict)  # budget, lambda, active params, methods...
    algorithm_versions: Mapped[dict] = mapped_column(JSONType, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    intervention: Mapped["Intervention"] = relationship(back_populates="investigation", uselist=False, cascade="all, delete-orphan")
    owner: Mapped[User] = relationship()


class Intervention(Base):
    __tablename__ = "interventions"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    description: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(80), default="urban_afforestation")
    objectives: Mapped[list] = mapped_column(JSONType, default=list)  # user-defined success criteria
    source_document_name: Mapped[str | None] = mapped_column(String(300), nullable=True)
    source_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = ts()
    investigation: Mapped[Investigation] = relationship(back_populates="intervention")


class Claim(Base):
    __tablename__ = "claims"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    text: Mapped[str] = mapped_column(Text)
    metric: Mapped[str | None] = mapped_column(String(60), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(4), nullable=True)
    threshold: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    horizon_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    measurable: Mapped[bool] = mapped_column(Boolean, default=True)
    is_success_criterion: Mapped[bool] = mapped_column(Boolean, default=False)
    support_status: Mapped[str] = mapped_column(String(30), default="untested")  # supported|contested|unsupported|untested
    evidence_ids: Mapped[list] = mapped_column(JSONType, default=list)
    source: Mapped[str] = mapped_column(String(30), default="extracted")  # extracted | user | llm
    edited: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = ts()


class Assumption(Base):
    __tablename__ = "assumptions"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    text: Mapped[str] = mapped_column(Text)
    parameter_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="assumption")
    source: Mapped[str] = mapped_column(String(30), default="extracted")  # extracted | model | user
    created_at: Mapped[datetime] = ts()


class EvidenceSource(Base):
    __tablename__ = "evidence_sources"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    provider: Mapped[str] = mapped_column(String(30))  # openalex | crossref | nasa_power | registry | gbif
    doi: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True)
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list] = mapped_column(JSONType, default=list)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    venue: Mapped[str | None] = mapped_column(String(400), nullable=True)
    source_type: Mapped[str] = mapped_column(String(40), default="other")
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cited_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    quality: Mapped[dict] = mapped_column(JSONType, default=dict)
    limitations: Mapped[list] = mapped_column(JSONType, default=list)
    doi_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    query: Mapped[str | None] = mapped_column(Text, nullable=True)
    retrieved_at: Mapped[datetime] = ts()
    __table_args__ = (Index("ix_evidence_inv_doi", "investigation_id", "doi"),)


class EvidencePassage(Base):
    __tablename__ = "evidence_passages"
    id: Mapped[uuid.UUID] = pk()
    source_id: Mapped[uuid.UUID] = fk("evidence_sources.id")
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    text: Mapped[str] = mapped_column(Text)
    topic: Mapped[str] = mapped_column(String(60), default="general", index=True)
    stance: Mapped[str] = mapped_column(String(20), default="neutral")  # supports | contradicts | neutral
    relevance: Mapped[float] = mapped_column(Float, default=0.0)
    embedding: Mapped[list | None] = mapped_column(Embedding(), nullable=True)
    created_at: Mapped[datetime] = ts()


class CausalGraph(Base):
    __tablename__ = "causal_graphs"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    is_alternative: Mapped[bool] = mapped_column(Boolean, default=False)
    analysis: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = ts()


class CausalNode(Base):
    __tablename__ = "causal_nodes"
    id: Mapped[uuid.UUID] = pk()
    graph_id: Mapped[uuid.UUID] = fk("causal_graphs.id")
    key: Mapped[str] = mapped_column(String(60))
    label: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30))  # environment | intervention | intermediate | outcome
    parameter_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    description: Mapped[str] = mapped_column(Text, default="")
    x: Mapped[float] = mapped_column(Float, default=0)
    y: Mapped[float] = mapped_column(Float, default=0)


class CausalEdge(Base):
    __tablename__ = "causal_edges"
    id: Mapped[uuid.UUID] = pk()
    graph_id: Mapped[uuid.UUID] = fk("causal_graphs.id")
    source_key: Mapped[str] = mapped_column(String(60))
    target_key: Mapped[str] = mapped_column(String(60))
    sign: Mapped[str] = mapped_column(String(4))  # + | - | ±
    mechanism: Mapped[str] = mapped_column(Text)
    basis: Mapped[str] = mapped_column(String(30))  # equation | literature | assumption | hypothesis
    in_model: Mapped[bool] = mapped_column(Boolean, default=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.5)
    uncertainty: Mapped[str] = mapped_column(Text, default="")
    references: Mapped[list] = mapped_column(JSONType, default=list)
    evidence_ids: Mapped[list] = mapped_column(JSONType, default=list)
    contradicting_ids: Mapped[list] = mapped_column(JSONType, default=list)


class EnvironmentalParameter(Base):
    __tablename__ = "environmental_parameters"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    name: Mapped[str] = mapped_column(String(60))
    label: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(20))
    unit: Mapped[str] = mapped_column(String(40))
    nominal: Mapped[float] = mapped_column(Float)
    lower: Mapped[float] = mapped_column(Float)
    upper: Mapped[float] = mapped_column(Float)
    status: Mapped[str] = mapped_column(String(20))
    sources: Mapped[list] = mapped_column(JSONType, default=list)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    weight: Mapped[float] = mapped_column(Float, default=1.0)
    __table_args__ = (UniqueConstraint("investigation_id", "name", name="uq_param_inv_name"),)


class ModelConfiguration(Base):
    __tablename__ = "model_configurations"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    model_name: Mapped[str] = mapped_column(String(100))
    model_version: Mapped[str] = mapped_column(String(20))
    config: Mapped[dict] = mapped_column(JSONType)
    config_hash: Mapped[str] = mapped_column(String(64), index=True)
    climatology_source: Mapped[str] = mapped_column(Text)
    synthetic_climate: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = ts()


class AgentExecution(Base):
    __tablename__ = "agent_executions"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    agent: Mapped[str] = mapped_column(String(60))
    status: Mapped[str] = mapped_column(String(20), default="running")  # running | succeeded | failed | skipped
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    summary: Mapped[str] = mapped_column(Text, default="")
    output: Mapped[dict] = mapped_column(JSONType, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = ts()
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AgentEvent(Base):
    __tablename__ = "agent_events"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    execution_id: Mapped[uuid.UUID | None] = fk("agent_executions.id", nullable=True, ondelete="SET NULL")
    seq: Mapped[int] = mapped_column(Integer)
    agent: Mapped[str] = mapped_column(String(60))
    type: Mapped[str] = mapped_column(String(40))  # info | started | progress | finding | failure_found | warning | error | completed
    message: Mapped[str] = mapped_column(Text)
    data: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = ts()
    __table_args__ = (Index("ix_agent_events_inv_seq", "investigation_id", "seq"),)


class OptimisationRun(Base):
    __tablename__ = "optimisation_runs"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    method: Mapped[str] = mapped_column(String(60))
    method_key: Mapped[str] = mapped_column(String(30))
    version: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="completed")
    budget: Mapped[int] = mapped_column(Integer)
    seed: Mapped[int] = mapped_column(Integer)
    evaluations: Mapped[int] = mapped_column(Integer, default=0)
    found: Mapped[bool] = mapped_column(Boolean, default=False)
    best_distance: Mapped[float | None] = mapped_column(Float, nullable=True)
    best_b: Mapped[float | None] = mapped_column(Float, nullable=True)
    first_failure_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    runtime_s: Mapped[float] = mapped_column(Float, default=0)
    config: Mapped[dict] = mapped_column(JSONType, default=dict)
    problem: Mapped[dict] = mapped_column(JSONType, default=dict)
    convergence: Mapped[list] = mapped_column(JSONType, default=list)
    notes: Mapped[list] = mapped_column(JSONType, default=list)
    created_at: Mapped[datetime] = ts()


class OptimisationEvaluation(Base):
    __tablename__ = "optimisation_evaluations"
    id: Mapped[uuid.UUID] = pk()
    run_id: Mapped[uuid.UUID] = fk("optimisation_runs.id")
    idx: Mapped[int] = mapped_column(Integer)
    u: Mapped[list] = mapped_column(JSONType)
    b: Mapped[float] = mapped_column(Float)
    cv: Mapped[float] = mapped_column(Float)
    distance: Mapped[float] = mapped_column(Float)
    phase: Mapped[str] = mapped_column(String(40))
    __table_args__ = (Index("ix_opt_eval_run_idx", "run_id", "idx"),)


class Counterexample(Base):
    __tablename__ = "counterexamples"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    run_id: Mapped[uuid.UUID] = fk("optimisation_runs.id")
    rank: Mapped[int] = mapped_column(Integer)
    method: Mapped[str] = mapped_column(String(60))
    distance: Mapped[float] = mapped_column(Float)
    net_benefit: Mapped[float] = mapped_column(Float)
    binding_criterion: Mapped[str] = mapped_column(String(60))
    parameters: Mapped[dict] = mapped_column(JSONType)  # physical values of ALL parameters
    deltas: Mapped[dict] = mapped_column(JSONType)  # changed parameters: physical delta + normalised
    metrics: Mapped[dict] = mapped_column(JSONType)
    normalised: Mapped[list] = mapped_column(JSONType)
    status: Mapped[str] = mapped_column(String(30), default="unverified")
    producer: Mapped[str] = mapped_column(String(60), default="optimisation_agent")
    created_at: Mapped[datetime] = ts()


class VerificationResult(Base):
    __tablename__ = "verification_results"
    id: Mapped[uuid.UUID] = pk()
    counterexample_id: Mapped[uuid.UUID] = fk("counterexamples.id")
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    status: Mapped[str] = mapped_column(String(30))
    verifier: Mapped[str] = mapped_column(String(60))
    verifier_version: Mapped[str] = mapped_column(String(20))
    recomputed_b: Mapped[float] = mapped_column(Float)
    robustness: Mapped[float] = mapped_column(Float)
    config_hash: Mapped[str] = mapped_column(String(64))
    checks: Mapped[list] = mapped_column(JSONType)
    flags: Mapped[list] = mapped_column(JSONType)
    created_at: Mapped[datetime] = ts()


class AnalysisResult(Base):
    __tablename__ = "analysis_results"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    kind: Mapped[str] = mapped_column(String(40), index=True)  # sobol | monte_carlo | local_sensitivity
    result: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = ts()


class ScenarioComparison(Base):
    __tablename__ = "scenario_comparisons"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(30))  # alternatives | scenario
    inputs: Mapped[dict] = mapped_column(JSONType, default=dict)
    result: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = ts()


class InvestigationReport(Base):
    __tablename__ = "investigation_reports"
    id: Mapped[uuid.UUID] = pk()
    investigation_id: Mapped[uuid.UUID] = fk("investigations.id")
    version: Mapped[int] = mapped_column(Integer)
    content: Mapped[dict] = mapped_column(JSONType)
    content_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = ts()


class LlmUsage(Base):
    __tablename__ = "llm_usage"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    investigation_id: Mapped[uuid.UUID | None] = fk("investigations.id", nullable=True, ondelete="SET NULL")
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(100))
    agent: Mapped[str] = mapped_column(String(60))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    success: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = ts()


class BenchmarkRun(Base):
    __tablename__ = "benchmark_runs"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    config: Mapped[dict] = mapped_column(JSONType)
    result: Mapped[dict] = mapped_column(JSONType)
    created_at: Mapped[datetime] = ts()


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID | None] = fk("users.id", nullable=True, ondelete="SET NULL")
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    resource_id: Mapped[str | None] = mapped_column(String(60), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    detail: Mapped[dict] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
