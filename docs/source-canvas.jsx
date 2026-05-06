// Source canvas — Email substrate.
// "Curated, opinionated surface" — not the source's UI replicated.

function SourceCanvasEmail({ timeRange = 'Week', onTimeChange, layout = 'default' }) {
  const Header = (
    <div style={{
      padding: '18px 24px 14px',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16,
    }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <SourceTile name="Email" size={28} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 500, lineHeight: 1.1 }}>Email</div>
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', marginTop: 4 }}>Threads grouped by counterparty · unread digest · response time</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PillGroup items={['Today', 'Week', 'Quarter', 'Custom']} active={timeRange} onChange={onTimeChange} />
        <button style={{
          all: 'unset', cursor: 'pointer',
          fontSize: 11, padding: '4px 10px', borderRadius: 4,
          color: 'var(--ink-secondary)',
          boxShadow: 'inset 0 0 0 0.5px var(--line-thin)',
        }}>Open in Gmail ↗</button>
      </div>
    </div>
  );

  const Stats = (
    <div style={{ padding: '0 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        <MetricCard label="Unread" value="34" hint="from 12 counterparties" variant="plain" />
        <MetricCard label="Awaiting your reply" value="9" delta="+3" variant="plain" />
        <MetricCard label="Median response" value="2h 14m" delta="-22m" variant="plain" />
        <MetricCard label="Threads this week" value="183" hint="56 with clients" variant="plain" />
      </div>
    </div>
  );

  // Counterparty digest — left column
  const counterparties = [
    { name: 'Bayer AG',           unread: 4, last: '18m', preview: 'Re: Q3 quote — discount tier discussion',     status: 'reply' },
    { name: 'Henkel KGaA',        unread: 2, last: '1h',  preview: 'Re: Tier 2 pricing — looks good, two q\'s',   status: 'reply' },
    { name: 'BASF SE',            unread: 0, last: '3h',  preview: 'Invoice paid · auto-confirmation',             status: 'info' },
    { name: 'Linde plc',          unread: 1, last: '6h',  preview: 'Renewal terms — overdue',                      status: 'overdue' },
    { name: 'Siemens AG',         unread: 0, last: '5d',  preview: 'No new activity',                              status: 'stale' },
    { name: 'Roche Diagnostics',  unread: 3, last: '2d',  preview: 'New RFQ attached',                             status: 'new' },
    { name: 'Boehringer Ing.',    unread: 0, last: '1w',  preview: 'Thanks for the proposal',                      status: 'idle' },
  ];

  const STATUS_DOT = {
    reply:   'var(--accent)',
    overdue: 'var(--danger)',
    new:     'var(--good)',
    stale:   'var(--warn)',
    info:    'var(--ink-tertiary)',
    idle:    'var(--ink-quaternary)',
  };

  const Counterparties = (
    <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel action={<span>Sorted by activity</span>}>Counterparties</SectionLabel>
      <div style={{
        background: 'var(--bg-surface)', borderRadius: 'var(--r-card)',
        boxShadow: 'inset 0 0 0 0.5px var(--line-thin)',
        overflow: 'hidden',
      }}>
        {counterparties.map((c, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: 'auto 160px 1fr auto auto', gap: 12,
            alignItems: 'center', padding: '10px 14px',
            borderBottom: i === counterparties.length - 1 ? 'none' : '0.5px solid var(--line-thin)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: 999, background: STATUS_DOT[c.status] }} />
            <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
            <div style={{ fontSize: 12, color: 'var(--ink-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</div>
            <div style={{ fontSize: 11, color: c.unread ? 'var(--ink-primary)' : 'var(--ink-tertiary)', minWidth: 32, textAlign: 'right' }}>
              {c.unread ? `${c.unread} unread` : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-tertiary)', minWidth: 30, textAlign: 'right' }}>{c.last}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // Unresolved threads — focused list
  const Unresolved = (
    <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel action={<span>9 threads</span>}>Awaiting your reply</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[
          { who: 'Brigitte Müller (Bayer)', subj: 'Re: Q3 quote v3', age: '3d', why: 'asked about volume tier' },
          { who: 'Andreas Hoff (Henkel)',   subj: 'Re: Tier 2 pricing', age: '1d', why: 'wants final confirmation' },
          { who: 'Marta Lopez (Roche)',     subj: 'New RFQ — clinical translation', age: '2d', why: 'attachment unread' },
        ].map((t, i) => (
          <div key={i} style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <Avatar name={t.who} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{t.subj}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>{t.who} · {t.why}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>{t.age}</div>
            <button style={{
              all: 'unset', cursor: 'pointer',
              fontSize: 11, padding: '4px 10px', borderRadius: 4,
              color: 'var(--ink-primary)',
              boxShadow: 'inset 0 0 0 0.5px var(--line-strong)',
            }}>Draft reply</button>
          </div>
        ))}
      </div>
    </div>
  );

  // Recent attachments
  const Attachments = (
    <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SectionLabel>Recent attachments</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { name: 'BASF-MSA-v4.pdf', from: 'Marie · 2h', size: '218 KB' },
          { name: 'Henkel-quote-tier2.xlsx', from: 'Tom · 1d', size: '54 KB' },
          { name: 'Roche-RFQ-clinical.docx', from: 'Marta · 2d', size: '92 KB' },
        ].map((f, i) => (
          <div key={i} style={{
            background: 'var(--bg-secondary)', borderRadius: 'var(--r-card)',
            padding: '12px', display: 'flex', flexDirection: 'column', gap: 4,
          }}>
            <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div>
            <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>{f.from} · {f.size}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ ...Z.zone, flex: 1, minWidth: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {Header}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 32 }}>
          {Stats}
          {Counterparties}
          {Unresolved}
          {Attachments}
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { SourceCanvasEmail });
