// Canvas — Space view. Configurable per Space and per layout variant.
//
// props:
//   space: 'sales' | 'operations' | 'finance'
//   layout: 'default' | 'metrics-first' | 'split' | 'kanban' | 'dense'
//   attentionVariant: 'bar' | 'dot' | 'inset' | 'left-tint' | 'flag'
//   metricVariant:    'plain' | 'split' | 'sparkline' | 'inline' | 'big'
//   tab: 'Activity' | 'Workflows' | 'People'
//   timeRange: 'Today'|'Week'|'Quarter'|'Custom'
//   emptyAttention: boolean
//   emptyWorkflows: boolean

const SPACE_CONFIG = {
  sales: {
    name: 'Sales',
    sources: 'Across email, Plunet, Xero, Front',
    pipelineLabel: 'Pipeline',
    metrics: [
      { label: 'Open quotes',    value: '12',     hint: '4 awaiting reply' },
      { label: 'In negotiation', value: '€312k',  delta: '+8%', hint: 'vs last week' },
      { label: 'Won this week',  value: '€48k',   delta: '+€18k' },
      { label: 'Forecast quarter', value: '€1.4M', hint: '72% confidence' },
    ],
    attention: [
      { status: 'warn',   title: 'Bayer Q3 quote pending 3 days', meta: 'Email · Brigitte Müller · 3d',     right: '€18,400' },
      { status: 'info',   title: 'Henkel asked for a revised tier', meta: 'Front · 2h',                     right: 'Reply needed' },
      { status: 'danger', title: 'Linde renewal overdue',         meta: 'Plunet · 6d past target',          right: '€42,000' },
      { status: 'good',   title: 'BASF approved internally',      meta: 'Plunet · 4h ago',                  right: 'Acknowledge' },
      { status: 'warn',   title: 'No follow-up on Siemens lead',  meta: 'Email · 5d since last touch',      right: 'Send reminder' },
    ],
    activity: [
      'Brigitte Müller sent a follow-up to Bayer',
      'New quote drafted for Henkel',
      'Invoice paid: BASF — €14,200',
      'Quote approved internally for Linde',
      'Plunet job created: Henkel translation pack',
      'Front: 4 new threads assigned to you',
    ],
    people: [
      { name: 'Marie Dubois',     role: 'Senior account manager', last: 'active 12m ago' },
      { name: 'Tom Becker',       role: 'Account executive',      last: 'active 1h ago' },
      { name: 'Priya Anand',      role: 'Sales engineer',         last: 'active yesterday' },
      { name: 'Alex Lindqvist',   role: 'Lead, EU accounts',      last: 'active 4h ago' },
    ],
  },
  operations: {
    name: 'Operations',
    sources: 'Across Plunet, email, Front',
    pipelineLabel: 'Workload',
    metrics: [
      { label: 'Active jobs',   value: '47',    hint: 'across 12 clients' },
      { label: 'Capacity used', value: '82%',   delta: '+6%' },
      { label: 'On-time rate',  value: '94%',   delta: '-2%' },
      { label: 'Overdue tasks', value: '5',     hint: '2 critical' },
    ],
    attention: [
      { status: 'danger', title: 'Henkel TM-build missed deadline',   meta: 'Plunet · 1d overdue',     right: 'Reassign' },
      { status: 'warn',   title: 'Resource conflict — Marie booked twice', meta: 'Plunet · Thu PM',     right: 'Resolve' },
      { status: 'info',   title: 'New job request from BASF',         meta: 'Email · 38m',             right: 'Triage' },
      { status: 'warn',   title: 'QA review queue at 11 jobs',        meta: 'Plunet · threshold 8',    right: 'Open queue' },
    ],
    activity: [
      'Plunet: Job 8412 marked complete by QA',
      'Marie reassigned 3 tasks from Tom',
      'New job request from BASF — translation EN→DE',
      'Capacity warning lifted for next week',
      'Plunet: 12 invoices auto-generated',
    ],
    people: [
      { name: 'Yuki Tanaka',    role: 'Project lead',           last: 'active 5m ago' },
      { name: 'Marie Dubois',   role: 'Reviewer',               last: 'active 12m ago' },
      { name: 'Omar Haddad',    role: 'Resource manager',       last: 'active 1h ago' },
    ],
  },
  finance: {
    name: 'Finance',
    sources: 'Across Xero, Stripe, email',
    pipelineLabel: 'Position',
    metrics: [
      { label: 'Cash on hand',   value: '€842k', delta: '+€34k' },
      { label: 'AR outstanding', value: '€216k', hint: '€48k > 60d' },
      { label: 'AP due this week', value: '€72k', hint: '4 invoices' },
      { label: 'Net runway',     value: '11 mo', hint: 'at current burn' },
    ],
    attention: [
      { status: 'danger', title: '3 invoices > 60 days overdue',     meta: 'Xero · €48,200 total',  right: 'Chase' },
      { status: 'warn',   title: 'Stripe payout reconciliation gap', meta: 'Xero ↔ Stripe · €1,840', right: 'Reconcile' },
      { status: 'info',   title: 'Approval requested: BASF refund',  meta: 'Email · Marie · 2h',    right: 'Review' },
      { status: 'good',   title: 'Q2 close completed',               meta: 'Xero · yesterday',      right: 'Acknowledge' },
    ],
    activity: [
      'Xero: payment received — Henkel €22,400',
      'Stripe payout settled · €18,920',
      'Approval requested: BASF refund €1,200',
      'Xero: 4 invoices auto-sent',
      'Bank feed reconciled through Apr 28',
    ],
    people: [
      { name: 'Sara Voss',      role: 'Controller',         last: 'active 22m ago' },
      { name: 'Daniel Park',    role: 'Bookkeeper',         last: 'active 2h ago' },
      { name: 'Marie Dubois',   role: 'Approver',           last: 'active 12m ago' },
    ],
  },
};

function SpaceCanvas({
  space = 'sales',
  layout = 'default',
  attentionVariant = 'bar',
  metricVariant = 'plain',
  tab = 'Activity',
  timeRange = 'Week',
  emptyAttention = false,
  emptyWorkflows = false,
  onTabChange,
  onTimeChange,
}) {
  const cfg = SPACE_CONFIG[space];
  const TABS = ['Activity', 'Workflows', 'People'];

  // ── Header ──────────────────────────────────────────────────
  const Header = (
    <div style={{
      padding: '18px 24px 14px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.1 }}>{cfg.name}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>{cfg.sources}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PillGroup items={['Today', 'Week', 'Quarter', 'Custom']} active={timeRange} onChange={onTimeChange} />
        <div style={{ display: 'flex', gap: 4 }}>
          {['⌕', '⇪', '⋯'].map((s) => (
            <button key={s} style={{
              all: 'unset', cursor: 'pointer',
              width: 24, height: 24, display: 'grid', placeItems: 'center',
              borderRadius: 4, fontSize: 12, color: 'var(--ink-tertiary)',
              boxShadow: 'inset 0 0 0 0.5px var(--line-thin)',
            }}>{s}</button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Sections ────────────────────────────────────────────────
  const AttentionSection = (
    <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel action={!emptyAttention && <span style={{ color: 'var(--ink-tertiary)' }}>{cfg.attention.length} items</span>}>Needs attention</SectionLabel>
      {emptyAttention ? (
        <div style={{
          padding: '32px 16px', textAlign: 'center',
          background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
          color: 'var(--ink-tertiary)', fontSize: 12,
        }}>
          <div style={{ fontSize: 13, color: 'var(--ink-secondary)', marginBottom: 4 }}>You're caught up.</div>
          <div>Nothing in {cfg.name} needs your attention right now.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cfg.attention.map((a, i) => (
            <AttentionCard key={i} {...a} variant={attentionVariant} />
          ))}
        </div>
      )}
    </div>
  );

  const MetricsSection = (
    <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel>{cfg.pipelineLabel}</SectionLabel>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
      }}>
        {cfg.metrics.map((m, i) => <MetricCard key={i} {...m} variant={metricVariant} />)}
      </div>
    </div>
  );

  // ── Tab content ─────────────────────────────────────────────
  const ActivityTab = (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {cfg.activity.map((line, i) => (
        <div key={i} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          padding: '6px 4px', fontSize: 12, color: 'var(--ink-secondary)',
          borderBottom: i === cfg.activity.length - 1 ? 'none' : '0.5px solid var(--line-thin)',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{line}</span>
          <span style={{ color: 'var(--ink-tertiary)', fontSize: 11, flexShrink: 0 }}>{['18m','1h','3h','4h','6h','1d'][i % 6]}</span>
        </div>
      ))}
      <button style={{
        all: 'unset', cursor: 'pointer',
        alignSelf: 'center', marginTop: 10,
        fontSize: 11, color: 'var(--ink-tertiary)', padding: '4px 10px',
      }}>Load older →</button>
    </div>
  );

  const WorkflowsTab = emptyWorkflows ? (
    <div style={{
      padding: '40px 16px', textAlign: 'center',
      background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
    }}>
      <div style={{ fontSize: 13, color: 'var(--ink-primary)', marginBottom: 4 }}>No workflows yet.</div>
      <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginBottom: 14 }}>
        Workflows automate routine work in this space.
      </div>
      <button style={{
        all: 'unset', cursor: 'pointer',
        fontSize: 12, padding: '6px 12px', borderRadius: 4,
        background: 'var(--ink-primary)', color: 'var(--bg-surface)',
      }}>+ Create workflow</button>
    </div>
  ) : (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {[
        { name: 'Auto-nudge stale quotes',     trigger: 'When a quote is pending > 48h', last: '2h ago', status: 'Active' },
        { name: 'Weekly pipeline digest',      trigger: 'Mondays at 9:00 CET',           last: '3d ago', status: 'Active' },
        { name: 'Flag at-risk renewals',       trigger: 'When ARR > €25k & no touch 14d', last: 'never', status: 'Draft' },
      ].map((w, i) => (
        <div key={i} style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
          padding: '10px 14px',
          display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 12, alignItems: 'center',
        }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{w.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', marginTop: 2 }}>{w.trigger} · last run {w.last}</div>
          </div>
          <div style={{
            fontSize: 10, padding: '3px 6px', borderRadius: 999,
            background: w.status === 'Active' ? 'var(--good-tint)' : 'var(--bg-tertiary)',
            color: w.status === 'Active' ? 'var(--good)' : 'var(--ink-tertiary)',
          }}>{w.status}</div>
          <div style={{ color: 'var(--ink-tertiary)', fontSize: 14 }}>⋯</div>
        </div>
      ))}
    </div>
  );

  const PeopleTab = (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8,
    }}>
      {cfg.people.map((p, i) => (
        <div key={i} style={{
          background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
          padding: '12px', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <Avatar name={p.name} size={36} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-secondary)', marginTop: 1 }}>{p.role}</div>
            <div style={{ fontSize: 10, color: 'var(--ink-tertiary)', marginTop: 2 }}>{p.last}</div>
          </div>
        </div>
      ))}
    </div>
  );

  const TabsSection = (
    <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{
        display: 'flex', gap: 18, borderBottom: '0.5px solid var(--line-thin)',
        position: 'relative',
      }}>
        {TABS.map((t) => {
          const on = t === tab;
          return (
            <button key={t}
              onClick={() => onTabChange && onTabChange(t)}
              style={{
                all: 'unset', cursor: 'pointer',
                fontSize: 13, padding: '6px 0',
                color: on ? 'var(--ink-primary)' : 'var(--ink-tertiary)',
                fontWeight: on ? 500 : 400,
                borderBottom: on ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                marginBottom: -0.5,
              }}>{t}{t === 'Workflows' ? ` · ${emptyWorkflows ? 0 : 3}` : ''}</button>
          );
        })}
        {tab === 'Workflows' && !emptyWorkflows && (
          <button style={{
            all: 'unset', cursor: 'pointer', marginLeft: 'auto', alignSelf: 'center',
            fontSize: 11, padding: '4px 10px', borderRadius: 4,
            background: 'var(--ink-primary)', color: 'var(--bg-surface)',
          }}>+ New workflow</button>
        )}
      </div>
      <div>
        {tab === 'Activity' && ActivityTab}
        {tab === 'Workflows' && WorkflowsTab}
        {tab === 'People' && PeopleTab}
      </div>
    </div>
  );

  // ── Compose by layout variant ───────────────────────────────
  const sections = (() => {
    if (layout === 'metrics-first') return [MetricsSection, AttentionSection, TabsSection];
    if (layout === 'dense') {
      return [(
        <div style={{ padding: '0 24px', display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{AttentionSection.props.children}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{MetricsSection.props.children}</div>
        </div>
      ), TabsSection];
    }
    if (layout === 'split') {
      return [MetricsSection, AttentionSection, TabsSection];
    }
    if (layout === 'kanban') {
      // kanban swaps tabs for a board section
      const Kanban = (
        <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <SectionLabel>Pipeline by stage</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {[
              { stage: 'Lead',    items: ['Bayer Q3', 'Roche FY26', 'Sandoz Pilot'] },
              { stage: 'Quoted',  items: ['Henkel Tier 2', 'BASF expansion'] },
              { stage: 'Negotiation', items: ['Linde renewal', 'Siemens MSA'] },
              { stage: 'Closed',  items: ['BASF Q1', 'Boehringer add-on'] },
            ].map((col) => (
              <div key={col.stage} style={{
                background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
                padding: 8, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 120,
              }}>
                <div style={{ fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--ink-tertiary)', padding: '2px 4px' }}>{col.stage} · {col.items.length}</div>
                {col.items.map((it) => (
                  <div key={it} style={{
                    background: 'var(--bg-surface)', borderRadius: 4,
                    padding: '8px 10px', fontSize: 12,
                    boxShadow: 'inset 0 0 0 0.5px var(--line-thin)',
                  }}>{it}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      );
      return [AttentionSection, MetricsSection, Kanban, TabsSection];
    }
    return [AttentionSection, MetricsSection, TabsSection];
  })();

  return (
    <div style={{
      ...Z.zone, flex: 1, minWidth: 0,
    }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {Header}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 32 }}>
          {sections.map((s, i) => <React.Fragment key={i}>{s}</React.Fragment>)}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SpaceCanvas, SPACE_CONFIG });
