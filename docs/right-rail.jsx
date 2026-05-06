// Right rail — AI chat scoped to the active Space/Source.
// variant: 'docked' | 'floating' | 'thread' | 'minimal'

const RIGHT_RAIL_W = 220;

function RightRail({ scope = 'Sales', variant = 'docked', onClose }) {
  const Suggestion = ({ children }) => (
    <button style={{
      all: 'unset', cursor: 'pointer',
      fontSize: 11, color: 'var(--ink-secondary)',
      padding: '6px 8px', borderRadius: 4,
      background: 'var(--bg-secondary)',
      boxShadow: 'inset 0 0 0 0.5px var(--line-thin)',
      lineHeight: 1.3,
    }}>{children}</button>
  );

  const suggestionsByScope = {
    Sales:      ['What changed with Bayer this week?', 'Draft a follow-up to Henkel', 'Show stale quotes > 14d'],
    Operations: ['Which jobs are at risk?', 'Find capacity for next week', 'Summarize blockers'],
    Finance:    ['What\'s our cash runway?', 'List overdue AR > €10k',  'Reconcile last week\'s Stripe'],
    Email:      ['Summarize this thread', 'Find unanswered from clients', 'Draft a reply to Brigitte'],
  };
  const suggestions = suggestionsByScope[scope] || suggestionsByScope.Sales;

  return (
    <div style={{
      ...Z.zone, width: RIGHT_RAIL_W, flexShrink: 0,
    }}>
      {/* header */}
      <div style={{
        padding: '10px 12px',
        borderBottom: '0.5px solid var(--line-thin)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{
            width: 16, height: 16, borderRadius: 999,
            background: 'var(--accent-tint)', color: 'var(--accent)',
            display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0,
          }}>✦</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 500, lineHeight: 1.2 }}>Ask viter</div>
            <div style={{ fontSize: 10, color: 'var(--ink-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>scoped to {scope}</div>
          </div>
        </div>
        <button onClick={onClose} style={{
          all: 'unset', cursor: 'pointer',
          width: 16, height: 16, display: 'grid', placeItems: 'center',
          color: 'var(--ink-tertiary)', fontSize: 12,
        }}>×</button>
      </div>

      {/* body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {variant === 'thread' || variant === 'docked' ? (
          <>
            {/* sample thread */}
            <div style={{ fontSize: 11, color: 'var(--ink-tertiary)' }}>Yesterday</div>
            <div style={{
              fontSize: 12, lineHeight: 1.4, color: 'var(--ink-primary)',
              padding: '8px 10px', borderRadius: 6,
              background: 'var(--bg-secondary)',
              alignSelf: 'flex-end', maxWidth: '85%',
            }}>What changed with Bayer Q3?</div>
            <div style={{
              fontSize: 12, lineHeight: 1.45, color: 'var(--ink-primary)',
              padding: '8px 10px', borderRadius: 6,
              boxShadow: 'inset 0 0 0 0.5px var(--line-thin)',
            }}>
              <div>Quote v3 sent Mon. Brigitte replied Tue asking for a 5% discount on volume tier.</div>
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-tertiary)' }}>3 sources · Email, Plunet, Front</div>
            </div>
          </>
        ) : null}

        {variant === 'minimal' && (
          <div style={{ fontSize: 12, color: 'var(--ink-tertiary)', lineHeight: 1.5 }}>
            Ask anything about {scope}. I see your sources and can act across them.
          </div>
        )}

        {/* suggestions */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-tertiary)' }}>Suggestions</div>
          {suggestions.map((s) => <Suggestion key={s}>{s}</Suggestion>)}
        </div>
      </div>

      {/* composer */}
      <div style={{
        padding: 10, borderTop: '0.5px solid var(--line-thin)',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        <div style={{
          minHeight: 56, padding: '8px 10px',
          background: 'var(--bg-secondary)',
          borderRadius: 6, fontSize: 12, color: 'var(--ink-tertiary)',
          lineHeight: 1.4,
        }}>Ask, draft, or do…</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--ink-quaternary)' }}>↵ to send · / for actions</div>
          <button style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 11, padding: '4px 10px', borderRadius: 4,
            background: 'var(--ink-primary)', color: 'var(--bg-surface)',
          }}>Send</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { RightRail, RIGHT_RAIL_W });
